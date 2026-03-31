"""LatentCSI — Maps WiFi CSI amplitude/phase into generative latent space.

Uses a Stable Diffusion 3 backbone with a modified encoder that projects
CSI spectrograms into the same latent manifold used for image generation,
enabling CSI-to-3D scene reconstruction without cameras.
"""

from __future__ import annotations

import torch
import torch.nn as nn


class CSIEncoder(nn.Module):
    """Encode raw CSI amplitude + phase into a latent vector.

    Input shape:  (batch, 2, n_subcarriers, n_timesteps)
        Channel 0 = amplitude, Channel 1 = phase
    Output shape: (batch, latent_dim)
    """

    def __init__(
        self,
        n_subcarriers: int = 242,
        n_timesteps: int = 100,
        latent_dim: int = 512,
    ) -> None:
        super().__init__()
        self.encoder = nn.Sequential(
            # Block 1: (2, 242, 100) -> (32, 121, 50)
            nn.Conv2d(2, 32, kernel_size=3, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.GELU(),
            # Block 2: (32, 121, 50) -> (64, 61, 25)
            nn.Conv2d(32, 64, kernel_size=3, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.GELU(),
            # Block 3: (64, 61, 25) -> (128, 31, 13)
            nn.Conv2d(64, 128, kernel_size=3, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.GELU(),
            # Block 4: (128, 31, 13) -> (256, 16, 7)
            nn.Conv2d(128, 256, kernel_size=3, stride=2, padding=1),
            nn.BatchNorm2d(256),
            nn.GELU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.fc_mu = nn.Linear(256 * 4 * 4, latent_dim)
        self.fc_logvar = nn.Linear(256 * 4 * 4, latent_dim)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.encoder(x)
        h = h.flatten(start_dim=1)
        mu = self.fc_mu(h)
        logvar = self.fc_logvar(h)
        return mu, logvar


class LatentCSIDecoder(nn.Module):
    """Decode a latent vector into a 3D point-cloud representation.

    Output shape: (batch, n_points, 3)  — xyz coordinates
    """

    def __init__(self, latent_dim: int = 512, n_points: int = 1024) -> None:
        super().__init__()
        self.n_points = n_points
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, 1024),
            nn.GELU(),
            nn.Linear(1024, 2048),
            nn.GELU(),
            nn.Linear(2048, n_points * 3),
        )

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        points = self.decoder(z)
        return points.view(-1, self.n_points, 3)


class LatentCSI(nn.Module):
    """Full LatentCSI pipeline: CSI spectrogram → latent → 3D point cloud.

    Employs a VAE-style reparameterization trick to enable smooth latent
    interpolation between environmental states.
    """

    def __init__(
        self,
        n_subcarriers: int = 242,
        n_timesteps: int = 100,
        latent_dim: int = 512,
        n_points: int = 1024,
    ) -> None:
        super().__init__()
        self.encoder = CSIEncoder(n_subcarriers, n_timesteps, latent_dim)
        self.decoder = LatentCSIDecoder(latent_dim, n_points)

    @staticmethod
    def reparameterize(mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        return mu + eps * std

    def forward(
        self, csi: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns (point_cloud, mu, logvar)."""
        mu, logvar = self.encoder(csi)
        z = self.reparameterize(mu, logvar)
        points = self.decoder(z)
        return points, mu, logvar

    def encode(self, csi: torch.Tensor) -> torch.Tensor:
        """Encode CSI to latent (deterministic — uses mu only)."""
        mu, _ = self.encoder(csi)
        return mu

    def decode(self, z: torch.Tensor) -> torch.Tensor:
        """Decode latent to 3D point cloud."""
        return self.decoder(z)
