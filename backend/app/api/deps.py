"""FastAPI dependencies for AgentShield."""

from collections.abc import Iterator

from fastapi import Depends
from sqlalchemy.orm import Session

from app.agentshield.executor import AgentShield
from app.db.session import get_db
from app.db.stores import (
    SqlAlchemyApprovalStore,
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.config import get_settings
from app.providers.llm.base import LLMProvider
from app.providers.llm.nvidia import NvidiaNIMProvider
from app.providers.payments.base import PaymentProvider
from app.providers.payments.factory import get_payment_provider


def get_llm_provider() -> Iterator[LLMProvider | None]:
    """Yield hosted NIM only when backend credentials are configured."""
    settings = get_settings()
    provider: LLMProvider | None = None
    if settings.NVIDIA_API_KEY:
        provider = NvidiaNIMProvider(
            api_key=settings.NVIDIA_API_KEY,
            base_url=settings.NVIDIA_BASE_URL,
            model=settings.NVIDIA_MODEL,
            timeout_seconds=settings.NVIDIA_TIMEOUT_SECONDS,
        )
    try:
        yield provider
    finally:
        if provider is not None and hasattr(provider, "close"):
            provider.close()


def get_shield(
    db: Session = Depends(get_db),
    payment_provider: PaymentProvider = Depends(get_payment_provider),
    llm_provider: LLMProvider | None = Depends(get_llm_provider),
) -> AgentShield:
    """Construct an AgentShield instance backed by durable database stores."""
    policy_provider = SqlAlchemyPolicyProvider(db)
    intent_provider = SqlAlchemyIntentProvider(db)
    transaction_store = SqlAlchemyTransactionStore(db)
    audit_sink = SqlAlchemyAuditSink(db)
    approval_store = SqlAlchemyApprovalStore(db)

    return AgentShield(
        policy_or_provider=policy_provider,
        payment_provider=payment_provider,
        transaction_store=transaction_store,
        audit_sink=audit_sink,
        intent_provider=intent_provider,
        llm_provider=llm_provider,
        approval_store=approval_store,
    )
