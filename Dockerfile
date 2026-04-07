## ── Production target (default — lightweight API-only) ──
FROM python:3.11-slim
WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt
COPY echo_maps/ echo_maps/
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
# Render sets $PORT dynamically — must listen on it
CMD sh -c "uvicorn echo_maps.api.app:create_app --factory --host 0.0.0.0 --port ${PORT:-8000}"
