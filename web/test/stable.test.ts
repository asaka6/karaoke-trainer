import { describe, expect, it } from 'vitest';
import { StableNoteDetector } from '../src/lib/stable';
import { PitchTracker } from '../src/lib/tracker';

const DT = 0.0107;

function run(midiAt: (t: number) => number | null, dur: number) {
  const d = new StableNoteDetector();
  const got: number[] = [];
  for (let t = 0; t < dur; t += DT) {
    const r = d.push({ t, midi: midiAt(t), db: -20 });
    if (r.confirmed !== null) got.push(r.confirmed);
  }
  return got;
}

describe('StableNoteDetector', () => {
  it('0.5秒以上続いた音を1回だけ確定する', () => {
    expect(run(() => 60.2, 2)).toEqual([60]);
  });
  it('0.4秒しか続かない音は採用しない', () => {
    expect(run((t) => (t < 0.4 ? 62 : null), 2)).toEqual([]);
  });
  it('±30セントの揺れは安定とみなす', () => {
    expect(run((t) => 64 + 0.3 * Math.sin(2 * Math.PI * 5 * t), 1)).toEqual([64]);
  });
  it('音がふらつく（±1半音）と採用しない', () => {
    expect(run((t) => 64 + Math.sin(2 * Math.PI * 3 * t), 2)).toEqual([]);
  });
  it('別の音に移ったら改めて計測する', () => {
    expect(run((t) => (t < 0.7 ? 55 : 67), 1.5)).toEqual([55, 67]);
  });
  it('短い途切れ（1フレーム）は許容する', () => {
    expect(run((t) => (Math.abs(t - 0.25) < DT / 2 ? null : 70), 1)).toEqual([70]);
  });
});

describe('PitchTracker', () => {
  it('小さい音・周期性の低いフレームは null', () => {
    const tr = new PitchTracker();
    const out = [
      tr.push({ t: 0, freq: 440, clarity: 0.95, rms: 0.0001 }),
      tr.push({ t: 0.01, freq: 440, clarity: 0.3, rms: 0.1 }),
    ];
    expect(out.map((p) => p.midi)).toEqual([null, null]);
  });
  it('単発の誤推定（オクターブ跳び）をメディアンで消す', () => {
    const tr = new PitchTracker();
    const f = [440, 440, 880, 440, 440];
    const out = f.map((freq, i) => tr.push({ t: i * DT, freq, clarity: 0.95, rms: 0.1 }).midi);
    expect(out[2]).toBeCloseTo(69, 5);
    expect(out[4]).toBeCloseTo(69, 5);
  });
});
