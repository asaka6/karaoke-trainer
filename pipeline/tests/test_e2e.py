"""合成した「歌＋伴奏」で CLI を最後まで通すテスト（torch/demucs が入っている環境で実行）

  pytest -m slow -s
"""
import json
import wave
from pathlib import Path

import numpy as np
import pytest

from karaoke_pipeline.cli import main

SR = 44100
# (MIDI, 長さ[s])  None は休符
MELODY = [(60, 0.6), (62, 0.6), (64, 0.6), (65, 0.6), (67, 1.2), (None, 0.4), (67, 0.6), (65, 0.6), (64, 0.6), (62, 0.6), (60, 1.2), (None, 0.5)]


def _voice(midi, dur, sr=SR):
    t = np.arange(int(sr * dur)) / sr
    f0 = 440 * 2 ** ((midi - 69) / 12) * 2 ** (0.3 / 12 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.4, 0, 1))
    ph = 2 * np.pi * np.cumsum(f0) / sr
    # 母音っぽく 2〜4 倍音を強めにする
    y = sum(a * np.sin((k + 1) * ph) for k, a in enumerate([0.7, 1.0, 0.8, 0.5, 0.3, 0.2, 0.1]))
    env = np.minimum(1, np.minimum(t / 0.04, (dur - t) / 0.06))
    return 0.15 * y * env


def make_vocal():
    return np.concatenate([_voice(m, d) if m else np.zeros(int(SR * d)) for m, d in MELODY])


def make_mix():
    v = make_vocal()
    n = len(v)
    t = np.arange(n) / SR
    rng = np.random.default_rng(0)
    bass = 0.15 * np.sin(2 * np.pi * 65.4 * t) * (1 + 0.3 * np.sin(2 * np.pi * 2 * t))
    kick = np.zeros(n)
    for k in np.arange(0, n / SR, 0.5):
        i = int(k * SR)
        seg = np.arange(min(4000, n - i)) / SR
        kick[i : i + len(seg)] += 0.5 * np.sin(2 * np.pi * (60 + 80 * np.exp(-seg * 40)) * seg) * np.exp(-seg * 12)
    hat = 0.03 * rng.standard_normal(n) * (np.sin(2 * np.pi * 4 * t) > 0.7)
    acc = bass + kick + hat
    return np.stack([v + acc, v + acc], axis=1)


def write_wav(path: Path, y: np.ndarray):
    y = np.atleast_2d(y.T).T
    pcm = (np.clip(y, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def expected_notes():
    out, t = [], 0.0
    for m, d in MELODY:
        if m:
            out.append((t, t + d, m))
        t += d
    return out


def match_rate(notes, expected):
    """正解の各音符の時間のうち、同じ MIDI の推定音符で覆われている割合"""
    hit = total = 0.0
    for s, e, m in expected:
        total += e - s
        for n in notes:
            if n["midi"] == m:
                hit += max(0.0, min(e, n["end"]) - max(s, n["start"]))
    return hit / total


@pytest.mark.slow
@pytest.mark.parametrize("f0", ["crepe", "pyin"])
def test_vocal_only(tmp_path, f0):
    src = tmp_path / "Test Artist - Vocal Only.wav"
    write_wav(src, make_vocal())
    out = tmp_path / "songs"
    assert main([str(src), "-o", str(out), "--no-separate", "--f0", f0]) == 0
    song = json.loads((out / "Test_Artist_-_Vocal_Only" / "Test_Artist_-_Vocal_Only.json").read_text(encoding="utf-8"))
    assert song["title"] == "Vocal Only" and song["artist"] == "Test Artist"
    assert song["range"] == {"min": 60, "max": 67}
    rate = match_rate(song["notes"], expected_notes())
    print(f"{f0}: notes={len(song['notes'])} match={rate:.2f}")
    assert rate > 0.85


@pytest.mark.slow
def test_full_pipeline_with_demucs_and_folder(tmp_path):
    d = tmp_path / "in"
    d.mkdir()
    write_wav(d / "mix1.wav", make_mix())
    write_wav(d / "mix2.wav", make_mix()[: SR * 3])
    out = tmp_path / "songs"
    assert main([str(d), "-o", str(out)]) == 0
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert [s["id"] for s in index["songs"]] == ["mix1", "mix2"]
    assert (out / "mix1" / "accompaniment.mp3").stat().st_size > 10_000
    song = json.loads((out / "mix1" / "mix1.json").read_text(encoding="utf-8"))
    rate = match_rate(song["notes"], expected_notes())
    print(f"demucs+auto: notes={len(song['notes'])} match={rate:.2f} range={song['range']}")
    assert rate > 0.6
    # 2回目は処理済みとしてスキップされる
    assert main([str(d / "mix1.wav"), "-o", str(out)]) == 0
