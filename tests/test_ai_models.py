"""Tests for AI models — LatentCSI, WaveFormer, CroSSL, CalibrationGAN."""

import torch
import pytest


def test_latent_csi_forward():
    from echo_maps.ai.latent_csi import LatentCSI

    model = LatentCSI(n_subcarriers=64, n_timesteps=50, latent_dim=128, n_points=256)
    csi = torch.randn(2, 2, 64, 50)
    points, mu, logvar = model(csi)
    assert points.shape == (2, 256, 3)
    assert mu.shape == (2, 128)
    assert logvar.shape == (2, 128)


def test_latent_csi_encode_decode():
    from echo_maps.ai.latent_csi import LatentCSI

    model = LatentCSI(n_subcarriers=64, n_timesteps=50, latent_dim=128, n_points=256)
    csi = torch.randn(1, 2, 64, 50)
    z = model.encode(csi)
    assert z.shape == (1, 128)
    points = model.decode(z)
    assert points.shape == (1, 256, 3)


def test_wave_former_forward():
    from echo_maps.ai.wave_former import WaveFormer

    model = WaveFormer(d_input=128, d_model=64, n_heads=4, n_layers=2)
    x = torch.randn(2, 50, 128)
    out = model(x)
    assert out.shape == (2, 50, 64)


def test_vital_sign_head():
    from echo_maps.ai.wave_former import WaveFormer, VitalSignHead

    wf = WaveFormer(d_input=128, d_model=64, n_heads=4, n_layers=2)
    head = VitalSignHead(d_model=64)
    x = torch.randn(2, 50, 128)
    features = wf(x)
    vitals = head(features)
    assert vitals.shape == (2, 2)
    assert torch.all(vitals > 0)  # Softplus ensures positive


def test_activity_classifier():
    from echo_maps.ai.wave_former import WaveFormer, ActivityClassifierHead

    wf = WaveFormer(d_input=128, d_model=64, n_heads=4, n_layers=2)
    head = ActivityClassifierHead(d_model=64, n_activities=8)
    x = torch.randn(2, 50, 128)
    features = wf(x)
    logits = head(features)
    assert logits.shape == (2, 8)


def test_crossl_forward():
    from echo_maps.ai.cross_modal import CroSSLFramework

    model = CroSSLFramework(n_keypoints=33, csi_dim=128, latent_dim=128)
    csi_emb = torch.randn(4, 128)
    keypoints = torch.randn(4, 33, 3)
    out = model(csi_emb, keypoints)
    assert "loss" in out
    assert "accuracy" in out
    assert out["loss"].requires_grad


def test_pose_regressor():
    from echo_maps.ai.cross_modal import PoseRegressor

    model = PoseRegressor(csi_dim=128, n_keypoints=33)
    z = torch.randn(2, 128)
    pose = model(z)
    assert pose.shape == (2, 33, 3)


def test_calibration_gan_step():
    from echo_maps.ai.calibration_gan import CalibrationGAN

    gan = CalibrationGAN(latent_dim=128, n_keypoints=33, device="cpu")
    latents = torch.randn(4, 128)
    poses = torch.randn(4, 33, 3)
    metrics = gan.train_step(latents, poses)
    assert "d_loss" in metrics
    assert "g_loss" in metrics
    assert "pose_match_accuracy" in metrics
    assert 0.0 <= metrics["pose_match_accuracy"] <= 1.0
