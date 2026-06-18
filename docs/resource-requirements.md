# Resource Requirements

## RAM

Two models run simultaneously: a tracer for tool outlines and U2-Net Portable for paper detection. U2-Net always runs locally regardless of tracing mode, establishing a ~2GB floor.

| Mode | Tracer RAM | Total (with U2-Net) |
|-|-|-|
| IS-Net (default) | ~0.5GB | ~2GB |
| InSPyReNet | ~4GB | ~6GB |
| BiRefNet Lite | ~6GB | ~8GB |
| Gemini API | none (remote) | ~2GB |
| Replicate / fal | none (remote) | ~2GB |

RAM figures are measured in Linux containers with both models loaded. Models load at startup and stay resident.

## CPU

Any modern x86-64 processor. All local models use ONNX Runtime on CPU by default. CUDA acceleration is available for NVIDIA GPUs (see README).

ARM is supported: the Docker image ships linux/arm64 builds. Raspberry Pi 4/5 with 4GB+ RAM works (IS-Net or a remote tracer).

## Disk

Storage scales with usage. Rough sizing:

| What | Size |
|-|-|
| Docker image | ~2.5GB (includes model weights) |
| Model weights (from-source, first run) | ~500MB downloaded |
| Per photo (corrected + masks) | ~2-5MB |
| Per tool (JSON + SVG) | ~10-50KB |
| Per bin (JSON + STL/3MF) | ~1-10MB |

A volume with 1GB free is plenty for a personal tool library of a few hundred tools and dozens of bins. Scale accordingly for shared instances.

## Docker Resource Limits

Sensible `--memory` defaults based on tracer choice:

```bash
# IS-Net or remote tracer (Gemini/Replicate/fal)
docker run --memory=3g -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity

# InSPyReNet
docker run --memory=8g -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity

# BiRefNet Lite
docker run --memory=10g -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity
```

Headroom above the model figures accounts for OpenCV image processing, STL generation, and the Node.js frontend server.

### Kubernetes / Helm

Set `resources.requests.memory` to match the tracer. Example for IS-Net:

```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "500m"
  limits:
    memory: "3Gi"
```

For BiRefNet Lite, request 8Gi with a limit of 10Gi. The 128Mi placeholder in early Helm values is not viable for any configuration.

## Platform Support

| Platform | Status |
|-|-|
| linux/amd64 | Supported |
| linux/arm64 | Supported (Apple Silicon via Docker Desktop, Pi 4/5) |
| macOS (from source) | Works on Intel and Apple Silicon |
| Windows (from source) | Works via WSL2 or native Python/Node |
