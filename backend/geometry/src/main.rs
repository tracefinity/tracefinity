mod bin;
mod input;
mod output;
mod profile;
mod solid;

use std::path::{Path, PathBuf};

enum BuildError {
    Geometry(String),
    BinMesh(String),
    Other(String),
}

impl From<String> for BuildError {
    fn from(error: String) -> Self {
        Self::Other(error)
    }
}

fn build(request: &input::Job, directory: &Path) -> Result<(), BuildError> {
    let model = bin::generate(request).map_err(BuildError::Geometry)?;
    model
        .full
        .check(profile::TOL)
        .map_err(|e| BuildError::Geometry(format!("bin topology: {e}")))?;
    std::thread::scope(|scope| {
        let step = scope
            .spawn(|| output::step(&model.full, "Tracefinity bin", &directory.join("bin.step")));
        output::stl(&model.full, &directory.join("bin.stl")).map_err(|error| {
            if error.starts_with(output::TESSELLATION_ERROR) {
                BuildError::BinMesh(error)
            } else {
                BuildError::Other(error)
            }
        })?;
        for (i, part) in output::parts(&model.full, request.separate, &request.splits)?
            .iter()
            .enumerate()
        {
            output::stl(part, &directory.join(format!("part{:03}.stl", i + 1)))?;
        }
        if !model.labels.faces.is_empty() {
            output::stl(&model.material, &directory.join("material.stl"))?;
            output::stl(&model.labels, &directory.join("labels.stl"))?;
        }
        if !model.insert.faces.is_empty() {
            output::stl(&model.insert, &directory.join("insert.stl"))?;
            output::step(
                &model.insert,
                "Contrast insert",
                &directory.join("insert.step"),
            )?;
        }
        step.join()
            .map_err(|_| "STEP writer panicked".to_string())??;
        Ok(())
    })
}

fn run() -> Result<(), String> {
    let directory = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("output directory is required")?;
    let mut request: input::Job = serde_json::from_reader(std::io::stdin().lock())
        .map_err(|e| format!("read bin geometry: {e}"))?;
    let result = match build(&request, &directory) {
        Err(BuildError::Geometry(error)) => {
            // Nearly coincident rotated faces can leave slivers below the
            // kernel's resolution. Only round angles after exact geometry fails.
            let mut changed = false;
            for finger in &mut request.fingers {
                changed |= finger.round_angle_for_retry();
            }
            if !changed {
                return Err(error);
            }
            build(&request, &directory)
        }
        Err(BuildError::BinMesh(error)) => {
            let cylinders: Vec<_> = request
                .fingers
                .iter_mut()
                .filter(|f| matches!(f.shape, input::FingerShape::Cylinder))
                .collect();
            if cylinders.is_empty() {
                return Err(error);
            }
            // A line of contact between a cylinder and another pocket makes a
            // pinched solid. Give the cutter 5 µm of relief and rebuild both exports.
            for finger in cylinders {
                finger.radius += 0.005;
            }
            build(&request, &directory)
        }
        result => result,
    };
    result.map_err(|error| match error {
        BuildError::Geometry(message)
        | BuildError::BinMesh(message)
        | BuildError::Other(message) => message,
    })
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}
