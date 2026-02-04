# Tracefinity

Generate custom gridfinity bins from photos of your tools.

## How It Works

1. Place tools on A4/Letter paper
2. Take a photo from above
3. Upload and adjust paper corners for scale calibration
4. AI traces tool outlines automatically
5. Configure bin size, depth, and features
6. Download STL for 3D printing

## Quick Start

### Docker (Recommended)

```bash
docker build -t tracefinity .
docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key tracefinity
```

This mounts `./data` for persistent storage of uploads and generated STLs.

Open http://localhost:3000

### Manual Setup

Prerequisites: Python 3.11+, Node.js 20+

```bash
git clone https://github.com/yourusername/tracefinity
cd tracefinity
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Features

- **AI-powered tracing** - Gemini vision generates accurate tool silhouettes
- **Manual mask upload** - Use Gemini web interface if you don't have an API key
- **Manual refinement** - Edit traced outlines with vertex tools
- **Gridfinity compatible** - Proper base profile, magnet holes, stacking lip
- **Finger holes** - Add circular, square, or rectangular cutouts
- **Live 3D preview** - See your bin before printing
- **Dark mode** - Easy on the eyes

## Configuration

Environment variables (`.env` in project root):

```bash
# Required for AI tracing (or use manual mask upload)
GOOGLE_API_KEY=your-gemini-api-key

# Backend settings
STORAGE_PATH=./storage
CORS_ORIGINS=["http://localhost:3000","http://localhost:3001"]
MAX_UPLOAD_MB=20

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Manual Mask Upload

No API key? No problem:

1. Upload your photo and set paper corners
2. Click "Manual" and download the corrected image
3. Open [Gemini](https://gemini.google.com) and paste the image with the provided prompt
4. Download the generated mask (black tools on white background)
5. Upload the mask back to Tracefinity

## Gridfinity Specs

| Parameter | Value |
|-----------|-------|
| Grid unit | 42mm |
| Height unit | 7mm |
| Magnet diameter | 6mm |
| Magnet depth | 2.4mm |

## Tech Stack

- **Backend**: FastAPI, OpenCV, gridfinity_build123d
- **Frontend**: Next.js 15, React, TypeScript, Tailwind
- **AI**: Google Gemini (gemini-3-pro-image-preview)

## Licence

MIT
