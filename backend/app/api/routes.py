import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, UploadFile, HTTPException
from fastapi.responses import FileResponse

from app.config import settings
from app.models.schemas import (
    UploadResponse,
    CornersRequest,
    CornersResponse,
    TraceRequest,
    TraceResponse,
    PolygonsRequest,
    GenerateRequest,
    GenerateResponse,
    Session,
    SessionSummary,
    SessionListResponse,
    SessionUpdateRequest,
    StatusResponse,
    Point,
    Polygon,
)
from app.services.image_processor import ImageProcessor
from app.services.ai_tracer import AITracer
from app.services.polygon_scaler import PolygonScaler
from app.services.stl_generator import STLGenerator
from app.services.session_store import SessionStore

router = APIRouter()

sessions = SessionStore(settings.storage_path)

image_processor = ImageProcessor()
ai_tracer = AITracer()
polygon_scaler = PolygonScaler()
stl_generator = STLGenerator()


@router.post("/upload", response_model=UploadResponse)
async def upload_image(image: UploadFile):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="file must be an image")

    session_id = str(uuid.uuid4())
    ext = Path(image.filename or "image.jpg").suffix or ".jpg"
    image_path = settings.storage_path / "uploads" / f"{session_id}{ext}"

    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = await image.read()
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"file too large (max {settings.max_upload_mb}MB)")
    image_path.write_bytes(content)

    corners = image_processor.detect_paper_corners(str(image_path))
    corner_points = [Point(x=c[0], y=c[1]) for c in corners] if corners else None

    sessions.set(session_id, Session(
        id=session_id,
        created_at=datetime.utcnow().isoformat(),
        original_image_path=str(image_path),
        corners=corner_points,
    ))

    return UploadResponse(
        session_id=session_id,
        image_url=f"/storage/uploads/{session_id}{ext}",
        detected_corners=corner_points,
    )


@router.post("/sessions/{session_id}/corners", response_model=CornersResponse)
async def set_corners(session_id: str, req: CornersRequest):
    session = sessions.get(session_id)
    if not session or not session.original_image_path:
        raise HTTPException(status_code=404, detail="session not found")

    corners = [(p.x, p.y) for p in req.corners]
    output_path, scale_factor = image_processor.apply_perspective_correction(
        session.original_image_path, corners, req.paper_size
    )

    session.corrected_image_path = output_path
    session.corners = req.corners
    session.paper_size = req.paper_size
    session.scale_factor = scale_factor
    sessions.set(session_id, session)

    rel_path = Path(output_path).relative_to(settings.storage_path)
    return CornersResponse(
        corrected_image_url=f"/storage/{rel_path}",
        scale_factor=scale_factor,
    )


@router.get("/api-keys")
async def get_available_keys():
    """check which api keys are configured via env vars"""
    return {
        "google": settings.google_api_key is not None,
    }


@router.post("/sessions/{session_id}/trace", response_model=TraceResponse)
async def trace_tools(session_id: str, req: TraceRequest):
    session = sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=400, detail="must set corners first")

    api_key = req.api_key
    if not api_key and settings.google_api_key:
        api_key = settings.google_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="no api key provided")

    mask_output_path = str(settings.storage_path / "processed" / f"{session_id}_mask.png")

    try:
        polygons, mask_path = await ai_tracer.trace_tools(
            session.corrected_image_path,
            api_key,
            mask_output_path,
        )
    except Exception as e:
        error_msg = str(e)
        if "insufficient_quota" in error_msg or "exceeded" in error_msg.lower():
            raise HTTPException(status_code=402, detail="API quota exceeded - check your billing")
        if "invalid_api_key" in error_msg or "Incorrect API key" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid API key")
        if "rate_limit" in error_msg.lower():
            raise HTTPException(status_code=429, detail="Rate limited - try again shortly")
        raise HTTPException(status_code=500, detail=f"AI tracing failed: {error_msg[:200]}")

    session.polygons = polygons
    session.mask_image_path = mask_path
    sessions.set(session_id, session)

    mask_url = None
    if mask_path:
        mask_url = f"/storage/processed/{session_id}_mask.png"

    return TraceResponse(polygons=polygons, mask_url=mask_url)


@router.post("/sessions/{session_id}/trace-mask", response_model=TraceResponse)
async def trace_from_mask(session_id: str, mask: UploadFile):
    """trace contours from a user-uploaded mask image"""
    session = sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=400, detail="must set corners first")

    if not mask.content_type or not mask.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="file must be an image")

    # save the uploaded mask
    mask_path = settings.storage_path / "processed" / f"{session_id}_mask.png"
    content = await mask.read()
    mask_path.write_bytes(content)

    # trace contours from the mask
    contours = ai_tracer._trace_mask(str(mask_path), session.corrected_image_path)

    if not contours:
        raise HTTPException(status_code=400, detail="no tool outlines found in mask")

    # convert to polygons
    polygons = []
    for i, contour in enumerate(contours):
        polygons.append(Polygon(
            id=str(uuid.uuid4()),
            points=[Point(x=p[0], y=p[1]) for p in contour],
            label=f"tool {i + 1}",
        ))

    session.polygons = polygons
    session.mask_image_path = str(mask_path)
    sessions.set(session_id, session)

    return TraceResponse(
        polygons=polygons,
        mask_url=f"/storage/processed/{session_id}_mask.png"
    )


@router.put("/sessions/{session_id}/polygons", response_model=StatusResponse)
async def update_polygons(session_id: str, req: PolygonsRequest):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    session.polygons = req.polygons
    sessions.set(session_id, session)
    return StatusResponse(status="ok")


@router.post("/sessions/{session_id}/generate", response_model=GenerateResponse)
async def generate_stl(session_id: str, req: GenerateRequest):
    session = sessions.get(session_id)
    if not session or not session.scale_factor:
        raise HTTPException(status_code=400, detail="must trace tools first")

    # use polygons from request if provided, otherwise fall back to session
    polygons = req.polygons if req.polygons else session.polygons
    if not polygons:
        raise HTTPException(status_code=400, detail="no polygons to generate from")

    scaled = polygon_scaler.scale_to_mm(polygons, session.scale_factor)
    scaled = [polygon_scaler.add_clearance(p, req.cutout_clearance) for p in scaled]

    output_path = settings.storage_path / "outputs" / f"{session_id}.stl"
    stl_generator.generate_bin(scaled, req, str(output_path))

    session.stl_path = str(output_path)
    sessions.set(session_id, session)
    return GenerateResponse(stl_url=f"/storage/outputs/{session_id}.stl")


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions():
    all_sessions = sessions.all()
    summaries = []
    for sid, session in all_sessions.items():
        # determine thumbnail url
        thumbnail_url = None
        if session.corrected_image_path:
            rel_path = Path(session.corrected_image_path).relative_to(settings.storage_path)
            thumbnail_url = f"/storage/{rel_path}"
        elif session.original_image_path:
            rel_path = Path(session.original_image_path).relative_to(settings.storage_path)
            thumbnail_url = f"/storage/{rel_path}"

        summaries.append(SessionSummary(
            id=sid,
            name=session.name,
            description=session.description,
            tags=session.tags or [],
            created_at=session.created_at,
            thumbnail_url=thumbnail_url,
            tool_count=len(session.polygons) if session.polygons else 0,
            has_stl=session.stl_path is not None,
        ))

    # sort by created_at descending (newest first)
    summaries.sort(key=lambda s: s.created_at or "", reverse=True)
    return SessionListResponse(sessions=summaries)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.patch("/sessions/{session_id}", response_model=StatusResponse)
async def update_session(session_id: str, req: SessionUpdateRequest):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    if req.name is not None:
        session.name = req.name
    if req.description is not None:
        session.description = req.description
    if req.tags is not None:
        session.tags = req.tags
    sessions.set(session_id, session)
    return StatusResponse(status="ok")


@router.delete("/sessions/{session_id}", response_model=StatusResponse)
async def delete_session(session_id: str):
    session = sessions.delete(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    for path in [
        session.original_image_path,
        session.corrected_image_path,
        session.stl_path,
    ]:
        if path:
            Path(path).unlink(missing_ok=True)

    return StatusResponse(status="deleted")


@router.get("/sessions/{session_id}/debug")
async def debug_session(session_id: str):
    """generate debug images showing contour detection steps"""
    session = sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=404, detail="session not found or no corrected image")

    debug_dir = settings.storage_path / "debug" / session_id
    debug_dir.mkdir(parents=True, exist_ok=True)

    results = image_processor.debug_contour_detection(
        session.corrected_image_path, debug_dir
    )

    # add url prefix to image paths
    for key in results:
        if isinstance(results[key], str) and results[key].endswith(".jpg"):
            results[key] = f"/storage/debug/{session_id}/{results[key]}"

    return results


@router.get("/files/{session_id}/bin.stl")
async def download_stl(session_id: str):
    session = sessions.get(session_id)
    if not session or not session.stl_path:
        raise HTTPException(status_code=404, detail="stl not found")

    return FileResponse(
        session.stl_path,
        media_type="application/sla",
        filename=f"tracefinity-{session_id[:8]}.stl",
    )
