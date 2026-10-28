"""F0 列（フレームごとの MIDI 値）を音符単位に区切る。numpy/scipy だけに依存する純粋な処理。

手順:
  1. 有声区間ごとにメディアンフィルタで平滑化
  2. 現在の音から split_threshold 半音以上離れた状態が split_frames 続いたら音符の境界とする
     （±50セント程度のビブラートでは切れない／しゃくりやポルタメントの途中は短い音符になり 3 で消える）
  3. 短すぎる音符を除去し、同じ高さで隙間の小さい音符をつなぐ
  4. 前後の音符から大きく外れた音符（オクターブ誤りなど）を除去
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import median_filter


@dataclass
class Note:
    start: float
    end: float
    midi: int

    @property
    def dur(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict:
        return {"start": round(self.start, 3), "end": round(self.end, 3), "midi": int(self.midi)}


@dataclass
class SegmentOptions:
    smooth_frames: int = 5  # メディアンフィルタ幅（10ms hop で 50ms）
    split_threshold: float = 0.7  # 半音
    split_frames: int = 4  # 境界と認める継続フレーム数
    min_note: float = 0.10  # これより短い音符は捨てる [s]
    merge_gap: float = 0.06  # 同じ高さでこれ以下の隙間ならつなぐ [s]
    outlier_window: int = 6  # 前後何音符と比べるか
    outlier_semitones: float = 9.0  # 近傍の中央値からこれ以上離れたら外れ値


def freq_to_midi(f0: np.ndarray) -> np.ndarray:
    """Hz → MIDI。0 以下や NaN は NaN にする。"""
    f0 = np.asarray(f0, dtype=float)
    out = np.full_like(f0, np.nan)
    ok = np.isfinite(f0) & (f0 > 0)
    out[ok] = 69 + 12 * np.log2(f0[ok] / 440.0)
    return out


def _voiced_runs(midi: np.ndarray) -> list[tuple[int, int]]:
    """NaN でない連続区間 [s, e) の一覧"""
    v = np.isfinite(midi).astype(np.int8)
    d = np.diff(np.concatenate([[0], v, [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def segment_notes(midi: np.ndarray, hop_s: float, opts: SegmentOptions | None = None) -> list[Note]:
    opts = opts or SegmentOptions()
    notes: list[Note] = []
    for s, e in _voiced_runs(midi):
        raw = midi[s:e]
        sm = median_filter(raw, size=min(opts.smooth_frames, len(raw)), mode="nearest")
        bounds = [0]
        cur = sm[0]
        pending = 0
        for i in range(1, len(sm)):
            if abs(sm[i] - cur) > opts.split_threshold:
                pending += 1
                if pending >= opts.split_frames:
                    b = i - pending + 1
                    bounds.append(b)
                    cur = float(np.median(sm[b : i + 1]))
                    pending = 0
            else:
                pending = 0
                # 同じ音の中でのゆっくりした変化に追従する
                cur = 0.9 * cur + 0.1 * sm[i]
        bounds.append(len(sm))
        for a, b in zip(bounds[:-1], bounds[1:]):
            if b <= a:
                continue
            notes.append(Note(start=(s + a) * hop_s, end=(s + b) * hop_s, midi=int(round(float(np.median(raw[a:b]))))))

    notes = [n for n in notes if n.dur >= opts.min_note]
    notes = merge_notes(notes, opts.merge_gap)
    notes = remove_outliers(notes, opts.outlier_window, opts.outlier_semitones)
    return merge_notes(notes, opts.merge_gap)


def merge_notes(notes: list[Note], gap: float) -> list[Note]:
    out: list[Note] = []
    for n in notes:
        if out and out[-1].midi == n.midi and n.start - out[-1].end <= gap:
            out[-1] = Note(out[-1].start, n.end, n.midi)
        else:
            out.append(Note(n.start, n.end, n.midi))
    return out


def remove_outliers(notes: list[Note], window: int, max_dev: float) -> list[Note]:
    if len(notes) < 3:
        return notes
    midis = np.array([n.midi for n in notes], dtype=float)
    keep = []
    for i, n in enumerate(notes):
        lo, hi = max(0, i - window), min(len(notes), i + window + 1)
        neigh = np.concatenate([midis[lo:i], midis[i + 1 : hi]])
        keep.append(abs(n.midi - np.median(neigh)) < max_dev)
    return [n for n, k in zip(notes, keep) if k]


def note_range(notes: list[Note], min_dur: float = 0.15) -> dict | None:
    """曲の音域。一瞬だけの音で音域が広がらないよう、min_dur 以上の音符だけで決める。"""
    use = [n.midi for n in notes if n.dur >= min_dur] or [n.midi for n in notes]
    if not use:
        return None
    return {"min": int(min(use)), "max": int(max(use))}
