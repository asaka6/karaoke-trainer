"""Demucs でボーカルと伴奏に分離する。"""
from __future__ import annotations

import os

import numpy as np

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

_MODEL_CACHE: dict = {}


def pick_device(pref: str = "auto") -> str:
    import torch

    if pref != "auto":
        return pref
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def separate(audio: np.ndarray, sr: int, model_name: str = "htdemucs", device: str = "cpu") -> tuple[np.ndarray, np.ndarray]:
    """(samples, 2) の音声を受け取り、(vocals, accompaniment) を同じ形で返す。sr は 44100 であること。"""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if model_name not in _MODEL_CACHE:
        m = get_model(model_name)
        m.eval()
        _MODEL_CACHE[model_name] = m
    model = _MODEL_CACHE[model_name]
    if sr != model.samplerate:
        raise ValueError(f"sample rate must be {model.samplerate}")

    wav = torch.from_numpy(audio.T.copy())  # (2, n)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25, progress=True)[0]
    sources = sources * std + mean
    vi = model.sources.index("vocals")
    vocals = sources[vi]
    accomp = sources[[i for i in range(len(model.sources)) if i != vi]].sum(0)
    return vocals.numpy().T, accomp.numpy().T
