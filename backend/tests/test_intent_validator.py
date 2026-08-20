import pytest
from pydantic import ValidationError

from app.agentshield.intent import AuthorizedIntent
from app.agentshield.intent_validator import validate_intent_deterministically


def test_intent_matches_authorized_transaction() -> None:
    intent = AuthorizedIntent(
        category="footwear",
        purpose="running shoes",
        max_amount=5000,
        currency="INR",
        allowed_tools=frozenset({"create_order"}),
    )

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={
            "amount": 4999,
            "currency": "INR",
            "category": "footwear",
        },
    )

    assert result.intent_match is True
    assert result.category_match is True
    assert result.amount_within_limit is True
    assert result.currency_match is True
    assert result.tool_match is True
    assert result.reasons == []
    assert result.confidence == 1.0


def test_intent_category_mismatch_shoes_vs_gift_card() -> None:
    """The amount and tool are valid, but the intent category is mismatched."""
    intent = AuthorizedIntent(
        category="footwear",
        purpose="running shoes",
        max_amount=5000,
        currency="INR",
        allowed_tools=frozenset({"create_order"}),
    )

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={
            "amount": 4999,
            "currency": "INR",
            "category": "gift_card",
        },
    )

    assert result.intent_match is False
    assert result.category_match is False
    assert result.amount_within_limit is True
    assert "INTENT_CATEGORY_MISMATCH" in result.reasons
    assert result.explanation is not None
    assert "gift_card" in result.explanation


def test_intent_purpose_mismatch_when_request_provides_purpose() -> None:
    intent = AuthorizedIntent(purpose="running shoes")

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={"purpose": "gift card"},
    )

    assert result.intent_match is False
    assert result.purpose_match is False
    assert "INTENT_PURPOSE_MISMATCH" in result.reasons


def test_required_category_cannot_be_omitted() -> None:
    intent = AuthorizedIntent(category="footwear")

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={"amount": 100},
    )

    assert result.intent_match is False
    assert result.category_match is False
    assert "INTENT_CATEGORY_MISMATCH" in result.reasons


def test_intent_amount_exceeded() -> None:
    intent = AuthorizedIntent(
        category="electronics",
        max_amount=10000,
        currency="INR",
    )

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={"amount": 10001, "category": "electronics"},
    )

    assert result.intent_match is False
    assert result.amount_within_limit is False
    assert "INTENT_AMOUNT_EXCEEDED" in result.reasons


def test_intent_currency_mismatch() -> None:
    intent = AuthorizedIntent(currency="INR")

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={"amount": 100, "currency": "USD"},
    )

    assert result.intent_match is False
    assert result.currency_match is False
    assert "INTENT_CURRENCY_MISMATCH" in result.reasons


def test_intent_merchant_mismatch() -> None:
    intent = AuthorizedIntent(merchant="Nike Official Store")

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={"amount": 4000, "merchant": "Shady Discount Vendor"},
    )

    assert result.intent_match is False
    assert result.merchant_match is False
    assert "INTENT_MERCHANT_MISMATCH" in result.reasons


def test_intent_recipient_mismatch() -> None:
    intent = AuthorizedIntent(recipient="vendor_acct_01")

    result = validate_intent_deterministically(
        intent,
        tool_name="create_order",
        arguments={"amount": 4000, "recipient": "attacker_acct_99"},
    )

    assert result.intent_match is False
    assert result.recipient_match is False
    assert "INTENT_RECIPIENT_MISMATCH" in result.reasons


def test_intent_models_are_frozen() -> None:
    intent = AuthorizedIntent(category="books")
    with pytest.raises(ValidationError):
        intent.__setattr__("category", "games")
