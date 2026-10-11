"""The parts of the AI layer that do not need the network: reading API errors and the model's JSON."""

import anthropic
import httpx2 as httpx
import pytest

from echo_maps.history import ai


def _bad_request(message: str) -> anthropic.BadRequestError:
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    resp = httpx.Response(400, request=req)
    body = {"type": "error", "error": {"type": "invalid_request_error", "message": message}}
    return anthropic.BadRequestError(message, response=resp, body=body)


def test_api_message_reads_the_reason_the_api_gave():
    msg = "Your credit balance is too low to access the Anthropic API."
    assert ai.api_message(_bad_request(msg)) == msg


def test_api_message_is_capped_and_never_empty():
    assert len(ai.api_message(_bad_request("x" * 1000))) == 300
    assert ai.api_message(RuntimeError("boom")) == "boom"


def test_account_problems_are_recognised_so_we_do_not_retry_pointlessly():
    for reason in ("Your credit balance is too low", "This organization has been disabled", "model not available under zero data retention"):
        assert any(w in reason.lower() for w in ai._ACCOUNT_WORDS), reason
    assert not any(w in "output_config.format.schema is invalid".lower() for w in ai._ACCOUNT_WORDS)


def test_parse_json_tolerates_fences_and_prose():
    assert ai.parse_json('{"a": 1}') == {"a": 1}
    assert ai.parse_json('Here you go:\n```json\n{"a": 1, "b": [2]}\n```') == {"a": 1, "b": [2]}
    with pytest.raises(Exception):
        ai.parse_json("no json here")


def test_generate_without_a_key_says_so():
    import asyncio
    with pytest.raises(ai.InsightsUnavailable, match="ANTHROPIC_API_KEY"):
        asyncio.run(ai.generate({}, api_key="", model="claude-opus-5-5"))
