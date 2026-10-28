"""E2E テスト用の「疑似歌声」WAV を作る（Chrome の偽マイク入力に使う）。

倍音を含む波形＋軽いビブラートで、音の並びは
A3(1.0s) → 休 → C4(1.0s) → 休 → E4(0.3s: 短いので音域に採用されない) → 休 → G3(1.0s) → 休
"""
import sys
import wave

import numpy as np

SR = 48000
SEQ = [(57, 1.0), (None, 0.2), (60, 1.0), (None, 0.2), (64, 0.3), (None, 0.2), (55, 1.0), (None, 0.5)]


def tone(midi: int, dur: float) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    f0 = 440 * 2 ** ((midi - 69) / 12) * 2 ** (0.15 / 12 * np.sin(2 * np.pi * 5.5 * t))  # ±15セント
    phase = 2 * np.pi * np.cumsum(f0) / SR
    y = sum(a * np.sin((k + 1) * phase) for k, a in enumerate([1.0, 0.6, 0.35, 0.2, 0.1]))
    env = np.minimum(1, np.minimum(t / 0.03, (dur - t) / 0.03))
    return 0.25 * y * env


def main(path: str) -> None:
    parts = [tone(m, d) if m is not None else np.zeros(int(SR * d)) for m, d in SEQ]
    y = np.concatenate(parts)
    pcm = (np.clip(y, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main(sys.argv[1])
