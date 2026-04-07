"""Application configuration loaded from environment variables."""

from __future__ import annotations

from enum import Enum
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings


class AppEnv(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    # ── Application ──
    app_env: AppEnv = AppEnv.DEVELOPMENT
    app_secret_key: str = Field(default="dev-insecure-key-change-me", min_length=16)
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    # ── Google OAuth ──
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # ── Database ──
    database_url: str = "postgresql+asyncpg://echo:echo@localhost:5432/echo_maps"

    # ── Milvus ──
    milvus_host: str = "localhost"
    milvus_port: int = 19530
    milvus_collection: str = "rf_signatures"

    # ── GCS ──
    gcs_bucket: str = "echo-maps-environments"
    gcs_credentials_path: str = ""

    # ── AI Engine ──
    model_cache_dir: Path = Path("./models")
    csi_sample_rate_hz: int = 100
    calibration_confidence_threshold: float = 0.95
    latent_dim: int = 512

    # ── Federated Learning ──
    fl_server_address: str = "0.0.0.0:8080"
    fl_min_clients: int = 2
    fl_rounds: int = 10

    # ── TLS ──
    tls_cert_path: str = ""
    tls_key_path: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "case_sensitive": False}

    @property
    def async_database_url(self) -> str:
        """Convert database URL to asyncpg format (handles Render's postgres:// format)."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url


_settings: Settings | None = None


def get_settings() -> Settings:
    """Lazy singleton for application settings."""
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
