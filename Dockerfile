## ── Production target (default — lightweight API-only) ──
FROM python:3.11-slim AS prod
WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt
COPY echo_maps/ echo_maps/
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "echo_maps.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
