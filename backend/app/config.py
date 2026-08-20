"""Application configuration and environment settings."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "sqlite:///./agentshield.db"
    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "AgentShield"
    API_V1_STR: str = "/api/v1"

    # NVIDIA NIM Configuration
    NVIDIA_API_KEY: str | None = None
    NVIDIA_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NVIDIA_MODEL: str = "meta/llama-3.3-70b-instruct"

    # Payment Provider Configuration
    PAYMENT_PROVIDER: str = "mock"  # "mock" | "razorpay"
    RAZORPAY_KEY_ID: str | None = None
    RAZORPAY_KEY_SECRET: str | None = None
    RAZORPAY_BASE_URL: str = "https://api.razorpay.com/v1"


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
