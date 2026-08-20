"""FastAPI dependencies for AgentShield."""

from fastapi import Depends
from sqlalchemy.orm import Session

from app.agentshield.executor import AgentShield
from app.db.session import get_db
from app.db.stores import (
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.providers.payments.base import PaymentProvider
from app.providers.payments.factory import get_payment_provider


def get_shield(
    db: Session = Depends(get_db),
    payment_provider: PaymentProvider = Depends(get_payment_provider),
) -> AgentShield:
    """Construct an AgentShield instance backed by durable database stores."""
    policy_provider = SqlAlchemyPolicyProvider(db)
    intent_provider = SqlAlchemyIntentProvider(db)
    transaction_store = SqlAlchemyTransactionStore(db)
    audit_sink = SqlAlchemyAuditSink(db)

    return AgentShield(
        policy_or_provider=policy_provider,
        payment_provider=payment_provider,
        transaction_store=transaction_store,
        audit_sink=audit_sink,
        intent_provider=intent_provider,
    )
