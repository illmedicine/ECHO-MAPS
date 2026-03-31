"""GAN-based pose discriminator for calibration confidence scoring.

During the "Training" step of the calibration phase, this GAN competes to
determine if a human pose can be accurately guessed from CSI alone, using
the video-derived skeletal ground truth as the "answer."

When the discriminator can no longer distinguish CSI-predicted poses from
camera-observed poses at ~95% accuracy, calibration is complete.
"""

from __future__ import annotations

import torch
import torch.nn as nn


class PoseGenerator(nn.Module):
    """Generator: CSI latent → predicted 3D skeletal pose.

    Attempts to fool the discriminator by producing realistic poses
    from CSI embeddings alone.

    Input:  (batch, latent_dim)
    Output: (batch, n_keypoints, 3)
    """

    def __init__(self, latent_dim: int = 512, n_keypoints: int = 33) -> None:
        super().__init__()
        self.n_keypoints = n_keypoints
        self.net = nn.Sequential(
            nn.Linear(latent_dim, 1024),
            nn.LayerNorm(1024),
            nn.GELU(),
            nn.Linear(1024, 512),
            nn.LayerNorm(512),
            nn.GELU(),
            nn.Linear(512, 256),
            nn.GELU(),
            nn.Linear(256, n_keypoints * 3),
        )

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        out = self.net(z)
        return out.view(-1, self.n_keypoints, 3)


class PoseDiscriminator(nn.Module):
    """Discriminator: classifies poses as "real" (from camera) or "fake" (from CSI).

    Input:  (batch, n_keypoints, 3)
    Output: (batch, 1) — probability that the pose is "real"
    """

    def __init__(self, n_keypoints: int = 33) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Flatten(),
            nn.Linear(n_keypoints * 3, 256),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(128, 1),
        )

    def forward(self, pose: torch.Tensor) -> torch.Tensor:
        return self.net(pose)


class CalibrationGAN:
    """Manages the adversarial calibration training loop.

    Tracks the discriminator's ability to tell CSI-generated poses from
    camera-observed poses. When the discriminator's accuracy drops to ~50%
    (i.e., the generator's poses are indistinguishable from real), the
    pose-match accuracy is ~95%+ and calibration is declared complete.
    """

    def __init__(
        self,
        latent_dim: int = 512,
        n_keypoints: int = 33,
        lr: float = 2e-4,
        device: str = "cpu",
    ) -> None:
        self.device = torch.device(device)
        self.generator = PoseGenerator(latent_dim, n_keypoints).to(self.device)
        self.discriminator = PoseDiscriminator(n_keypoints).to(self.device)

        self.opt_g = torch.optim.AdamW(self.generator.parameters(), lr=lr, betas=(0.5, 0.999))
        self.opt_d = torch.optim.AdamW(
            self.discriminator.parameters(), lr=lr, betas=(0.5, 0.999)
        )
        self.criterion = nn.BCEWithLogitsLoss()

    def train_step(
        self,
        csi_latents: torch.Tensor,
        real_poses: torch.Tensor,
    ) -> dict[str, float]:
        """Single adversarial training step.

        Returns dict with 'd_loss', 'g_loss', 'pose_match_accuracy'.
        """
        batch_size = csi_latents.size(0)
        real_labels = torch.ones(batch_size, 1, device=self.device)
        fake_labels = torch.zeros(batch_size, 1, device=self.device)

        # ── Train Discriminator ──
        self.opt_d.zero_grad()
        real_preds = self.discriminator(real_poses)
        d_loss_real = self.criterion(real_preds, real_labels)

        fake_poses = self.generator(csi_latents).detach()
        fake_preds = self.discriminator(fake_poses)
        d_loss_fake = self.criterion(fake_preds, fake_labels)

        d_loss = (d_loss_real + d_loss_fake) / 2.0
        d_loss.backward()
        self.opt_d.step()

        # ── Train Generator ──
        self.opt_g.zero_grad()
        fake_poses = self.generator(csi_latents)
        fake_preds = self.discriminator(fake_poses)
        g_loss = self.criterion(fake_preds, real_labels)  # fool the discriminator

        # Pose reconstruction loss (L1 distance to ground truth)
        recon_loss = nn.functional.l1_loss(fake_poses, real_poses)
        total_g_loss = g_loss + 10.0 * recon_loss
        total_g_loss.backward()
        self.opt_g.step()

        # ── Compute pose-match accuracy ──
        with torch.no_grad():
            pred_poses = self.generator(csi_latents)
            per_joint_dist = torch.norm(pred_poses - real_poses, dim=-1)  # (B, K)
            match_threshold = 0.05  # 5cm threshold
            matches = (per_joint_dist < match_threshold).float().mean()

        return {
            "d_loss": d_loss.item(),
            "g_loss": total_g_loss.item(),
            "pose_match_accuracy": matches.item(),
        }
