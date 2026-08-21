import json
import pytest
import httpx

from app.agentshield.intent import AuthorizedIntent
from app.providers.llm.base import (
    LLMAuthenticationError,
    LLMMessage,
    LLMProvider,
    LLMProviderError,
)
from app.providers.llm.mock import MockLLMProvider
from app.providers.llm.nvidia import NvidiaNIMProvider


def test_mock_llm_provider_conforms_to_protocol() -> None:
    provider = MockLLMProvider()
    assert isinstance(provider, LLMProvider)


def test_mock_llm_provider_extract_intent() -> None:
    provider = MockLLMProvider()

    # Natural language prompt
    intent = provider.extract_intent("Please purchase running shoes for under ₹5,000")
    assert intent.category == "footwear"
    assert intent.purpose == "running shoes"
    assert intent.max_amount == 5000
    assert intent.currency == "INR"


def test_mock_llm_provider_semantic_comparison() -> None:
    provider = MockLLMProvider()

    intent = AuthorizedIntent(
        category="footwear",
        purpose="running shoes",
        max_amount=5000,
        currency="INR",
    )

    # 1. Matching category synonym (sneakers -> footwear)
    res1 = provider.compare_semantic_intent(
        intent,
        tool_name="create_order",
        arguments={"amount": 4500, "category": "sneakers"},
    )
    assert res1.intent_match is True
    assert res1.category_match is True

    # 2. Semantic mismatch (gift card is not footwear)
    res2 = provider.compare_semantic_intent(
        intent,
        tool_name="create_order",
        arguments={"amount": 4999, "category": "gift_card"},
    )
    assert res2.intent_match is False
    assert res2.category_match is False
    assert "INTENT_CATEGORY_MISMATCH" in res2.reasons


def test_nvidia_provider_missing_key_raises_auth_error() -> None:
    provider = NvidiaNIMProvider(api_key=None)
    with pytest.raises(LLMAuthenticationError):
        provider.chat_complete([LLMMessage(role="user", content="hello")])


def test_nvidia_provider_chat_complete_with_mocked_http() -> None:
    def custom_transport(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        assert data["model"] == "openai/gpt-oss-20b"
        assert request.headers["Authorization"] == "Bearer test_key_123"

        response_payload = {
            "id": "chatcmpl-test",
            "model": "openai/gpt-oss-20b",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello from NVIDIA NIM!",
                    },
                }
            ],
        }
        return httpx.Response(200, json=response_payload)

    client = httpx.Client(transport=httpx.MockTransport(custom_transport))
    provider = NvidiaNIMProvider(api_key="test_key_123", client=client)

    response = provider.chat_complete([LLMMessage(role="user", content="Hi")])
    assert response.content == "Hello from NVIDIA NIM!"
    assert response.model == "openai/gpt-oss-20b"


def test_nvidia_provider_extract_intent_with_mocked_http() -> None:
    def custom_transport(request: httpx.Request) -> httpx.Response:
        response_payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "category": "footwear",
                                "purpose": "running shoes",
                                "recipient": None,
                                "merchant": "Nike Store",
                                "max_amount": 5000,
                                "currency": "INR",
                                "allowed_tools": ["create_order"],
                            }
                        ),
                    }
                }
            ]
        }
        return httpx.Response(200, json=response_payload)

    client = httpx.Client(transport=httpx.MockTransport(custom_transport))
    provider = NvidiaNIMProvider(api_key="test_key_123", client=client)

    intent = provider.extract_intent("Buy Nike running shoes under 5000 rupees")
    assert intent.category == "footwear"
    assert intent.purpose == "running shoes"
    assert intent.merchant == "Nike Store"
    assert intent.max_amount == 5000
    assert intent.currency == "INR"
    assert "create_order" in intent.allowed_tools


def test_nvidia_provider_compare_semantic_intent_with_mocked_http() -> None:
    def custom_transport(request: httpx.Request) -> httpx.Response:
        response_payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "intent_match": False,
                                "category_match": False,
                                "purpose_match": False,
                                "recipient_match": True,
                                "merchant_match": True,
                                "amount_within_limit": True,
                                "currency_match": True,
                                "tool_match": True,
                                "confidence": 0.99,
                                "reasons": ["INTENT_CATEGORY_MISMATCH"],
                                "explanation": "The user authorized footwear but the agent attempted to purchase a gift card.",
                            }
                        ),
                    }
                }
            ]
        }
        return httpx.Response(200, json=response_payload)

    client = httpx.Client(transport=httpx.MockTransport(custom_transport))
    provider = NvidiaNIMProvider(api_key="test_key_123", client=client)

    intent = AuthorizedIntent(category="footwear", max_amount=5000)
    result = provider.compare_semantic_intent(
        intent,
        tool_name="create_order",
        arguments={"amount": 4999, "category": "gift_card"},
    )

    assert result.intent_match is False
    assert result.category_match is False
    assert "INTENT_CATEGORY_MISMATCH" in result.reasons
    assert result.explanation is not None
    assert "gift card" in result.explanation


def test_nvidia_provider_handles_http_errors() -> None:
    def error_transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal Server Error")

    client = httpx.Client(transport=httpx.MockTransport(error_transport))
    provider = NvidiaNIMProvider(api_key="test_key_123", client=client)

    with pytest.raises(LLMProviderError) as exc_info:
        provider.chat_complete([LLMMessage(role="user", content="Test")])
    assert "500" in str(exc_info.value)
