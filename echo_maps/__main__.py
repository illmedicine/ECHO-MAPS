"""Echo Maps application entry point."""

import uvicorn

from echo_maps.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "echo_maps.api.app:create_app",
        factory=True,
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_env == "development",
    )


if __name__ == "__main__":
    main()
