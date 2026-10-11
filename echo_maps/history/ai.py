"""Claude-written insights from aggregated history.

Only aggregated, anonymous statistics are sent: counts, ranges, hour-by-hour occupancy and the
rule-based observations. No BLE ids, no per-device records, nothing that identifies a person.

The model reads the numbers and writes plain-language observations for facility staff. It is told to
stay inside the data and to keep the uncertainty the statistics already carry.
"""

from __future__ import annotations

import json
from datetime import datetime

import anthropic
import structlog

log = structlog.get_logger()

SYSTEM_PROMPT = """You are an operations analyst for a hotel/property team. You are given anonymous, aggregated \
statistics from WiFi/Bluetooth presence sensors in one public area (hallway, lobby, ...). You write short, \
useful observations for the people who run the property.

Rules:
- Use only the numbers provided. Never invent figures, causes or events.
- Every count is an ESTIMATE with a likely range. Quote the range or say "about"; never state a count as exact.
- You cannot identify individuals and must not speculate about specific people, guests or staff members.
- Pets are inferred from fast breathing signatures and are a hint only; a child or someone who just exercised \
can look the same. Say so when you mention pets.
- If data coverage is low, say the counts are probably too low before anything else.
- Prefer patterns that matter to operations (busy and quiet hours, how long people linger, unusual changes, \
areas that deserve attention). Skip anything trivial.
- Be concise: each insight is one or two plain sentences. At most 6 insights and 3 recommendations. \
Recommendations must be modest and follow directly from the data."""

SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "insights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                },
                "required": ["title", "detail", "confidence"],
                "additionalProperties": False,
            },
        },
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "caveats": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "insights", "recommendations", "caveats"],
    "additionalProperties": False,
}


class InsightsUnavailable(Exception):
    """The AI layer could not produce insights; the caller falls back to rule-based ones."""


def build_payload(summary: dict, series: list[dict], areas: list[dict], rules: list[dict], tz) -> dict:
    """The compact, anonymous document the model reads."""
    def label(epoch: int) -> str:
        dt = datetime.fromtimestamp(epoch, tz)
        return f"{dt.strftime('%a')} {dt.hour:02d}:00"

    w = summary["window"]
    return {
        "period": {
            "hours": w["hours"], "data_coverage_pct": round(w["coverage"] * 100),
            "timezone": w["tz"],
            "first_data": datetime.fromtimestamp(w["first_data"], tz).strftime("%Y-%m-%d %H:%M") if w["first_data"] else None,
            "last_data": datetime.fromtimestamp(w["last_data"], tz).strftime("%Y-%m-%d %H:%M") if w["last_data"] else None,
        },
        "estimates": {
            "people": {k: summary["people"][k] for k in ("estimate", "low", "high", "confidence")},
            "devices": {k: summary["devices"][k] for k in ("estimate", "low", "high", "confidence", "peak_nearby", "fixtures")},
            "pets": {k: summary["pets"][k] for k in ("estimate", "low", "high", "confidence")},
            "guests_vs_regulars": {"guests": summary["guests"]["estimate"], "regulars": summary["guests"]["regulars"]},
            "device_makers": summary["devices"]["by_manufacturer"][:6],
        },
        "occupancy": summary["visits"],
        "hourly": [
            {"hour": label(r["t"]), "occupied_pct": r["occupied_pct"], "devices_max": r["devices_max"],
             "people_max": r["people_max"], "pets_max": r["pets_max"], "minutes_with_data": r["minutes"]}
            for r in series if r["minutes"] > 0
        ][-72:],
        "areas": areas[:10],
        "rule_based_observations": [{"title": r["title"], "detail": r["detail"]} for r in rules],
    }


def _text(response) -> str:
    return next((b.text for b in response.content if b.type == "text"), "")


def api_message(exc: Exception) -> str:
    """The reason the API gave for rejecting a request (it never contains the key)."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:300]
        if body.get("message"):
            return str(body["message"])[:300]
    return str(getattr(exc, "message", exc))[:300]


# A 400 that is about the account (credits, access, retention) will not be fixed by retrying
# the request in a simpler shape, so stop and show it.
_ACCOUNT_WORDS = ("credit", "billing", "plan", "organization", "api key", "permission", "retention", "not available")


def parse_json(text: str) -> dict:
    """Parse the model's JSON, tolerating prose or code fences around it."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        i, j = text.find("{"), text.rfind("}")
        if i < 0 or j <= i:
            raise
        return json.loads(text[i : j + 1])


_JSON_ONLY = (
    "\n\nReturn ONLY a JSON object, no other text, shaped exactly like: "
    '{"headline": string, "insights": [{"title": string, "detail": string, "confidence": "low"|"medium"|"high"}], '
    '"recommendations": [string], "caveats": [string]}'
)


async def generate(payload: dict, *, api_key: str, model: str) -> dict:
    if not api_key:
        raise InsightsUnavailable("ANTHROPIC_API_KEY is not set on the server")
    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=90.0, max_retries=1)
    user = "Statistics for this period (JSON):\n" + json.dumps(payload, separators=(",", ":"))
    base = dict(model=model, max_tokens=8000, system=SYSTEM_PROMPT)   # adaptive thinking spends part of max_tokens
    structured = dict(base, messages=[{"role": "user", "content": user}],
                      output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}})
    plain = dict(base, messages=[{"role": "user", "content": user + _JSON_ONLY}])

    async def beta_with_fallback():
        # Preferred: if a safety classifier declines the request, the API re-runs it on a fallback model.
        return await client.beta.messages.create(
            betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"}, **structured)

    attempts = [
        ("structured output with refusal fallback", beta_with_fallback),
        ("structured output", lambda: client.messages.create(**structured)),
        ("plain JSON request", lambda: client.messages.create(**plain)),
    ]
    response = None
    reason = ""
    try:
        for name, call in attempts:
            try:
                response = await call()
                break
            except anthropic.BadRequestError as exc:
                reason = api_message(exc)
                log.warning("insights_request_rejected", attempt=name, reason=reason)
                if any(w in reason.lower() for w in _ACCOUNT_WORDS):
                    break
        if response is None:
            raise InsightsUnavailable(f"Anthropic rejected the request (400): {reason}")
    except anthropic.AuthenticationError as exc:
        raise InsightsUnavailable("The Anthropic API key was rejected") from exc
    except anthropic.PermissionDeniedError as exc:
        raise InsightsUnavailable(f"The Anthropic API key cannot use this model: {api_message(exc)}") from exc
    except anthropic.NotFoundError as exc:
        raise InsightsUnavailable(f"Model '{model}' was not found for this API key: {api_message(exc)}") from exc
    except anthropic.RateLimitError as exc:
        raise InsightsUnavailable("Anthropic rate limit reached; try again shortly") from exc
    except anthropic.APIConnectionError as exc:
        raise InsightsUnavailable("Could not reach the Anthropic API") from exc
    except anthropic.APIStatusError as exc:
        log.warning("insights_api_error", status=exc.status_code, message=api_message(exc))
        raise InsightsUnavailable(f"Anthropic API error ({exc.status_code}): {api_message(exc)}") from exc

    if response.stop_reason == "refusal":
        raise InsightsUnavailable("The model declined to summarise this data")
    if response.stop_reason == "max_tokens":
        raise InsightsUnavailable("The model ran out of room before finishing")
    try:
        data = parse_json(_text(response))
    except json.JSONDecodeError as exc:
        raise InsightsUnavailable("The model did not return valid JSON") from exc

    return {
        "source": "ai",
        "model": getattr(response, "model", model),
        "headline": str(data.get("headline", "")),
        "insights": [i for i in data.get("insights", []) if isinstance(i, dict)][:6],
        "recommendations": [str(r) for r in data.get("recommendations", [])][:3],
        "caveats": [str(c) for c in data.get("caveats", [])][:4],
        "request_id": getattr(response, "_request_id", None),
    }
