from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.api.v1.sessions import router as sessions_router
from app.api.v1.tools import router as tools_router
from app.db.session import init_db
from app.providers.payments.factory import get_payment_provider


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize database tables and resources on application startup, and cleanup on shutdown."""
    init_db()
    yield
    provider = get_payment_provider()
    if hasattr(provider, "close"):
        provider.close()


app = FastAPI(
    title="AgentShield API",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(tools_router, prefix="/api/v1")
app.include_router(sessions_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}
