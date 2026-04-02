"""Spatial Orientation Attention Module.

Phase 4: Collision & Occlusion Handling.  When two RF blobs merge during
a path crossing, this module analyzes the resulting blobs after separation
to re-assign the correct identity using gait rhythm, trajectory, and
RF Signature matching.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class SpatialOrientationAttention(nn.Module):
    """Attention module for resolving RF blob identity after collision.

    Takes pre-merge trajectory context + post-separation RF features
    and uses cross-attention to match separated blobs to their
    pre-merge identities.

    Inputs:
        pre_merge_features:  (batch, n_tracks, d_model) — RF features before merge
        post_split_features: (batch, n_blobs, d_model)  — RF features after separation

    Output:
        assignment_logits: (batch, n_blobs, n_tracks) — soft assignment matrix
    """

    def __init__(self, d_model: int = 256, n_heads: int = 4, dropout: float = 0.1) -> None:
        super().__init__()

        self.query_proj = nn.Linear(d_model, d_model)
        self.key_proj = nn.Linear(d_model, d_model)
        self.value_proj = nn.Linear(d_model, d_model)

        self.attention = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=n_heads,
            dropout=dropout,
            batch_first=True,
        )

        self.gait_matcher = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, 1),
        )

        self.trajectory_encoder = nn.Sequential(
            nn.Linear(6, d_model),  # position (3) + velocity (3)
            nn.GELU(),
            nn.Linear(d_model, d_model),
        )

    def forward(
        self,
        pre_merge_features: torch.Tensor,
        post_split_features: torch.Tensor,
        pre_merge_trajectories: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """Compute identity assignment after blob separation.

        Returns:
            (batch, n_blobs, n_tracks) assignment probabilities
        """
        # Cross-attend: post-split blobs (query) attend to pre-merge tracks (key/value)
        q = self.query_proj(post_split_features)
        k = self.key_proj(pre_merge_features)
        v = self.value_proj(pre_merge_features)

        attended, _ = self.attention(q, k, v)

        # If trajectory context available, fuse it
        if pre_merge_trajectories is not None:
            traj_feat = self.trajectory_encoder(pre_merge_trajectories)
            k = k + traj_feat

        # Pairwise gait matching scores
        n_blobs = post_split_features.size(1)
        n_tracks = pre_merge_features.size(1)

        # Expand for pairwise comparison
        blob_exp = attended.unsqueeze(2).expand(-1, -1, n_tracks, -1)
        track_exp = pre_merge_features.unsqueeze(1).expand(-1, n_blobs, -1, -1)

        paired = torch.cat([blob_exp, track_exp], dim=-1)
        logits = self.gait_matcher(paired).squeeze(-1)  # (batch, n_blobs, n_tracks)

        return F.softmax(logits, dim=-1)


class BlobSeparator:
    """Manages the merge/separation lifecycle for RF blob collisions.

    Tracks when blobs are merged and triggers re-identification
    using SpatialOrientationAttention once they separate.
    """

    def __init__(
        self,
        merge_distance: float = 1.0,
        separation_distance: float = 1.5,
        d_model: int = 256,
        device: str = "cpu",
    ) -> None:
        self.merge_distance = merge_distance
        self.separation_distance = separation_distance
        self.device = torch.device(device)

        self.attention = SpatialOrientationAttention(d_model=d_model).to(self.device)
        self.attention.eval()

        # Stores pre-merge features for each merge event
        self._merge_cache: dict[str, dict] = {}

    def detect_merge(
        self,
        positions: dict[str, tuple[float, float, float]],
    ) -> list[tuple[str, str]]:
        """Detect pairs of tracks whose positions are within merge distance.

        Returns list of (track_id_a, track_id_b) pairs that are merging.
        """
        import numpy as np

        track_ids = list(positions.keys())
        merges = []
        for i in range(len(track_ids)):
            for j in range(i + 1, len(track_ids)):
                a = np.array(positions[track_ids[i]])
                b = np.array(positions[track_ids[j]])
                dist = float(np.linalg.norm(a - b))
                if dist < self.merge_distance:
                    merges.append((track_ids[i], track_ids[j]))
        return merges

    def cache_pre_merge(
        self,
        merge_key: str,
        track_features: dict[str, torch.Tensor],
        track_trajectories: dict[str, torch.Tensor],
    ) -> None:
        """Cache pre-merge RF features and trajectories for later matching."""
        self._merge_cache[merge_key] = {
            "features": track_features,
            "trajectories": track_trajectories,
        }

    def resolve_separation(
        self,
        merge_key: str,
        post_split_features: dict[str, torch.Tensor],
    ) -> dict[str, str]:
        """After separation, assign new blob IDs back to original track IDs.

        Returns mapping: {new_blob_id: original_track_id}
        """
        import numpy as np

        cache = self._merge_cache.pop(merge_key, None)
        if cache is None:
            return {}

        pre_features = cache["features"]
        pre_trajectories = cache["trajectories"]

        original_ids = list(pre_features.keys())
        new_ids = list(post_split_features.keys())

        if len(original_ids) == 0 or len(new_ids) == 0:
            return {}

        # Stack into tensors
        pre_feat_tensor = torch.stack([pre_features[tid] for tid in original_ids]).unsqueeze(0)
        post_feat_tensor = torch.stack([post_split_features[nid] for nid in new_ids]).unsqueeze(0)

        pre_traj_tensor = None
        if pre_trajectories:
            pre_traj_tensor = torch.stack(
                [pre_trajectories[tid] for tid in original_ids]
            ).unsqueeze(0)

        with torch.no_grad():
            assignment_probs = self.attention(
                pre_feat_tensor.to(self.device),
                post_feat_tensor.to(self.device),
                pre_traj_tensor.to(self.device) if pre_traj_tensor is not None else None,
            )

        # Hungarian-style greedy assignment
        probs = assignment_probs.squeeze(0).cpu().numpy()
        assignments = {}
        used_originals = set()

        for _ in range(min(len(new_ids), len(original_ids))):
            best_val = -1.0
            best_new = -1
            best_orig = -1
            for ni in range(len(new_ids)):
                if new_ids[ni] in assignments:
                    continue
                for oi in range(len(original_ids)):
                    if original_ids[oi] in used_originals:
                        continue
                    if probs[ni, oi] > best_val:
                        best_val = probs[ni, oi]
                        best_new = ni
                        best_orig = oi

            if best_new >= 0:
                assignments[new_ids[best_new]] = original_ids[best_orig]
                used_originals.add(original_ids[best_orig])

        return assignments
