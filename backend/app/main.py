from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.api.v1.agent import router as agent_router
from app.api.v1.approvals import router as approvals_router
from app.api.v1.audit import router as audit_router
from app.api.v1.sessions import router as sessions_router
from app.api.v1.tools import router as tools_router
from app.api.v1.transactions import router as transactions_router
from app.config import get_settings
from app.db.migrations import upgrade_database
from app.providers.payments.factory import get_payment_provider


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize database tables and resources on application startup, and cleanup on shutdown."""
    if get_settings().MIGRATE_ON_STARTUP:
        upgrade_database()
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
app.include_router(audit_router, prefix="/api/v1")
app.include_router(transactions_router, prefix="/api/v1")
app.include_router(approvals_router, prefix="/api/v1")
app.include_router(agent_router, prefix="/api/v1")


@app.get("/health")
def health():
    settings = get_settings()
    has_rzp = bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)
    has_nim = bool(settings.NVIDIA_API_KEY)
    return {
        "status": "ok",
        "provider": settings.PAYMENT_PROVIDER,
        "razorpay_configured": has_rzp,
        "razorpay_key_id": settings.RAZORPAY_KEY_ID[:8] + "..." if settings.RAZORPAY_KEY_ID else None,
        "llm_provider": "nvidia" if has_nim else "none",
        "nvidia_configured": has_nim,
        "model": settings.NVIDIA_MODEL,
        "environment": settings.ENVIRONMENT,
    }
