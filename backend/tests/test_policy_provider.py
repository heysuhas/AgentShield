from app.agentshield.policy_engine import Policy
from app.agentshield.policy_provider import InMemoryPolicyProvider, PolicyProvider


def test_in_memory_policy_provider_implements_protocol() -> None:
    provider = InMemoryPolicyProvider()
    assert isinstance(provider, PolicyProvider)


def test_in_memory_policy_provider_returns_default_policy() -> None:
    default_policy = Policy(allowed_tools=frozenset({"create_order"}))
    provider = InMemoryPolicyProvider(default_policy=default_policy)

    assert provider.get_policy("any_session") == default_policy


def test_in_memory_policy_provider_returns_session_policy() -> None:
    default_policy = Policy(allowed_tools=frozenset({"create_order"}))
    custom_policy = Policy(allowed_tools=frozenset({"create_order", "fetch_order"}))

    provider = InMemoryPolicyProvider(
        default_policy=default_policy,
        policies={"session_custom": custom_policy},
    )

    assert provider.get_policy("session_custom") == custom_policy
    assert provider.get_policy("session_other") == default_policy


def test_in_memory_policy_provider_set_and_remove_policy() -> None:
    provider = InMemoryPolicyProvider()
    assert provider.get_policy("session_1") is None

    policy = Policy(allowed_tools=frozenset({"create_order"}))
    provider.set_policy("session_1", policy)
    assert provider.get_policy("session_1") == policy

    provider.remove_policy("session_1")
    assert provider.get_policy("session_1") is None
