"""Google OAuth 2.0 authentication routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from authlib.integrations.httpx_client import AsyncOAuth2Client
from pydantic import BaseModel

from echo_maps.config import get_settings
from echo_maps.api.deps import create_access_token
from echo_maps.db.session import get_session
from echo_maps.db.models import User

router = APIRouter()

GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


class AuthURL(BaseModel):
    url: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    name: str


@router.get("/google/login", response_model=AuthURL)
async def google_login() -> AuthURL:
    """Initiate Google OAuth 2.0 login flow."""
    settings = get_settings()
    client = AsyncOAuth2Client(
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        redirect_uri=settings.google_redirect_uri,
        scope="openid email profile",
    )
    url, _ = client.create_authorization_url("https://accounts.google.com/o/oauth2/v2/auth")
    return AuthURL(url=url)


@router.get("/google/callback", response_model=TokenResponse)
async def google_callback(code: str, response: Response) -> TokenResponse:
    """Handle Google OAuth 2.0 callback — create or update user."""
    settings = get_settings()

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    client = AsyncOAuth2Client(
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        redirect_uri=settings.google_redirect_uri,
    )

    # Exchange code for token
    token = await client.fetch_token(
        GOOGLE_TOKEN_URL,
        code=code,
        grant_type="authorization_code",
    )

    if "access_token" not in token:
        raise HTTPException(status_code=401, detail="Failed to obtain access token")

    # Get user info
    resp = await client.get(GOOGLE_USERINFO_URL)
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to get user info")

    userinfo = resp.json()
    email = userinfo.get("email")
    name = userinfo.get("name", "")
    google_id = userinfo.get("sub")

    if not email or not google_id:
        raise HTTPException(status_code=401, detail="Incomplete user info from Google")

    # Upsert user in DB
    async with get_session() as session:
        user = await User.get_by_google_id(session, google_id)
        if user is None:
            user = User(
                google_id=google_id,
                email=email,
                name=name,
                subscription_tier="personal",
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

    # Issue JWT
    access_token = create_access_token(user_id=str(user.id), email=email)

    return TokenResponse(
        access_token=access_token,
        user_id=str(user.id),
        email=email,
        name=name,
    )
