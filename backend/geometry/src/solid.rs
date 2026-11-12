//! Topology operations shared by the stock, cavities and exports.

use crate::profile::{Point, TOL, rounded};
use cad_kernel::boolean::{Op, combined_known};
use cad_kernel::build::{Profile, prism};
use cad_kernel::geom::{Box3, Rigid, Surface};
use cad_kernel::topo::{Brep, Coedge, Face, Pcurve};
use std::collections::VecDeque;

pub fn translate(body: &Brep, at: [f64; 3]) -> Brep {
    body.moved(&Rigid {
        t: at,
        ..Rigid::identity()
    })
}

pub fn place(body: &Brep, at: [f64; 3], angle: f64) -> Brep {
    let (sin, cos) = angle.to_radians().sin_cos();
    body.moved(&Rigid {
        r: [[cos, -sin, 0.], [sin, cos, 0.], [0., 0., 1.]],
        t: at,
    })
}

pub fn extrude(profile: &Profile, low: f64, high: f64) -> Result<Brep, String> {
    if high <= low {
        return Err("extrusion must have positive height".into());
    }
    prism(profile, low, high)
}

pub fn block(at: Point, size: Point, low: f64, high: f64) -> Result<Brep, String> {
    extrude(&rounded(at, size, 0.), low, high)
}

pub fn intersects(a: Box3, b: Box3) -> bool {
    (0..3).all(|i| a.0[i] <= b.1[i] + TOL && b.0[i] <= a.1[i] + TOL)
}

pub fn boolean(a: Brep, b: &Brep, op: Op, context: &str) -> Result<Brep, String> {
    if b.faces.is_empty() || a.faces.is_empty() || !intersects(a.bounds(), b.bounds()) {
        return match op {
            Op::Cut => Ok(a),
            Op::Common => Ok(Brep::default()),
            Op::Union => Ok(a.joined(b)),
        };
    }
    combined_known(&a, None, b, op, 0.)
        .map(|result| result.0)
        .map_err(|error| format!("{context}: {error}"))
}

fn subtract_in_order<'a>(
    stock: &Brep,
    cuts: impl Iterator<Item = (usize, &'a Brep)>,
    context: &str,
    tolerance: f64,
) -> Result<Option<Brep>, String> {
    let mut result = None;
    let bounds = stock.bounds();
    for (i, cutter) in cuts {
        let (body, known) = result
            .as_ref()
            .map_or((stock, None), |(body, known)| (body, Some(known)));
        if body.faces.is_empty() {
            break;
        }
        if cutter.faces.is_empty() || !intersects(bounds, cutter.bounds()) {
            continue;
        }
        let cut = combined_known(body, known, cutter, Op::Cut, tolerance)
            .map_err(|error| format!("{context} {}: {error}", i + 1))?;
        result = Some(cut);
    }
    Ok(result.map(|(body, _)| body))
}

pub fn subtract(stock: Brep, cuts: &[Brep], context: &str) -> Result<Brep, String> {
    let order = cuts.iter().enumerate();
    let result = subtract_in_order(&stock, order.clone(), context, 0.).or_else(|error| {
        // The same cutters remove the same volume in either order. A different
        // order can avoid an intermediate face the kernel cannot resolve.
        if cuts.len() > 1
            && let Ok(body) = subtract_in_order(&stock, order.clone().rev(), context, 0.)
        {
            return Ok(body);
        }
        subtract_in_order(&stock, order, context, TOL).map_err(|_| error)
    })?;
    Ok(result.unwrap_or(stock))
}

pub fn union(bodies: Vec<Brep>, context: &str) -> Result<Brep, String> {
    bodies
        .into_iter()
        .try_fold(Brep::default(), |a, b| boolean(a, &b, Op::Union, context))
}

fn top_caps(stock: &Brep, top: f64) -> impl Iterator<Item = (usize, &Face)> {
    stock.faces.iter().enumerate().filter(move |(_, face)| {
        matches!(face.surface,Surface::Plane(f)
            if f.z[2]>0.999 && (f.o[2]-top).abs()<TOL && !face.reversed)
    })
}

fn cap_index(stock: &Brep, top: f64) -> Option<usize> {
    top_caps(stock, top)
        .max_by(|(_, a), (_, b)| {
            cad_kernel::props::area(stock, a).total_cmp(&cad_kernel::props::area(stock, b))
        })
        .map(|(index, _)| index)
}

pub fn inside_rounded_rect(bounds: Box3, size: Point, radius: f64) -> bool {
    let x = bounds.0[0].abs().max(bounds.1[0].abs()) + TOL;
    let y = bounds.0[1].abs().max(bounds.1[1].abs()) + TOL;
    let [w, h] = size.map(|d| d / 2.);
    x < w && y < h && (x - w + radius).max(0.).hypot((y - h + radius).max(0.)) <= radius
}

fn pocket_groups(bounds: &[Box3]) -> Vec<Vec<usize>> {
    let mut assigned = vec![false; bounds.len()];
    let mut groups = Vec::new();
    for start in 0..bounds.len() {
        if assigned[start] {
            continue;
        }
        let mut indices = vec![start];
        assigned[start] = true;
        let mut next = 0;
        while next < indices.len() {
            let (lo, hi) = bounds[indices[next]];
            for (index, &(other_lo, other_hi)) in bounds.iter().enumerate() {
                if !assigned[index]
                    && (0..2).all(|i| lo[i] <= other_hi[i] + TOL && other_lo[i] <= hi[i] + TOL)
                {
                    indices.push(index);
                    assigned[index] = true;
                }
            }
            next += 1;
        }
        groups.push(indices);
    }
    groups
}

type Cavity = (Brep, Vec<Vec<Coedge>>);

fn local_cavity(
    cutters: &[Brep],
    group: &[usize],
    bounds: &[Box3],
    top: f64,
) -> Result<Cavity, String> {
    let lo: [f64; 3] = std::array::from_fn(|i| {
        group
            .iter()
            .map(|&j| bounds[j].0[i])
            .fold(f64::INFINITY, f64::min)
            - 1.
    });
    let hi: [f64; 3] = std::array::from_fn(|i| {
        group
            .iter()
            .map(|&j| bounds[j].1[i])
            .fold(f64::NEG_INFINITY, f64::max)
            + 1.
    });
    let stock = block(
        [(lo[0] + hi[0]) / 2., (lo[1] + hi[1]) / 2.],
        [hi[0] - lo[0], hi[1] - lo[1]],
        lo[2],
        top,
    )?;
    let local_tools: Vec<_> = group
        .iter()
        .filter(|&&i| bounds[i].0[2] < top - TOL)
        .map(|&i| cutters[i].clone())
        .collect();
    let mut cavity = subtract(stock, &local_tools, "local pocket")?;
    // An island inside a cutout can have a larger top face than the slab's rim.
    let slab_corner = [lo[0], lo[1], top];
    let cap = top_caps(&cavity, top)
        .find(|(_, face)| {
            face.loops[0].iter().any(|coedge| {
                cavity.edges[coedge.edge as usize].v.iter().any(|&vertex| {
                    let point = cavity.vertices[vertex as usize].p;
                    (0..3).all(|i| (point[i] - slab_corner[i]).abs() < TOL)
                })
            })
        })
        .map(|(index, _)| index)
        .ok_or("expected a planar cavity cap")?;
    let cap = cavity.faces.remove(cap);
    cavity.faces.retain(|face| {
        !matches!(face.surface,Surface::Plane(f) if
        (0..2).any(|i| f.z[i].abs()>0.999 && ((f.o[i]-lo[i]).abs()<TOL || (f.o[i]-hi[i]).abs()<TOL))
        || (f.z[2].abs()>0.999 && (f.o[2]-lo[2]).abs()<TOL))
    });
    Ok((cavity, cap.loops.into_iter().skip(1).collect()))
}

/// Join a continuation whose bottom loop is contained by the lower body's top.
pub fn attach_continuation(mut body: Brep, mut continuation: Brep, z: f64) -> Result<Brep, String> {
    let top = cap_index(&body, z).ok_or("missing bevel shoulder")?;
    let bottom = continuation
        .faces
        .iter()
        .position(|face| {
            matches!(face.surface,Surface::Plane(f)
        if f.z[2]>0.999 && (f.o[2]-z).abs()<TOL && face.reversed)
        })
        .ok_or("missing pocket continuation base")?;
    let cap = continuation.faces.remove(bottom);
    let edge_offset = body.edges.len() as u32;
    body.join(&continuation);
    let surface = body.faces[top].surface.clone();
    for mut ring in cap.loops {
        for coedge in &mut ring {
            coedge.edge += edge_offset;
            let edge = &body.edges[coedge.edge as usize];
            let [a, b] = edge
                .t
                .map(|t| surface.inverse(edge.point(t, &body.vertices)));
            coedge.pcurve = Pcurve::Inverse { a, b };
        }
        body.faces[top].loops.push(ring);
    }
    Ok(body.compacted())
}

pub fn carve(
    stock: Brep,
    cutters: Vec<Brep>,
    top: f64,
    inner: Point,
    radius: f64,
    bottom: f64,
) -> Result<Brep, String> {
    let bounds: Vec<_> = cutters.iter().map(Brep::bounds).collect();
    let (local, global): (Vec<_>, Vec<_>) = pocket_groups(&bounds).into_iter().partition(|group| {
        group.iter().all(|&i| {
            bounds[i].0[2] > bottom + TOL
                && bounds[i].1[2] > top + TOL
                && inside_rounded_rect(bounds[i], inner, radius)
        })
    });
    let global: Vec<_> = global
        .into_iter()
        .flatten()
        .map(|i| cutters[i].clone())
        .collect();
    let mut stock = subtract(stock, &global, "bin cutout")?;
    if local.is_empty() {
        return Ok(stock);
    }
    let cap = {
        let mut caps = top_caps(&stock, top);
        caps.next()
            .map(|(index, _)| index)
            .filter(|_| caps.next().is_none())
    };
    let Some(cap) = cap else {
        return subtract(
            stock,
            &local
                .into_iter()
                .flatten()
                .map(|i| cutters[i].clone())
                .collect::<Vec<_>>(),
            "bin cutout",
        );
    };
    let workers = std::thread::available_parallelism()
        .map_or(1, usize::from)
        .min(6);
    let batch_size = local.len().div_ceil(workers);
    let cavities = std::thread::scope(|scope| {
        let jobs: Vec<_> = local
            .chunks(batch_size)
            .map(|batch| {
                let (cutters, bounds) = (&cutters, &bounds);
                scope.spawn(move || {
                    batch
                        .iter()
                        .map(|group| local_cavity(cutters, group, bounds, top))
                        .collect::<Result<Vec<_>, _>>()
                })
            })
            .collect();
        let mut cavities = Vec::new();
        for job in jobs {
            cavities.extend(
                job.join()
                    .map_err(|_| "pocket construction panicked".to_string())??,
            );
        }
        Ok::<_, String>(cavities)
    })?;
    let plane = stock.faces[cap].surface.clone();
    for (cavity, loops) in cavities {
        let edge_offset = stock.edges.len() as u32;
        stock.join(&cavity);
        for mut ring in loops {
            for coedge in &mut ring {
                coedge.edge += edge_offset;
                let edge = &stock.edges[coedge.edge as usize];
                let [a, b] = edge
                    .t
                    .map(|t| plane.inverse(edge.point(t, &stock.vertices)));
                coedge.pcurve = Pcurve::Inverse { a, b };
            }
            stock.faces[cap].loops.push(ring);
        }
    }
    Ok(stock.compacted())
}

/// Return each connected shell with its own compact edge and vertex indices.
pub fn components(body: &Brep) -> Vec<Brep> {
    let uses = body.uses();
    let mut visited = vec![false; body.faces.len()];
    let mut components = Vec::new();
    for start in 0..body.faces.len() {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let mut queue = VecDeque::from([start]);
        let mut faces = Vec::new();
        while let Some(i) = queue.pop_front() {
            let face = &body.faces[i];
            for coedge in face.loops.iter().flatten() {
                for &(other, _, _) in &uses[coedge.edge as usize] {
                    if !visited[other] {
                        visited[other] = true;
                        queue.push_back(other);
                    }
                }
            }
            faces.push(face.clone());
        }
        components.push(
            Brep {
                vertices: body.vertices.clone(),
                edges: body.edges.clone(),
                faces,
            }
            .compacted(),
        );
    }
    components
}
