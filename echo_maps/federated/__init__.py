"""Federated Learning server and client for privacy-preserving model updates.

Uses Flower (flwr) to implement Federated LoRA — the global LatentCSI model
gets smarter at recognizing human patterns without ever seeing raw user data.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import structlog

logger = structlog.get_logger()


def aggregate_lora_weights(
    results: list[tuple[list[np.ndarray], int]],
) -> list[np.ndarray]:
    """Federated averaging of LoRA weight deltas.

    Args:
        results: List of (weights, num_samples) from each client.

    Returns:
        Aggregated weights using weighted average.
    """
    total_samples = sum(n for _, n in results)
    if total_samples == 0:
        return results[0][0] if results else []

    aggregated = [
        np.zeros_like(w) for w in results[0][0]
    ]

    for weights, n_samples in results:
        weight = n_samples / total_samples
        for i, w in enumerate(weights):
            aggregated[i] += w * weight

    return aggregated


class FederatedConfig:
    """Configuration for the federated learning server."""

    def __init__(
        self,
        server_address: str = "0.0.0.0:8080",
        min_clients: int = 2,
        num_rounds: int = 10,
        lora_rank: int = 8,
        lora_alpha: float = 16.0,
    ) -> None:
        self.server_address = server_address
        self.min_clients = min_clients
        self.num_rounds = num_rounds
        self.lora_rank = lora_rank
        self.lora_alpha = lora_alpha


def create_fl_strategy(config: FederatedConfig) -> Any:
    """Create a Flower FedAvg strategy for LoRA weight aggregation.

    Returns a flwr.server.strategy.Strategy instance.
    Deferred import to avoid requiring flower at import time.
    """
    import flwr as fl

    strategy = fl.server.strategy.FedAvg(
        min_fit_clients=config.min_clients,
        min_evaluate_clients=config.min_clients,
        min_available_clients=config.min_clients,
    )

    logger.info(
        "fl_strategy_created",
        min_clients=config.min_clients,
        num_rounds=config.num_rounds,
    )
    return strategy
