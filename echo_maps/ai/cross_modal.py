"""Cross-Modal Self-Supervised Learning (CroSSL) framework.

During the calibration "2D3D Map Trace" phase (webcam ON + WiFi ON), this
module pairs video-derived skeletal keypoints with simultaneous CSI frames
to train a mapping from RF signatures to human pose — enabling camera-free
monitoring after calibration.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class SkeletalProjector(nn.Module):
    """Project 3D skeletal keypoints (from MediaPipe/DensePose) into latent space.

    Input:  (batch, n_keypoints, 3)  — 33 MediaPipe keypoints × (x, y, z)
    Output: (batch, latent_dim)
    """

    def __init__(self, n_keypoints: int = 33, latent_dim: int = 512) -> None:
        super().__init__()
        self.projector = nn.Sequential(
            nn.Flatten(),
            nn.Linear(n_keypoints * 3, 512),
            nn.GELU(),
            nn.Linear(512, latent_dim),
        )

    def forward(self, keypoints: torch.Tensor) -> torch.Tensor:
        return self.projector(keypoints)


class CSIProjector(nn.Module):
    """Project CSI latent embeddings into cross-modal alignment space.

    Input:  (batch, csi_dim)  — output from CSIEncoder.fc_mu
    Output: (batch, latent_dim)
    """

    def __init__(self, csi_dim: int = 512, latent_dim: int = 512) -> None:
        super().__init__()
        self.projector = nn.Sequential(
            nn.Linear(csi_dim, 512),
            nn.GELU(),
            nn.Linear(512, latent_dim),
        )

    def forward(self, csi_embedding: torch.Tensor) -> torch.Tensor:
        return self.projector(csi_embedding)


class CroSSLFramework(nn.Module):
    """Cross-Modal Self-Supervised Learning framework.

    Aligns CSI embeddings with vision-derived skeletal embeddings using a
    contrastive loss (NT-Xent / InfoNCE). After training, the CSI branch
    alone can predict human pose with high fidelity.

    Architecture mirrors CLIP-style dual-encoder alignment.
    """

    def __init__(
        self,
        n_keypoints: int = 33,
        csi_dim: int = 512,
        latent_dim: int = 512,
        temperature: float = 0.07,
    ) -> None:
        super().__init__()
        self.skeletal_proj = SkeletalProjector(n_keypoints, latent_dim)
        self.csi_proj = CSIProjector(csi_dim, latent_dim)
        self.temperature = temperature
        self.logit_scale = nn.Parameter(torch.log(torch.tensor(1.0 / temperature)))

    def forward(
        self,
        csi_embeddings: torch.Tensor,
        skeletal_keypoints: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        """Compute cross-modal contrastive loss.

        Returns dict with 'loss', 'csi_features', 'skeletal_features', 'accuracy'.
        """
        csi_feat = F.normalize(self.csi_proj(csi_embeddings), dim=-1)
        skel_feat = F.normalize(self.skeletal_proj(skeletal_keypoints), dim=-1)

        # Cosine similarity matrix scaled by learned temperature
        logit_scale = self.logit_scale.exp().clamp(max=100.0)
        logits_per_csi = logit_scale * csi_feat @ skel_feat.t()
        logits_per_skel = logits_per_csi.t()

        # Symmetric cross-entropy loss (InfoNCE)
        batch_size = csi_feat.size(0)
        labels = torch.arange(batch_size, device=csi_feat.device)
        loss_csi = F.cross_entropy(logits_per_csi, labels)
        loss_skel = F.cross_entropy(logits_per_skel, labels)
        loss = (loss_csi + loss_skel) / 2.0

        # Alignment accuracy (what % of pairs are correctly matched)
        with torch.no_grad():
            preds = logits_per_csi.argmax(dim=-1)
            accuracy = (preds == labels).float().mean()

        return {
            "loss": loss,
            "csi_features": csi_feat,
            "skeletal_features": skel_feat,
            "accuracy": accuracy,
        }


class PoseRegressor(nn.Module):
    """After CroSSL training, regresses 3D skeletal pose directly from CSI latent.

    This is the inference-time "no-cam" pose predictor.

    Input:  (batch, csi_dim)
    Output: (batch, n_keypoints, 3)
    """

    def __init__(self, csi_dim: int = 512, n_keypoints: int = 33) -> None:
        super().__init__()
        self.n_keypoints = n_keypoints
        self.regressor = nn.Sequential(
            nn.Linear(csi_dim, 1024),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(1024, 512),
            nn.GELU(),
            nn.Linear(512, n_keypoints * 3),
        )

    def forward(self, csi_embedding: torch.Tensor) -> torch.Tensor:
        out = self.regressor(csi_embedding)
        return out.view(-1, self.n_keypoints, 3)
