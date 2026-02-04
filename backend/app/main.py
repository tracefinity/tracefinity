from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.api.routes import router

app = FastAPI(title="Tracefinity API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=str(settings.storage_path)), name="storage")
app.include_router(router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
