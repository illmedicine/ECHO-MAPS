"""Tests for subscription tier management."""

from echo_maps.billing import (
    SubscriptionTier,
    check_feature_access,
    get_tier_limits,
)


def test_personal_tier_limits():
    limits = get_tier_limits("personal")
    assert limits.max_environments == 2
    assert limits.playback_hours == 24
    assert limits.vital_signs is False
    assert limits.real_time_alerts is False


def test_pro_tier_limits():
    limits = get_tier_limits("pro")
    assert limits.max_environments == 5
    assert limits.heatmap_days == 30
    assert limits.vital_signs is True
    assert limits.real_time_alerts is True


def test_unknown_tier_defaults_to_personal():
    limits = get_tier_limits("unknown")
    assert limits.max_environments == 2


def test_feature_access():
    assert check_feature_access("pro", "vital_signs") is True
    assert check_feature_access("personal", "vital_signs") is False
    assert check_feature_access("pro", "heatmaps") is True
    assert check_feature_access("personal", "heatmaps") is False
