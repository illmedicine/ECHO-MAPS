"""Losses for training LatentCSI, WaveFormer, and CroSSL."""

from __future__ import annotations

import torch
import torch.nn.functional as F


def vae_loss(
    pred_points: torch.Tensor,
    target_points: torch.Tensor,
    mu: torch.Tensor,
    logvar: torch.Tensor,
    kl_weight: float = 0.001,
) -> dict[str, torch.Tensor]:
    """VAE loss for LatentCSI: reconstruction (Chamfer) + KL divergence."""
    # Chamfer-like distance (simplified: MSE between ordered point clouds)
    recon_loss = F.mse_loss(pred_points, target_points)

    # KL divergence
    kl_loss = -0.5 * torch.mean(1 + logvar - mu.pow(2) - logvar.exp())

    total = recon_loss + kl_weight * kl_loss
    return {"total": total, "recon": recon_loss, "kl": kl_loss}


def chamfer_distance(
    pred: torch.Tensor, target: torch.Tensor
) -> torch.Tensor:
    """Chamfer distance between two point clouds.

    pred:   (batch, N, 3)
    target: (batch, M, 3)
    """
    # (B, N, 1, 3) - (B, 1, M, 3) -> (B, N, M)
    diff = pred.unsqueeze(2) - target.unsqueeze(1)
    dist = torch.sum(diff ** 2, dim=-1)

    # For each pred point, find closest target point, and vice versa
    min_pred_to_target = dist.min(dim=2).values.mean(dim=1)
    min_target_to_pred = dist.min(dim=1).values.mean(dim=1)

    return (min_pred_to_target + min_target_to_pred).mean()


def vital_sign_loss(
    pred_vitals: torch.Tensor,
    target_vitals: torch.Tensor,
) -> torch.Tensor:
    """Huber loss for breathing rate / heart rate regression."""
    return F.huber_loss(pred_vitals, target_vitals, delta=2.0)
