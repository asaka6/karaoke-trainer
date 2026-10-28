"""音符セグメンテーションのテスト（合成した F0 列で確認。重い依存は不要）"""
import numpy as np

from karaoke_pipeline.notes import Note, freq_to_midi, note_range, segment_notes

HOP = 0.01


def synth_track(seq, vibrato_cents=0.0, glide=0.0, noise_cents=0.0, seed=0):
    """seq = [(midi or None, dur)] から 10ms ごとの MIDI 列を作る"""
    rng = np.random.default_rng(seed)
    out = []
    prev = None
    for midi, dur in seq:
        n = int(round(dur / HOP))
        if midi is None:
            out += [np.nan] * n
            prev = None
            continue
        t = np.arange(n) * HOP
        m = np.full(n, float(midi))
        m += vibrato_cents / 100 * np.sin(2 * np.pi * 6 * t)
        if glide and prev is not None:
            g = min(n, int(glide / HOP))
            m[:g] = np.linspace(prev, midi, g)
        m += rng.normal(0, noise_cents / 100, n)
        out += list(m)
        prev = midi
    return np.array(out)


def as_tuples(notes):
    return [(round(n.start, 2), round(n.end, 2), n.midi) for n in notes]


def test_simple_melody():
    seq = [(60, 0.5), (None, 0.1), (62, 0.5), (None, 0.1), (64, 1.0)]
    notes = segment_notes(synth_track(seq), HOP)
    assert [n.midi for n in notes] == [60, 62, 64]
    assert abs(notes[0].start - 0) < 0.02 and abs(notes[0].end - 0.5) < 0.02
    assert abs(notes[2].start - 1.2) < 0.02 and abs(notes[2].end - 2.2) < 0.02


def test_legato_without_gaps_is_split():
    seq = [(57, 0.4), (59, 0.4), (60, 0.4), (64, 0.6)]
    notes = segment_notes(synth_track(seq, glide=0.04), HOP)
    assert [n.midi for n in notes] == [57, 59, 60, 64]


def test_vibrato_does_not_split():
    seq = [(67, 2.0)]
    notes = segment_notes(synth_track(seq, vibrato_cents=50, noise_cents=5), HOP)
    assert [n.midi for n in notes] == [67]
    assert notes[0].dur > 1.9


def test_short_blips_and_octave_errors_removed():
    seq = [(60, 0.5), (72, 0.05), (60, 0.5), (None, 0.1), (62, 0.4), (None, 0.1), (86, 0.15), (None, 0.1), (62, 0.4), (64, 0.4)]
    notes = segment_notes(synth_track(seq), HOP)
    midis = [n.midi for n in notes]
    assert 72 not in midis  # 50ms の跳びは短すぎて除去
    assert 86 not in midis  # 前後から2オクターブ近く外れた音は外れ値として除去
    assert midis == [60, 62, 62, 64]


def test_same_pitch_dropout_is_merged():
    seq = [(65, 0.5), (None, 0.03), (65, 0.5)]
    notes = segment_notes(synth_track(seq), HOP)
    assert as_tuples(notes) == [(0.0, 1.03, 65)]


def test_range_ignores_very_short_notes():
    notes = [Note(0, 0.5, 55), Note(0.5, 0.62, 50), Note(1, 1.5, 67), Note(2, 2.11, 72)]
    assert note_range(notes) == {"min": 55, "max": 67}


def test_freq_to_midi():
    m = freq_to_midi(np.array([440.0, 0.0, np.nan, 261.6256]))
    assert np.isclose(m[0], 69) and np.isnan(m[1]) and np.isnan(m[2]) and np.isclose(m[3], 60, atol=1e-3)
