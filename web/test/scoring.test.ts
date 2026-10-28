import { describe, expect, it } from 'vitest';
import { detectShakuri, scoreSong } from '../src/lib/scoring';
import type { SongNote } from '../src/lib/song';
import type { PitchPoint } from '../src/lib/tracker';

const DT = 0.0107; // worklet のホップ（約10.7ms）

const NOTES: SongNote[] = [
  { start: 0.0, end: 1.0, midi: 60 },
  { start: 1.2, end: 2.2, midi: 64 },
  { start: 2.4, end: 3.6, midi: 67 },
  { start: 3.8, end: 4.4, midi: 65 },
  { start: 4.6, end: 6.0, midi: 62 },
];

type Shape = (note: SongNote, tIn: number, i: number) => number | null;

/** 音符に沿って歌った合成ピッチ列を作る */
function sing(shape: Shape, db: (i: number) => number = () => -20): PitchPoint[] {
  const pts: PitchPoint[] = [];
  for (let t = 0; t < 6.2; t += DT) {
    const i = NOTES.findIndex((n) => t >= n.start && t < n.end);
    const midi = i < 0 ? null : shape(NOTES[i], t - NOTES[i].start, i);
    pts.push({ t, midi, db: midi === null ? -70 : db(i) });
  }
  return pts;
}

describe('scoreSong', () => {
  it('正確に歌えば音程・安定性が高い', () => {
    const r = scoreSong(NOTES, sing((n) => n.midi + 0.05));
    expect(r.pitch).toBeGreaterThanOrEqual(98);
    expect(r.stability).toBeGreaterThanOrEqual(95);
    expect(r.sections).toEqual([]);
  });

  it('1オクターブ下で歌っても音程は正解扱い', () => {
    const r = scoreSong(NOTES, sing((n) => n.midi - 12));
    expect(r.pitch).toBeGreaterThanOrEqual(98);
  });

  it('半音ずれると音程が低く、ズレた区間が「高め」として出る', () => {
    const r = scoreSong(NOTES, sing((n, _t, i) => (i === 2 ? n.midi + 0.9 : n.midi)));
    expect(r.pitch).toBeLessThan(85);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]).toMatchObject({ start: 2.4, end: 3.6, kind: 'sharp' });
  });

  it('歌っていない区間は「声が出ていない」', () => {
    const r = scoreSong(NOTES, sing((n, _t, i) => (i === 4 ? null : n.midi)));
    expect(r.sections.at(-1)!.kind).toBe('silent');
  });

  it('ロングトーンでふらつくと安定性が下がる（ビブラートでは下がらない）', () => {
    const wobble = scoreSong(NOTES, sing((n, t) => n.midi + 0.4 * Math.sin(2 * Math.PI * 1.2 * t)));
    const vibrato = scoreSong(NOTES, sing((n, t) => n.midi + 0.3 * Math.sin(2 * Math.PI * 6 * t)));
    expect(wobble.stability!).toBeLessThan(50);
    expect(vibrato.stability!).toBeGreaterThan(85);
  });

  it('ビブラート（6Hz・±30セント）を検出し、まっすぐな声では検出しない', () => {
    const v = scoreSong(NOTES, sing((n, t) => n.midi + (t > 0.3 ? 0.3 * Math.sin(2 * Math.PI * 6 * t) : 0)));
    expect(v.vibrato.count).toBeGreaterThanOrEqual(3);
    const rate = v.notes.find((r) => r.vibrato)!.vibrato!.rate;
    expect(rate).toBeGreaterThan(5.5);
    expect(rate).toBeLessThan(6.5);
    const flat = scoreSong(NOTES, sing((n) => n.midi));
    expect(flat.vibrato.count).toBe(0);
  });

  it('遅い揺れ（2Hz）はビブラートとみなさない', () => {
    const r = scoreSong(NOTES, sing((n, t) => n.midi + 0.3 * Math.sin(2 * Math.PI * 2 * t)));
    expect(r.vibrato.count).toBe(0);
  });

  it('しゃくり（半音強下から0.15秒で上がる）を検出する', () => {
    const r = scoreSong(NOTES, sing((n, t, i) => (i === 1 || i === 3) && t < 0.15 ? n.midi - 1.5 + (t / 0.15) * 1.5 : n.midi));
    expect(r.shakuri.count).toBe(2);
    expect(r.notes.filter((x) => x.shakuri).map((x) => x.index)).toEqual([1, 3]);
    expect(scoreSong(NOTES, sing((n) => n.midi)).shakuri.count).toBe(0);
  });

  it('抑揚：音量差が大きいほど高い', () => {
    const flat = scoreSong(NOTES, sing((n) => n.midi, () => -20));
    const dyn = scoreSong(NOTES, sing((n) => n.midi, (i) => -30 + i * 4));
    expect(flat.expression).toBe(0);
    expect(dyn.expression!).toBeGreaterThan(80);
  });

  it('範囲指定で途中から歌った分だけ採点する', () => {
    const r = scoreSong(NOTES, sing((n) => n.midi), { start: 2.3, end: 10 });
    expect(r.notes.map((x) => x.index)).toEqual([2, 3, 4]);
  });
});

describe('detectShakuri', () => {
  it('前の音から切れ目なく上がるスラーは数えない', () => {
    const prev = { start: 0, end: 1, midi: 60 };
    const note = { start: 1, end: 2, midi: 62 };
    const pts: PitchPoint[] = [];
    for (let t = 0.5; t < 2; t += DT) pts.push({ t, midi: t < 1 ? 60 : t < 1.15 ? 60 + ((t - 1) / 0.15) * 2 : 62, db: -20 });
    expect(detectShakuri(pts, note, prev)).toBe(false);
  });
});
