"""Deterministic checks comparing requested tool actions against authorized intent."""

from typing import Any

from app.agentshield.intent import AuthorizedIntent, IntentValidationResult


def validate_intent_deterministically(
    intent: AuthorizedIntent,
    *,
    tool_name: str,
    arguments: dict[str, Any],
) -> IntentValidationResult:
    """Evaluate deterministic intent rules without invoking an LLM."""
    reasons: list[str] = []
    explanations: list[str] = []

    category_match = True
    purpose_match = True
    recipient_match = True
    merchant_match = True
    amount_within_limit = True
    currency_match = True
    tool_match = True

    # 1. Tool authorization match
    if intent.allowed_tools is not None and tool_name not in intent.allowed_tools:
        tool_match = False
        reasons.append("INTENT_TOOL_MISMATCH")
        explanations.append(
            f"Requested tool '{tool_name}' is not authorized by user intent."
        )

    # 2. Maximum authorized transaction amount
    raw_amount = arguments.get("amount")
    if (
        intent.max_amount is not None
        and isinstance(raw_amount, int)
        and not isinstance(raw_amount, bool)
    ):
        if raw_amount > intent.max_amount:
            amount_within_limit = False
            reasons.append("INTENT_AMOUNT_EXCEEDED")
            explanations.append(
                f"Requested amount ₹{raw_amount:,} exceeds authorized maximum ₹{intent.max_amount:,}."
            )

    # 3. Currency match
    req_currency = arguments.get("currency")
    if req_currency is not None:
        if str(req_currency).upper() != intent.currency.upper():
            currency_match = False
            reasons.append("INTENT_CURRENCY_MISMATCH")
            explanations.append(
                f"Requested currency '{req_currency}' does not match authorized '{intent.currency}'."
            )

    # 4. Exact category match
    if intent.category is not None:
        req_category = arguments.get("category")
        if req_category is not None:
            if str(req_category).strip().lower() != intent.category.strip().lower():
                category_match = False
                reasons.append("INTENT_CATEGORY_MISMATCH")
                explanations.append(
                    f"Requested category '{req_category}' does not match authorized '{intent.category}'."
                )

    # 5. Merchant match
    if intent.merchant is not None:
        req_merchant = arguments.get("merchant")
        if req_merchant is not None:
            if str(req_merchant).strip().lower() != intent.merchant.strip().lower():
                merchant_match = False
                reasons.append("INTENT_MERCHANT_MISMATCH")
                explanations.append(
                    f"Requested merchant '{req_merchant}' does not match authorized '{intent.merchant}'."
                )

    # 6. Recipient match
    if intent.recipient is not None:
        req_recipient = arguments.get("recipient")
        if req_recipient is not None:
            if str(req_recipient).strip().lower() != intent.recipient.strip().lower():
                recipient_match = False
                reasons.append("INTENT_RECIPIENT_MISMATCH")
                explanations.append(
                    f"Requested recipient '{req_recipient}' does not match authorized '{intent.recipient}'."
                )

    intent_match = len(reasons) == 0
    explanation = " ".join(explanations) if explanations else None

    return IntentValidationResult(
        intent_match=intent_match,
        category_match=category_match,
        purpose_match=purpose_match,
        recipient_match=recipient_match,
        merchant_match=merchant_match,
        amount_within_limit=amount_within_limit,
        currency_match=currency_match,
        tool_match=tool_match,
        confidence=1.0,
        reasons=reasons,
        explanation=explanation,
    )
