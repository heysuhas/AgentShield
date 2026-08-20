"""Policy provider interfaces and in-memory implementation."""

from typing import Protocol, runtime_checkable

from app.agentshield.policy_engine import Policy


@runtime_checkable
class PolicyProvider(Protocol):
    """Protocol for resolving policies by session or agent context."""

    def get_policy(self, session_id: str) -> Policy | None:
        """Return the policy for the given session ID, or None if not found."""
        ...

    def set_policy(self, session_id: str, policy: Policy) -> None:
        """Register or update a policy for a specific session."""
        ...

    def remove_policy(self, session_id: str) -> None:
        """Remove a session-specific policy."""
        ...

    def has_session(self, session_id: str) -> bool:
        """Check if a session policy is explicitly registered."""
        ...

    def list_sessions(self) -> list[str]:
        """Return list of explicitly registered session IDs."""
        ...

    def reset(self) -> None:
        """Clear all registered policies."""
        ...


class InMemoryPolicyProvider:
    """In-memory policy provider supporting per-session policies and a default fallback."""

    def __init__(
        self,
        default_policy: Policy | None = None,
        policies: dict[str, Policy] | None = None,
    ) -> None:
        self._default_policy = default_policy
        self._policies: dict[str, Policy] = dict(policies or {})

    def get_policy(self, session_id: str) -> Policy | None:
        """Look up the session-specific policy, falling back to the default policy."""
        return self._policies.get(session_id, self._default_policy)

    def set_policy(self, session_id: str, policy: Policy) -> None:
        """Register or update a policy for a specific session."""
        self._policies[session_id] = policy

    def remove_policy(self, session_id: str) -> None:
        """Remove a session-specific policy."""
        self._policies.pop(session_id, None)

    def has_session(self, session_id: str) -> bool:
        """Check if a session policy is explicitly registered."""
        return session_id in self._policies

    def list_sessions(self) -> list[str]:
        """Return list of explicitly registered session IDs."""
        return list(self._policies.keys())

    def reset(self) -> None:
        """Clear all registered policies."""
        self._policies.clear()
