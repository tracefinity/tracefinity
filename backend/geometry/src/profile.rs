//! Planar profiles and lofts used by the bin generator.

use cad_kernel::build::{Profile, ProfileEdge, lofted};
use cad_kernel::geom::{BSpline, Curve, Frame, Surface};
use cad_kernel::nurbs::Net;
use cad_kernel::topo::{Brep, EdgeCurve, Pcurve};
use cad_kernel::util::space::{cross, dot, norm, normalised, sub};
use std::f64::consts::{FRAC_PI_2, PI};
use std::sync::Arc;

pub type Point = [f64; 2];
pub type Rings = Vec<Vec<Point>>;
pub const Z: [f64; 3] = [0., 0., 1.];
pub const TOL: f64 = 1e-6;
pub const MARGIN: f64 = 0.01;

pub fn rounded([x, y]: Point, [w, h]: Point, radius: f64) -> Profile {
    let r = radius.min(w / 2. - TOL).min(h / 2. - TOL);
    if r <= TOL {
        return planar(
            &vec![vec![
                [x - w / 2., y - h / 2.],
                [x + w / 2., y - h / 2.],
                [x + w / 2., y + h / 2.],
                [x - w / 2., y + h / 2.],
            ]],
            0.,
        );
    }
    let (a, b) = (w / 2. - r, h / 2. - r);
    let corners = [
        [x + a, y + b, 0.],
        [x - a, y + b, 0.],
        [x - a, y - b, 0.],
        [x + a, y - b, 0.],
    ];
    let offsets = [[r, 0., 0.], [0., r, 0.], [-r, 0., 0.], [0., -r, 0.]];
    let shift = |p: [f64; 3], d: [f64; 3]| [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    let mut edges = Vec::with_capacity(8);
    for (i, &corner) in corners.iter().enumerate() {
        let next = (i + 1) % 4;
        edges.push(ProfileEdge::Arc {
            frame: Frame::new(corner, Z, [1., 0., 0.]),
            r,
            span: Some([i as f64 * FRAC_PI_2, (i + 1) as f64 * FRAC_PI_2]),
        });
        edges.push(ProfileEdge::Line {
            a: shift(corner, offsets[next]),
            b: shift(corners[next], offsets[next]),
        });
    }
    Profile {
        origin: [x, y, 0.],
        normal: Z,
        loops: vec![edges],
        names: Vec::new(),
    }
}

pub fn planar(rings: &Rings, fit: f64) -> Profile {
    let loops = rings
        .iter()
        .map(|points| {
            let count = points.len();
            let corners: Vec<_> = points
                .iter()
                .enumerate()
                .map(|(i, &[x, y])| {
                    let p = [x, y, 0.];
                    if fit <= 0. {
                        return (p, p, None);
                    }
                    let a = points[(i + count - 1) % count];
                    let b = points[(i + 1) % count];
                    let length = |q: Point| (q[0] - x).hypot(q[1] - y);
                    let (la, lb) = (length(a), length(b));
                    if la.min(lb) < 0.08 {
                        return (p, p, None);
                    }
                    let u = [(a[0] - x) / la, (a[1] - y) / la, 0.];
                    let v = [(b[0] - x) / lb, (b[1] - y) / lb, 0.];
                    if !(-0.9995..-0.35).contains(&dot(u, v)) {
                        return (p, p, None);
                    }
                    // A quadratic's distance from the original corner is bounded by
                    // the trim distance. Shorten it to stay within the fit budget.
                    let trim = 0.15_f64.min(0.24 * la).min(0.24 * lb).min(fit);
                    let a = [x + trim * u[0], y + trim * u[1], 0.];
                    let b = [x + trim * v[0], y + trim * v[1], 0.];
                    let curve = BSpline {
                        degree: 2,
                        knots: vec![0., 0., 0., 1., 1., 1.],
                        poles: vec![a, p, b],
                        weights: None,
                    };
                    (a, b, Some(ProfileEdge::Spline(Arc::new(curve))))
                })
                .collect();
            let mut wire = Vec::new();
            for i in 0..count {
                let (a, _, curve) = &corners[i];
                let b = corners[(i + count - 1) % count].1;
                wire.push(ProfileEdge::Line { a: b, b: *a });
                if let Some(curve) = curve {
                    wire.push(curve.clone());
                }
            }
            wire
        })
        .collect();
    Profile {
        origin: [0.; 3],
        normal: Z,
        loops,
        names: Vec::new(),
    }
}

/// A rounded rectangle in the vertical XZ plane, with only its bottom corners rounded.
pub fn slot_inset(radius: f64, height: f64) -> f64 {
    if height >= radius {
        return 0.;
    }
    radius - (radius * radius - (height - radius).powi(2)).sqrt()
}

pub fn finger_slot(w: f64, r: f64, height: f64) -> Profile {
    let (left, right) = (-w / 2., w / 2.);
    let n = [0., -1., 0.];
    let p = |x, z| [x, 0., z];
    let h = height.min(r);
    let right_angle = ((h - r) / r).asin();
    let left_angle = PI - right_angle;
    let inset = slot_inset(r, height);
    let mut edges = vec![
        ProfileEdge::Line {
            a: p(left + r, 0.),
            b: p(right - r, 0.),
        },
        ProfileEdge::Arc {
            frame: Frame::new(p(right - r, r), n, [1., 0., 0.]),
            r,
            span: Some([-FRAC_PI_2, right_angle]),
        },
    ];
    if height > r {
        edges.push(ProfileEdge::Line {
            a: p(right, r),
            b: p(right, height),
        });
    }
    edges.push(ProfileEdge::Line {
        a: p(right - inset, height),
        b: p(left + inset, height),
    });
    if height > r {
        edges.push(ProfileEdge::Line {
            a: p(left, height),
            b: p(left, r),
        });
    }
    edges.push(ProfileEdge::Arc {
        frame: Frame::new(p(left + r, r), n, [1., 0., 0.]),
        r,
        span: Some([left_angle, PI + FRAC_PI_2]),
    });
    Profile {
        origin: [0.; 3],
        normal: n,
        loops: vec![edges],
        names: Vec::new(),
    }
}

pub fn scaled_loft(
    profile: &Profile,
    [x, y]: Point,
    [sx, sy]: Point,
    z0: f64,
    z1: f64,
) -> Result<Brep, String> {
    let strips = profile
        .loops
        .iter()
        .map(|wire| {
            wire.iter()
                .map(|edge| {
                    let points = match edge {
                        ProfileEdge::Line { a, b } => vec![*a, *b],
                        ProfileEdge::Spline(spline) if spline.weights.is_none() => {
                            spline.poles.clone()
                        }
                        _ => return Err("chamfer requires a planar polygon or fitted curve"),
                    };
                    let count = points.len();
                    let poles = points
                        .into_iter()
                        .map(|[px, py, _]| {
                            vec![[px, py, z0], [x + (px - x) * sx, y + (py - y) * sy, z1]]
                        })
                        .collect();
                    Ok(Net {
                        du: count - 1,
                        dv: 1,
                        uknots: [vec![0.; count], vec![1.; count]].concat(),
                        vknots: vec![0., 0., 1., 1.],
                        poles,
                        weights: None,
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut body = lofted([0.; 3], Z, [z0, z1], strips)?;
    // Keep genuinely planar strips analytic. The remaining strips preserve
    // the ruled surface between the two profiles.
    for edge in &mut body.edges {
        if let EdgeCurve::Curve(Curve::BSpline(curve)) = &edge.curve {
            if curve.degree == 1 && curve.poles.len() == 2 {
                let [a, b] = [curve.poles[0], curve.poles[1]];
                let delta = sub(b, a);
                let length = norm(delta);
                if length > 0. {
                    // The kernel projects onto a unit direction. Keep the
                    // endpoints in place by expressing the span in millimetres.
                    edge.curve = EdgeCurve::Curve(Curve::Line {
                        p: a,
                        d: delta.map(|coordinate| coordinate / length),
                    });
                    edge.t = edge.t.map(|t| t * length);
                }
            }
        }
    }
    for face in &mut body.faces {
        let Surface::BSpline(_, net) = &face.surface else {
            continue;
        };
        if net.du != 1 {
            continue;
        }
        let a = net.poles[0][0];
        let u = sub(net.poles[1][0], a);
        let v = sub(net.poles[0][1], a);
        let Some(normal) = normalised(cross(u, v)) else {
            continue;
        };
        if dot(normal, sub(net.poles[1][1], a)).abs() > TOL {
            continue;
        }
        face.surface = Surface::Plane(Frame::new(a, normal, u));
        for coedge in face.loops.iter_mut().flatten() {
            let edge = &body.edges[coedge.edge as usize];
            let [a, b] = edge
                .t
                .map(|t| face.surface.inverse(edge.point(t, &body.vertices)));
            coedge.pcurve = Pcurve::Line { a, b };
        }
    }
    Ok(body)
}
