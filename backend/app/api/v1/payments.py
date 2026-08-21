"""Payment gateway configuration and signature verification endpoints."""

import hashlib
import hmac
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.agentshield.executor import AgentShield
from app.agentshield.transaction import TransactionStatus
from app.api.deps import get_shield
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


class PaymentConfigResponse(BaseModel):
    """Public payment gateway configuration for client checkout."""

    provider: str
    key_id: str | None
    currency: str
    sandbox_mode: bool
    description: str


class VerifyPaymentRequest(BaseModel):
    """Payment verification payload received from Razorpay standard checkout."""

    session_id: str = Field(description="Session identifier")
    razorpay_order_id: str = Field(description="Order ID returned by Razorpay")
    razorpay_payment_id: str = Field(description="Payment ID returned by Razorpay Checkout")
    razorpay_signature: str = Field(description="HMAC SHA256 signature returned by Razorpay Checkout")
    transaction_id: str | None = Field(default=None, description="Optional AgentShield transaction ID")


class VerifyPaymentResponse(BaseModel):
    """Result of payment verification and transaction state transition."""

    verified: bool
    transaction_id: str | None
    status: str
    message: str
    order_id: str
    payment_id: str


@router.get("/config", response_model=PaymentConfigResponse)
def get_payment_config() -> PaymentConfigResponse:
    """Return public Razorpay configuration for client checkout initialization."""
    settings = get_settings()
    return PaymentConfigResponse(
        provider=settings.PAYMENT_PROVIDER,
        key_id=settings.RAZORPAY_KEY_ID,
        currency="INR",
        sandbox_mode=True,
        description="AgentShield Autonomous Agent Financial Authorization",
    )


@router.post("/verify", response_model=VerifyPaymentResponse)
def verify_payment(
    payload: VerifyPaymentRequest,
    shield: AgentShield = Depends(get_shield),
) -> VerifyPaymentResponse:
    """Verify Razorpay payment signature and transition transaction to SUCCEEDED."""
    settings = get_settings()
    key_secret = settings.RAZORPAY_KEY_SECRET

    if not key_secret:
        # In mock or test mode without secret configured, verify if test tokens match
        if payload.razorpay_signature == "test_signature" or settings.PAYMENT_PROVIDER == "mock":
            return _settle_transaction(shield, payload, verified=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RAZORPAY_KEY_SECRET is not configured on server",
        )

    # Compute expected signature: HMAC_SHA256(order_id + "|" + payment_id, secret)
    message = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode("utf-8")
    expected_signature = hmac.new(
        key_secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, payload.razorpay_signature):
        # Record failed verification audit event
        shield.audit_sink.create_and_record(
            session_id=payload.session_id,
            tool_name="verify_payment",
            arguments={
                "order_id": payload.razorpay_order_id,
                "payment_id": payload.razorpay_payment_id,
            },
            decision="BLOCK",
            risk_score=1.0,
            risk_level="CRITICAL",
            reasons=["PAYMENT_SIGNATURE_MISMATCH"],
            transaction_id=payload.transaction_id,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment signature verification failed",
        )

    return _settle_transaction(shield, payload, verified=True)


def _settle_transaction(
    shield: AgentShield,
    payload: VerifyPaymentRequest,
    verified: bool,
) -> VerifyPaymentResponse:
    """Commit spend and settle transaction state upon successful payment verification."""
    target_txn = None
    if payload.transaction_id:
        target_txn = shield.transaction_store.get(payload.transaction_id)
        if target_txn is None or target_txn.session_id != payload.session_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transaction was not found for this session",
            )

    else:
        # Never settle an arbitrary recent reservation. Only an exact provider
        # order mapping is safe when a client omits the internal transaction ID.
        recent = shield.transaction_store.list_by_session(payload.session_id)[:50]
        for txn in recent:
            if (
                txn.status in (TransactionStatus.AUTHORIZED, TransactionStatus.PENDING)
                and txn.provider_order_id == payload.razorpay_order_id
            ):
                target_txn = txn
                break
        if target_txn is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending AgentShield transaction matches this Razorpay order",
            )

    txn_id_str = target_txn.transaction_id
    if target_txn.status == TransactionStatus.SUCCEEDED:
        # Provider order creation is already recorded as SUCCEEDED by the
        # execution pipeline. Verification is an idempotent settlement check.
        settled = target_txn
    else:
        settled = shield.transaction_store.update_status(
            target_txn.transaction_id,
            status=TransactionStatus.SUCCEEDED,
        )
        if settled is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Transaction is no longer awaiting payment settlement",
            )

    # Record successful payment audit event
    shield.audit_sink.create_and_record(
        session_id=payload.session_id,
        tool_name="verify_payment",
        arguments={
            "order_id": payload.razorpay_order_id,
            "payment_id": payload.razorpay_payment_id,
        },
        decision="ALLOW",
        risk_score=0.0,
        risk_level="LOW",
        reasons=[],
        transaction_id=txn_id_str,
        provider_name="razorpay",
    )

    return VerifyPaymentResponse(
        verified=verified,
        transaction_id=txn_id_str,
        status="SUCCEEDED",
        message="Payment signature successfully verified and transaction settled.",
        order_id=payload.razorpay_order_id,
        payment_id=payload.razorpay_payment_id,
    )
