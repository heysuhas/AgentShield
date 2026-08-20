"""LLM Provider abstraction protocol and data models."""

from typing import Any, Literal, Protocol, runtime_checkable
from pydantic import BaseModel, Field

from app.agentshield.intent import AuthorizedIntent, IntentValidationResult


class LLMMessage(BaseModel):
    """A role-based message in an LLM conversation."""

    role: Literal["system", "user", "assistant"]
    content: str


class LLMResponse(BaseModel):
    """The raw and formatted response from an LLM provider."""

    content: str
    model: str | None = None
    raw_response: dict[str, Any] = Field(default_factory=dict)


class LLMProviderError(Exception):
    """Base exception for all LLM provider errors."""


class LLMAuthenticationError(LLMProviderError):
    """Authentication or API key error with the LLM provider."""


class LLMResponseParsingError(LLMProviderError):
    """Error raised when LLM response cannot be parsed into the expected structure."""


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol defining the interface for LLM inference and semantic reasoning."""

    def chat_complete(
        self,
        messages: list[LLMMessage],
        *,
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        """Send a chat completion request to the LLM."""
        ...

    def extract_intent(self, user_prompt: str) -> AuthorizedIntent:
        """Extract structured user authorization intent from natural language instructions."""
        ...

    def compare_semantic_intent(
        self,
        intent: AuthorizedIntent,
        *,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> IntentValidationResult:
        """Perform semantic comparison between authorized intent and a candidate tool call."""
        ...
