"""ボーカルの基本周波数 (F0) 抽出。torchcrepe があればそれを、なければ librosa の pyin を使う。

どちらも 16kHz・10ms ホップの (f0[Hz], voiced) を返す。無声フレームは f0 = NaN。
"""
from __future__ import annotations

import numpy as np

SR = 16000
HOP = 160  # 10ms
FMIN = 65.0  # C2 付近
FMAX = 1100.0  # C6 付近


def available_method() -> str:
    try:
        import torchcrepe  # noqa: F401

        return "crepe"
    except ImportError:
        return "pyin"


def energy_gate(y: np.ndarray, n_frames: int, below_peak_db: float = 35.0) -> np.ndarray:
    """分離の残り（他の楽器のにじみ）を有声と誤認しないよう、ボーカルの音量が小さいフレームを落とす"""
    pad = np.pad(y, (HOP, HOP))
    rms = np.array([np.sqrt(np.mean(pad[i * HOP : i * HOP + 2 * HOP] ** 2) + 1e-12) for i in range(n_frames)])
    db = 20 * np.log10(rms + 1e-9)
    return db >= np.percentile(db, 95) - below_peak_db


def extract_f0(
    y: np.ndarray,
    method: str = "auto",
    device: str = "cpu",
    crepe_model: str = "full",
    periodicity_threshold: float = 0.5,
) -> np.ndarray:
    """モノラル 16kHz の y から 10ms ごとの F0 [Hz]（無声は NaN）を返す"""
    if method == "auto":
        method = available_method()
    if method == "crepe":
        f0, conf = _crepe(y, device, crepe_model)
        voiced = conf >= periodicity_threshold
    elif method == "pyin":
        f0, voiced = _pyin(y)
    else:
        raise ValueError(method)
    n = len(f0)
    voiced &= energy_gate(y, n)
    return np.where(voiced, f0, np.nan)


def _crepe(y: np.ndarray, device: str, model: str) -> tuple[np.ndarray, np.ndarray]:
    import torch
    import torchcrepe

    audio = torch.from_numpy(y.astype(np.float32))[None]
    f0, periodicity = torchcrepe.predict(
        audio,
        SR,
        HOP,
        FMIN,
        FMAX,
        model=model,
        decoder=torchcrepe.decode.viterbi,
        return_periodicity=True,
        batch_size=1024,
        device=device,
        pad=True,
    )
    periodicity = torchcrepe.filter.median(periodicity, 3)
    return f0[0].cpu().numpy().astype(float), periodicity[0].cpu().numpy().astype(float)


def _pyin(y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import librosa

    f0, voiced, _ = librosa.pyin(y, fmin=FMIN, fmax=FMAX, sr=SR, frame_length=1024, hop_length=HOP, center=True)
    return np.nan_to_num(f0, nan=0.0), voiced.astype(bool)
