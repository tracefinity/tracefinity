use cad_kernel::boolean::{Op, glued};
use cad_kernel::build::{cone, disc, drafted, sphere};
use cad_kernel::topo::Brep;
use std::collections::HashMap;
use std::f64::consts::FRAC_PI_4;

use crate::input::{Extrusion, Finger, FingerShape, Job, Pocket};
use crate::profile::{
    MARGIN, Point, TOL, Z, finger_slot, planar, rounded, scaled_loft, slot_inset,
};
use crate::solid::{
    attach_continuation, block, boolean, carve, extrude, inside_rounded_rect, place, subtract,
    translate, union,
};

const BASE: f64 = 4.75;
const RADIUS: f64 = 3.75;
const LIP_INSET: f64 = 2.6;
const LIP_TOP: f64 = 4.4;
const LIP_MID: f64 = 1.9;

pub struct Bin {
    pub full: Brep,
    pub material: Brep,
    pub labels: Brep,
    pub insert: Brep,
}

fn stock(job: &Job, top: f64) -> Result<Brep, String> {
    let profile = |inset: f64| rounded([0.; 2], job.size.map(|d| d - 2. * inset), RADIUS);
    let shell = extrude(&profile(0.), BASE, top)?;
    if !job.lip {
        return Ok(shell);
    }
    let lip_base = job.wall_top + job.rim;
    let ramp = |inset, height, z| {
        let body = drafted(&profile(inset), 0., height, -FRAC_PI_4)?;
        Ok::<_, String>(translate(&body, [0., 0., z]))
    };
    let mut cuts = Vec::new();
    if job.rim > 0. {
        cuts.push(extrude(&profile(LIP_INSET), job.wall_top, lip_base)?);
    }
    cuts.push(ramp(LIP_INSET, 0.7, lip_base)?);
    cuts.push(extrude(&profile(LIP_MID), lip_base + 0.7, lip_base + 2.5)?);
    cuts.push(ramp(LIP_MID, 1.9, lip_base + 2.5)?);
    subtract(shell, &cuts, "stacking lip")
}

fn foot(size: Point, magnet: Point, holes: &[Point]) -> Result<Brep, String> {
    let section = |inset: f64| rounded([0.; 2], size.map(|d| d - 2. * inset), RADIUS);
    let middle = section(2.15);
    let upper = translate(&drafted(&middle, 0., 2.15, -FRAC_PI_4)?, [0., 0., 2.6]);
    let stem = extrude(&middle, 0.8, 2.6)?;
    let lower = drafted(&section(2.95), 0., 0.8, -FRAC_PI_4)?;
    let foot = union(vec![stem, upper, lower], "base foot")?;
    let [radius, depth] = magnet;
    let mut cutters = Brep::default();
    for &[x, y] in holes {
        cutters.join(&extrude(
            &disc([x, y, 0.], Z, radius),
            -MARGIN,
            depth + MARGIN,
        )?);
    }
    boolean(foot, &cutters, Op::Cut, "magnet holes")
}

fn add_feet(mut stock: Brep, job: &Job) -> Result<Brep, String> {
    let mut templates = HashMap::new();
    let mut batch = Brep::default();
    for f in &job.feet {
        let key = (
            f.size.map(f64::to_bits),
            f.magnets
                .iter()
                .map(|p| p.map(f64::to_bits))
                .collect::<Vec<_>>(),
        );
        let template = match templates.entry(key) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                let mut local_magnet = job.magnet;
                local_magnet[1] = local_magnet[1].min(BASE - MARGIN);
                entry.insert(foot(f.size, local_magnet, &f.magnets)?)
            }
        };
        batch.join(&translate(template, [f.at[0], f.at[1], 0.]));
    }
    stock = boolean(stock, &batch, Op::Union, "attach feet")?;
    if job.magnet[1] > BASE - MARGIN {
        let mut cutters = Vec::new();
        for f in &job.feet {
            for &[x, y] in &f.magnets {
                cutters.push(extrude(
                    &disc([f.at[0] + x, f.at[1] + y, 0.], Z, job.magnet[0]),
                    BASE - MARGIN,
                    job.magnet[1] + MARGIN,
                )?);
            }
        }
        stock = subtract(stock, &cutters, "deep magnet holes")?;
    }
    Ok(stock)
}

fn simple(spec: &Extrusion) -> Result<Brep, String> {
    extrude(&planar(&spec.rings, 0.), spec.low, spec.high)
}

fn pocket(pocket: &Pocket, job: &Job, top: f64) -> Result<Vec<Brep>, String> {
    let wall = job.wall_top;
    let profile = planar(&pocket.rings, pocket.fit);
    if pocket.chamfer <= 0. {
        return Ok(vec![extrude(&profile, pocket.floor, top + MARGIN)?]);
    }

    let low = wall - pocket.chamfer;
    let high = wall + MARGIN;
    let body = extrude(&profile, pocket.floor, low)?;
    let bevel = scaled_loft(&profile, pocket.center, pocket.scale, low, high)?;
    let bevelled =
        glued(&body, &bevel, TOL).ok_or("pocket and chamfer profiles do not share an edge")?;
    let inset = if job.lip { LIP_INSET } else { 0. };
    if top <= wall
        || inside_rounded_rect(bevelled.bounds(), job.size.map(|d| d - 2. * inset), RADIUS)
    {
        return Ok(vec![bevelled]);
    }
    // A scaled chamfer need not contain the original concave outline.
    // Cut the rim first, then the bevel, so neither profile must nest in the other.
    let continuation = extrude(&profile, high, top + MARGIN)?;
    Ok(vec![continuation, bevelled])
}

fn finger(f: &Finger, wall: f64, top: f64) -> Result<Vec<Brep>, String> {
    let [x, y] = f.at;
    let [w, d] = f.size;
    let circle = matches!(f.shape, FingerShape::Circle | FingerShape::Cylinder);
    if !circle && f.chamfer > 0. {
        let z0 = wall - f.chamfer;
        let z1 = wall + MARGIN;
        let round = matches!(f.shape, FingerShape::FilletedRectangle) && f.round > TOL;
        let height = z0 - f.floor;
        let (bottom, base_width) = if round {
            let slot = finger_slot(w, f.round, height);
            (
                translate(&extrude(&slot, -d / 2., d / 2.)?, [0., 0., f.floor]),
                w - 2. * slot_inset(f.round, height),
            )
        } else {
            (block([0.; 2], f.size, f.floor, z0)?, w)
        };
        let low = rounded([0.; 2], [base_width, d], 0.);
        let scales = [(w + 2. * f.chamfer) / base_width, 1. + 2. * f.chamfer / d];
        let chamfer = scaled_loft(&low, [0.; 2], scales, z0, z1)?;
        let mut cutter = glued(&bottom, &chamfer, TOL)
            .ok_or("finger and chamfer profiles do not share an edge")?;
        if top > wall {
            let continuation = block([0.; 2], f.size, z1, top + MARGIN)?;
            cutter = attach_continuation(cutter, continuation, z1)?;
        }
        return Ok(vec![place(&cutter, [x, y, 0.], f.angle)]);
    }
    if matches!(f.shape, FingerShape::Cylinder) && f.chamfer > 0. {
        let z0 = wall - f.chamfer;
        let z1 = wall + MARGIN;
        let profile = disc([x, y, 0.], Z, f.radius);
        let bottom = extrude(&profile, f.floor, z0)?;
        let bevel = cone([x, y, z0], Z, f.radius, f.radius + f.chamfer, z1 - z0)?;
        // Share the circular seam instead of cutting overlapping solids at the same radius.
        let mut cutter = glued(&bottom, &bevel, TOL)
            .ok_or("cylinder and chamfer profiles do not share an edge")?;
        if top > wall {
            let continuation = extrude(&profile, z1, top + MARGIN)?;
            cutter = attach_continuation(cutter, continuation, z1)?;
        }
        return Ok(vec![cutter]);
    }
    let mut cuts = match f.shape {
        FingerShape::Circle => {
            let center = wall.max(f.floor + f.radius);
            let mut cuts = vec![sphere([x, y, center], Z, f.radius)?];
            if top > wall {
                let opening = (f.radius * f.radius - (center - wall).powi(2)).sqrt();
                if opening > TOL {
                    cuts.push(extrude(&disc([x, y, 0.], Z, opening), wall, top + MARGIN)?);
                }
            }
            cuts
        }
        FingerShape::Cylinder => vec![extrude(
            &disc([x, y, 0.], Z, f.radius),
            f.floor,
            top + MARGIN,
        )?],
        FingerShape::FilletedRectangle if f.round > TOL => {
            let profile = finger_slot(w, f.round, top - f.floor + 2. * MARGIN);
            let body = extrude(&profile, -d / 2., d / 2.)?;
            vec![place(&body, [x, y, f.floor], f.angle)]
        }
        _ => {
            let body = block([0.; 2], f.size, f.floor, top + MARGIN)?;
            vec![place(&body, [x, y, 0.], f.angle)]
        }
    };
    if f.chamfer > 0. {
        let z0 = wall - f.chamfer;
        let z1 = wall + MARGIN;
        cuts.push(cone(
            [x, y, z0],
            Z,
            f.radius,
            f.radius + f.chamfer,
            z1 - z0,
        )?);
    }
    Ok(cuts)
}

pub fn generate(job: &Job) -> Result<Bin, String> {
    let wall = job.wall_top;
    let top = wall + if job.lip { job.rim + LIP_TOP } else { 0. };
    let mut stock = stock(job, top)?;
    let mut cutters = Vec::new();
    if let Some(floor) = job.blank_floor {
        let inset = job.wall.max(if job.lip { LIP_INSET } else { 0. });
        let profile = rounded([0.; 2], job.size.map(|d| d - 2. * inset), RADIUS);
        // The blank opening ends at the floor of the lip, even on a raised rim.
        cutters.push(extrude(&profile, floor, wall + MARGIN)?);
    }
    for spec in &job.pockets {
        cutters.extend(pocket(spec, job, top)?);
    }
    for spec in &job.fingers {
        cutters.extend(finger(spec, wall, top)?);
    }
    if !job.allow_wall_cutouts && job.blank_floor.is_none() {
        let size = job.size.map(|d| d - 2. * job.wall);
        let radius = (RADIUS - job.wall).max(0.);
        let guard = extrude(&rounded([0.; 2], size, radius), -1., top + 1.)?;
        for body in &mut cutters {
            if !inside_rounded_rect(body.bounds(), size, radius) {
                *body = boolean(std::mem::take(body), &guard, Op::Common, "preserve wall")?;
            }
        }
        cutters.retain(|c| !c.faces.is_empty());
    }

    if job.trim.is_empty() && job.recessed.iter().all(|c| c.low > BASE + TOL) {
        if job.blank_floor.is_some() || cutters.iter().any(|c| c.bounds().0[2] <= BASE + TOL) {
            stock = subtract(stock, &cutters, "bin pocket")?;
            stock = add_feet(stock, job)?;
        } else {
            let inset = if job.lip { LIP_INSET } else { 0. };
            // Add feet before local cavities so the foot union sees the simple
            // stock. Wall openings still use the same native Boolean solver.
            stock = add_feet(stock, job)?;
            stock = carve(
                stock,
                cutters,
                wall,
                job.size.map(|d| d - 2. * inset),
                RADIUS,
                BASE,
            )?;
        }
    } else {
        stock = add_feet(stock, job)?;
        let trims = job.trim.iter().map(simple).collect::<Result<Vec<_>, _>>()?;
        stock = subtract(stock, &trims, "partial bin")?;
        for plate in &job.bridges {
            let bridge = extrude(
                &rounded(plate.at, plate.size, plate.radius),
                BASE - MARGIN,
                BASE + 5.8,
            )?;
            stock = boolean(stock, &bridge, Op::Union, "partial bin bridge")?;
        }
        stock = subtract(stock, &cutters, "bin pocket")?;
    }
    let recessed = job
        .recessed
        .iter()
        .map(simple)
        .collect::<Result<Vec<_>, _>>()?;
    stock = subtract(stock, &recessed, "recessed text")?;
    let labels = union(
        job.embossed
            .iter()
            .map(simple)
            .collect::<Result<Vec<_>, _>>()?,
        "embossed text",
    )?;
    let full = boolean(stock.clone(), &labels, Op::Union, "attach embossed text")?;
    let insert = union(
        job.inserts
            .iter()
            .map(simple)
            .collect::<Result<Vec<_>, _>>()?,
        "contrast insert",
    )?;
    if full.faces.is_empty() {
        return Err("bin has no printable material".into());
    }
    Ok(Bin {
        full,
        material: stock,
        labels,
        insert,
    })
}
