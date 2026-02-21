"""
One-shot script to capture mock fixtures from a real Gemini trace.
Requires GOOGLE_API_KEY env var with a valid key.

Usage:
    cd backend
    source venv/bin/activate
    GOOGLE_API_KEY=your-key python tests/generate_fixtures.py path/to/tool.jpg
"""

import asyncio
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.ai_tracer import AITracer
from app.services.image_processor import ImageProcessor

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


async def main():
    if len(sys.argv) < 2:
        print("usage: python tests/generate_fixtures.py <image.jpg>")
        sys.exit(1)

    import os
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("set GOOGLE_API_KEY env var")
        sys.exit(1)

    image_path = sys.argv[1]
    if not Path(image_path).exists():
        print(f"image not found: {image_path}")
        sys.exit(1)

    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    mask_path = str(FIXTURES_DIR / "mock_mask.png")

    tracer = AITracer()
    polygons, _ = await tracer.trace_tools(image_path, api_key, mask_path)

    poly_data = []
    for p in polygons:
        poly_data.append({
            "id": p.id,
            "label": p.label,
            "points": [{"x": pt.x, "y": pt.y} for pt in p.points],
            "interior_rings": [
                [{"x": pt.x, "y": pt.y} for pt in ring]
                for ring in p.interior_rings
            ],
        })

    json_path = FIXTURES_DIR / "mock_polygons.json"
    json_path.write_text(json.dumps(poly_data, indent=2))

    print(f"saved {len(polygons)} polygons to {json_path}")
    print(f"saved mask to {mask_path}")


if __name__ == "__main__":
    asyncio.run(main())
