"""Build the locked worker with the edge-index fix for cad-kernel's STEP writer."""

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "target"


def build():
    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--format-version", "1", "--locked"], cwd=ROOT,
    ))
    kernel = next(package for package in metadata["packages"] if package["name"] == "cad-kernel")
    source = Path(kernel["manifest_path"]).parent
    staging = TARGET / "patched-build"
    staging.mkdir(parents=True, exist_ok=True)

    # Cargo verifies the registry archive against Cargo.lock. Copy just this
    # dependency before applying the patch so other builds keep their sources.
    patched = staging / "cad-kernel"
    shutil.copytree(source, patched, dirs_exist_ok=True)
    writer = patched / "src/step.rs"
    original = writer.read_text()
    anchor = "    let edges: Vec<Option<usize>> = b.edges.iter().enumerate()"
    start = original.index("        let uses: Vec<(usize,&super::topo::Coedge)> = b.faces.iter().enumerate()")
    end = original.index("        let seam =", start)
    assert original.count(anchor) == 1
    updated = original[:start] + """        let uses = &edge_uses[ei];
        let pcurves: Vec<String> = uses.iter().map(|&(fi,li,ci)| {
            let coedge = &b.faces[fi].loops[li][ci];
            format!("#{}",pcurve(o,b,fi,coedge,surfaces[fi],context2,tol,nets[fi].as_ref()))
        }).collect();
""" + original[end:]
    writer.write_text(updated.replace(anchor, "    let edge_uses = b.uses();\n" + anchor))

    manifest = (ROOT / "Cargo.toml").read_text()
    (staging / "Cargo.toml").write_text(manifest + '\n[patch.crates-io]\ncad-kernel = { path = "cad-kernel" }\n')
    shutil.copy2(ROOT / "Cargo.lock", staging / "Cargo.lock")
    shutil.copytree(ROOT / "src", staging / "src", dirs_exist_ok=True)
    subprocess.run(
        ["cargo", "build", "--offline", "--release", "--target-dir", str(TARGET)],
        cwd=staging, check=True,
    )


if __name__ == "__main__":
    build()
