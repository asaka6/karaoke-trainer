"""音声の読み書き。デコードは imageio-ffmpeg 同梱の ffmpeg を使うので、別途 ffmpeg を入れなくてよい。"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".opus"}


def ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def load_audio(path: Path, sr: int = 44100, channels: int = 2) -> np.ndarray:
    """任意の音声ファイルを float32 の (samples, channels) 配列として読む"""
    cmd = [ffmpeg_exe(), "-v", "error", "-nostdin", "-i", str(path), "-f", "f32le", "-ac", str(channels), "-ar", str(sr), "-"]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg でデコードできません: {path}\n{proc.stderr.decode(errors='replace')}")
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    return data.reshape(-1, channels).copy()


def save_mp3(path: Path, audio: np.ndarray, sr: int, kbps: int = 192) -> None:
    """(samples, channels) を MP3 で保存（スマホに送りやすいサイズにするため）"""
    import lameenc

    audio = np.atleast_2d(audio.T).T
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(sr)
    enc.set_channels(pcm.shape[1])
    enc.set_quality(2)
    data = enc.encode(pcm.tobytes()) + enc.flush()
    path.write_bytes(data)


def find_audio_files(inputs: list[Path]) -> list[Path]:
    """ファイルとフォルダ（再帰）が混ざった入力から音声ファイルを列挙"""
    files: list[Path] = []
    for p in inputs:
        if p.is_dir():
            files += sorted(f for f in p.rglob("*") if f.suffix.lower() in AUDIO_EXTS and f.is_file())
        elif p.is_file() and p.suffix.lower() in AUDIO_EXTS:
            files.append(p)
        else:
            raise FileNotFoundError(f"音声ファイルまたはフォルダではありません: {p}")
    return files
