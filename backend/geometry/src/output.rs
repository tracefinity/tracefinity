use cad_kernel::build::kept;
use cad_kernel::geom::Frame;
use cad_kernel::mesh::{Mesh, mesh};
use cad_kernel::step::{self, Assembly, Product, Usage};
use cad_kernel::topo::Brep;
use cad_kernel::util::space::{cross, norm, sub};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use crate::profile::TOL;
use crate::solid::components;

pub const TESSELLATION_ERROR: &str = "tessellation: ";

fn checked_mesh(body: &Brep, sag: f64, angle: f64) -> Result<Mesh, String> {
    let mesh = mesh(body, sag, angle)?;
    // STL has no shared vertex indices. Check the edges a slicer sees after
    // welding identical 32-bit coordinates, including coincident CAD seams.
    let mut vertices = HashMap::with_capacity(mesh.pts.len());
    let ids: Vec<_> = mesh
        .pts
        .iter()
        .enumerate()
        .map(|(index, point)| {
            let key = point.map(|coordinate| {
                let value = coordinate as f32;
                if value == 0. { 0 } else { value.to_bits() }
            });
            *vertices.entry(key).or_insert(index as u32)
        })
        .collect();
    let mut edges = HashMap::with_capacity(mesh.tris.len() * 3 / 2);
    for triangle in &mesh.tris {
        let [a, b, c] = triangle.map(|index| ids[index as usize]);
        for (from, to) in [(a, b), (b, c), (c, a)] {
            let edge = edges.entry((from.min(to), from.max(to))).or_insert(0i8);
            let direction = if from < to { 1 } else { -1 };
            match *edge {
                0 if from != to => *edge = direction,
                count if count == -direction => *edge = 2,
                _ => return Err("STL has a collapsed or non-manifold edge".into()),
            }
        }
    }
    if edges.is_empty() || edges.values().any(|&count| count != 2) {
        return Err("STL does not enclose a solid".into());
    }
    Ok(mesh)
}

pub fn stl(body: &Brep, path: &Path) -> Result<(), String> {
    let mesh = checked_mesh(body, 0.01, 0.15)
        .or_else(|_| checked_mesh(body, 0.002, 0.07))
        .map_err(|error| format!("{TESSELLATION_ERROR}{error}"))?;
    let write = || -> std::io::Result<()> {
        let mut file = BufWriter::new(File::create(path)?);
        file.write_all(&[0; 80])?;
        file.write_all(&(mesh.tris.len() as u32).to_le_bytes())?;
        for indices in &mesh.tris {
            let [a, b, c] = indices.map(|i| mesh.pts[i as usize]);
            let n = cross(sub(b, a), sub(c, a));
            let length = norm(n);
            for value in n
                .map(|v| if length == 0. { 0. } else { v / length })
                .into_iter()
                .chain(a)
                .chain(b)
                .chain(c)
            {
                file.write_all(&(value as f32).to_le_bytes())?;
            }
            file.write_all(&[0; 2])?;
        }
        file.flush()
    };
    write().map_err(|e| format!("write STL: {e}"))
}

pub fn step(body: &Brep, name: &str, path: &Path) -> Result<(), String> {
    let mut solids = components(body);
    let content = if solids.len() == 1 {
        step::write(&solids.pop().unwrap(), name, TOL)
    } else {
        let mut products = vec![Product {
            name: name.into(),
            solid: None,
            colour: None,
        }];
        products.extend(solids.into_iter().enumerate().map(|(i, solid)| Product {
            name: format!("{name} {}", i + 1),
            solid: Some(solid),
            colour: None,
        }));
        let uses = (1..products.len())
            .map(|i| Usage {
                parent: 0,
                child: i,
                name: format!("Part {i}"),
                placement: Frame::WORLD,
            })
            .collect();
        step::write_assembly(&Assembly { products, uses }, name, TOL)
    }
    .map_err(|e| format!("write STEP: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("save STEP: {e}"))
}

pub fn parts(body: &Brep, separate: bool, splits: &[Vec<f64>; 2]) -> Result<Vec<Brep>, String> {
    if separate {
        let bodies = components(body);
        if bodies.len() > 1 {
            return Ok(bodies);
        }
    }
    let mut parts = vec![body.clone()];
    for (axis, cuts) in splits.iter().enumerate() {
        for &offset in cuts {
            let mut next = Vec::new();
            for part in parts {
                let bounds = part.bounds();
                if bounds.0[axis] + TOL < offset && bounds.1[axis] - TOL > offset {
                    let mut origin = [0.; 3];
                    origin[axis] = offset;
                    let mut normal = [0.; 3];
                    normal[axis] = 1.;
                    for direction in [normal, normal.map(|v| -v)] {
                        let piece = kept(&part, origin, direction, 0.)?;
                        if !piece.faces.is_empty() {
                            next.push(piece);
                        }
                    }
                } else {
                    next.push(part);
                }
            }
            parts = next;
        }
    }
    if parts.len() == 1 {
        return Ok(Vec::new());
    }
    Ok(parts)
}
