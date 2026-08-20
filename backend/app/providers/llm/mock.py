"""Deterministic mock LLM provider for fast unit tests and offline workflows."""

import re
from typing import Any

from app.agentshield.intent import AuthorizedIntent, IntentValidationResult
from app.providers.llm.base import LLMMessage, LLMResponse


class MockLLMProvider:
    """Deterministic, offline implementation of LLMProvider."""

    def __init__(self, canned_response: str | None = None) -> None:
        self.canned_response = canned_response
        self.call_history: list[list[LLMMessage]] = []

    def chat_complete(
        self,
        messages: list[LLMMessage],
        *,
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        self.call_history.append(messages)
        content = self.canned_response or "Mock completion"
        return LLMResponse(
            content=content,
            model="mock-model",
            raw_response={"mock": True},
        )

    def extract_intent(self, user_prompt: str) -> AuthorizedIntent:
        """Extract intent from user instructions using rule-based heuristic parsing."""
        prompt_lower = user_prompt.lower()

        # 1. Category heuristics
        category = None
        if any(w in prompt_lower for w in ["shoe", "sneaker", "footwear", "running shoes"]):
            category = "footwear"
        elif any(w in prompt_lower for w in ["laptop", "phone", "headphone", "electronics"]):
            category = "electronics"
        elif any(w in prompt_lower for w in ["book", "novel"]):
            category = "books"
        elif "gift card" in prompt_lower:
            category = "gift_card"

        # 2. Purpose heuristics
        purpose = None
        if "running" in prompt_lower:
            purpose = "running shoes"
        elif "office" in prompt_lower or "work" in prompt_lower:
            purpose = "work"

        # 3. Amount extraction
        max_amount = None
        amount_match = re.search(r"(?:under|below|max|upto|up to|₹|rs\.?|inr)?\s*₹?\s*(\d+[\d,]*)", prompt_lower)
        if amount_match:
            digits = amount_match.group(1).replace(",", "")
            if digits.isdigit():
                max_amount = int(digits)

        # 4. Currency
        currency = "USD" if "$" in user_prompt or "usd" in prompt_lower else "INR"

        return AuthorizedIntent(
            category=category,
            purpose=purpose,
            max_amount=max_amount,
            currency=currency,
            allowed_tools=frozenset({"create_order", "fetch_order"}),
        )

    def compare_semantic_intent(
        self,
        intent: AuthorizedIntent,
        *,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> IntentValidationResult:
        """Evaluate semantic compatibility between intent and tool arguments."""
        reasons: list[str] = []
        category_match = True
        purpose_match = True
        amount_within_limit = True

        req_category = str(arguments.get("category", "")).lower()
        req_amount = arguments.get("amount")

        # Category semantic check
        if intent.category is not None:
            authorized_cat = intent.category.lower()
            if req_category:
                # Direct match or synonym
                category_synonyms = {
                    "footwear": {"footwear", "shoes", "sneakers", "boots"},
                    "electronics": {"electronics", "laptop", "phone", "headphones"},
                }
                valid_set = category_synonyms.get(authorized_cat, {authorized_cat})
                if req_category not in valid_set:
                    category_match = False
                    reasons.append("INTENT_CATEGORY_MISMATCH")
            else:
                category_match = False
                reasons.append("INTENT_CATEGORY_MISMATCH")

        # Amount check
        if (
            intent.max_amount is not None
            and isinstance(req_amount, int)
            and req_amount > intent.max_amount
        ):
            amount_within_limit = False
            reasons.append("INTENT_AMOUNT_EXCEEDED")

        intent_match = len(reasons) == 0
        explanation = None
        if not intent_match:
            explanation = f"Semantic validation failed: {', '.join(reasons)}"

        return IntentValidationResult(
            intent_match=intent_match,
            category_match=category_match,
            purpose_match=purpose_match,
            amount_within_limit=amount_within_limit,
            confidence=0.98,
            reasons=reasons,
            explanation=explanation,
        )
