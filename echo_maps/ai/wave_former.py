"""WaveFormer — Transformer-based temporal CSI sequence model.

Processes sequential CSI frames to capture temporal motion patterns
(breathing, gait, gestures) using self-attention over the RF time-series.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn


class PositionalEncoding(nn.Module):
    """Sinusoidal positional encoding for CSI time-series."""

    def __init__(self, d_model: int, max_len: int = 1000, dropout: float = 0.1) -> None:
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # (1, max_len, d_model)
        self.register_buffer("pe", pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.pe[:, : x.size(1)]
        return self.dropout(x)


class WaveFormer(nn.Module):
    """Temporal transformer for CSI frame sequences.

    Takes a sequence of CSI latent embeddings (from CSIEncoder or raw subcarrier
    features) and models temporal dependencies for activity recognition and
    vital-sign extraction.

    Input:  (batch, seq_len, d_input) — sequence of CSI feature vectors
    Output: (batch, seq_len, d_model) — contextualized representations
    """

    def __init__(
        self,
        d_input: int = 484,
        d_model: int = 256,
        n_heads: int = 8,
        n_layers: int = 6,
        d_ff: int = 1024,
        dropout: float = 0.1,
        max_seq_len: int = 1000,
    ) -> None:
        super().__init__()
        self.input_proj = nn.Linear(d_input, d_model)
        self.pos_enc = PositionalEncoding(d_model, max_seq_len, dropout)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.layer_norm = nn.LayerNorm(d_model)

    def forward(
        self,
        x: torch.Tensor,
        mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        x = self.input_proj(x)
        x = self.pos_enc(x)
        x = self.transformer(x, src_key_padding_mask=mask)
        return self.layer_norm(x)


class VitalSignHead(nn.Module):
    """Regression head for breathing rate and heart rate from WaveFormer output.

    Input:  (batch, seq_len, d_model)
    Output: (batch, 2) — [breathing_rate_bpm, heart_rate_bpm]
    """

    def __init__(self, d_model: int = 256) -> None:
        super().__init__()
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.head = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(128, 2),
            nn.Softplus(),  # rates are always positive
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, d_model) -> pool over seq_len
        x = x.transpose(1, 2)  # (batch, d_model, seq_len)
        x = self.pool(x).squeeze(-1)  # (batch, d_model)
        return self.head(x)


class ActivityClassifierHead(nn.Module):
    """Classification head for human activity recognition.

    Input:  (batch, seq_len, d_model)
    Output: (batch, n_activities)
    """

    ACTIVITIES = [
        "idle",
        "walking",
        "sitting_down",
        "standing_up",
        "reaching",
        "lying_down",
        "falling",
        "breathing_only",
    ]

    def __init__(self, d_model: int = 256, n_activities: int = 8) -> None:
        super().__init__()
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.head = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(128, n_activities),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.transpose(1, 2)
        x = self.pool(x).squeeze(-1)
        return self.head(x)
