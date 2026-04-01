"""Subscription tier management and feature gating."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class SubscriptionTier(str, Enum):
    PERSONAL = "personal"
    PRO = "pro"


@dataclass(frozen=True)
class TierLimits:
    max_environments: int
    playback_hours: int
    heatmap_days: int
    vital_signs: bool
    real_time_alerts: bool


TIER_CONFIG: dict[SubscriptionTier, TierLimits] = {
    SubscriptionTier.PERSONAL: TierLimits(
        max_environments=10,
        playback_hours=72,
        heatmap_days=7,
        vital_signs=True,
        real_time_alerts=False,
    ),
    SubscriptionTier.PRO: TierLimits(
        max_environments=50,
        playback_hours=2160,  # 90 days
        heatmap_days=90,
        vital_signs=True,
        real_time_alerts=True,
    ),
}


def get_tier_limits(tier: str) -> TierLimits:
    """Get the feature limits for a subscription tier."""
    try:
        return TIER_CONFIG[SubscriptionTier(tier)]
    except ValueError:
        return TIER_CONFIG[SubscriptionTier.PERSONAL]


def check_feature_access(tier: str, feature: str) -> bool:
    """Check whether a tier has access to a specific feature."""
    limits = get_tier_limits(tier)
    feature_map = {
        "vital_signs": limits.vital_signs,
        "real_time_alerts": limits.real_time_alerts,
        "heatmaps": limits.heatmap_days > 0,
    }
    return feature_map.get(feature, True)
