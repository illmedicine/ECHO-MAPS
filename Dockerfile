FROM python:3.11-slim AS base

WORKDIR /app

# System deps for OpenCV and scientific computing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]" 2>/dev/null || pip install --no-cache-dir .

COPY echo_maps/ echo_maps/

# ── Development target ──
FROM base AS dev
COPY tests/ tests/
CMD ["uvicorn", "echo_maps.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Production target ──
FROM base AS prod
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "echo_maps.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
