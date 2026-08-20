"""Keep the test suite deterministic and independent of developer credentials."""

import os

os.environ["PAYMENT_PROVIDER"] = "mock"
os.environ["NVIDIA_API_KEY"] = ""

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()
