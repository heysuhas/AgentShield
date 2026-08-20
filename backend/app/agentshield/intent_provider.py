"""Intent provider protocol and in-memory implementation."""

from typing import Protocol, runtime_checkable

from app.agentshield.intent import AuthorizedIntent


@runtime_checkable
class IntentProvider(Protocol):
    """Protocol for resolving authorized user intent by session."""

    def get_intent(self, session_id: str) -> AuthorizedIntent | None:
        """Return the authorized intent for the given session ID, or None."""
        ...

    def set_intent(self, session_id: str, intent: AuthorizedIntent) -> None:
        """Register or update an authorized intent for a session."""
        ...

    def remove_intent(self, session_id: str) -> None:
        """Remove a session's authorized intent."""
        ...

    def has_intent(self, session_id: str) -> bool:
        """Check if an authorized intent exists for a session."""
        ...

    def reset(self) -> None:
        """Clear all registered intents."""
        ...


class InMemoryIntentProvider:
    """In-memory store for session-specific authorized user intents."""

    def __init__(
        self,
        default_intent: AuthorizedIntent | None = None,
        intents: dict[str, AuthorizedIntent] | None = None,
    ) -> None:
        self._default_intent = default_intent
        self._intents: dict[str, AuthorizedIntent] = dict(intents or {})

    def get_intent(self, session_id: str) -> AuthorizedIntent | None:
        return self._intents.get(session_id, self._default_intent)

    def set_intent(self, session_id: str, intent: AuthorizedIntent) -> None:
        self._intents[session_id] = intent

    def remove_intent(self, session_id: str) -> None:
        self._intents.pop(session_id, None)

    def has_intent(self, session_id: str) -> bool:
        return session_id in self._intents

    def reset(self) -> None:
        self._intents.clear()
