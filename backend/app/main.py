from fastapi import FastAPI

from app.api.v1.sessions import router as sessions_router
from app.api.v1.tools import router as tools_router

app = FastAPI(
    title="AgentShield API",
    version="0.1.0",
)

app.include_router(tools_router, prefix="/api/v1")
app.include_router(sessions_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}
