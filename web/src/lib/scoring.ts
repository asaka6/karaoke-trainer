// 歌唱の採点（純粋関数）。入力は曲の音符（キー変更済み）と、曲の時刻に揃えたピッチ列。
//
//   音程正確率 … 音符の区間で、オクターブ違いを無視して ±50 セント以内だったフレームの割合
//   安定性     … ロングトーン中の揺れ（ビブラートは平滑化で除き、ふらつきだけを見る）
//   抑揚       … 音符ごとの平均音量のばらつき（上位10%と下位10%の差 [dB]）
//   ビブラート … ロングトーン中の 4.5〜8Hz・振幅 ±15 セント以上の周期的な揺れ
//   しゃくり   … 音の出だしで目標より低く入り、0.35 秒以内に目標へ上がる
import { octaveFoldedCents } from './music';
import type { SongNote } from './song';
import type { PitchPoint } from './tracker';

export const HIT_CENTS = 50;
const LONG_NOTE = 0.8; // 安定性を評価するロングトーン [s]
const VIB_NOTE = 0.6; // ビブラートを探す音符の最小長 [s]
const GRID = 100; // ビブラート解析用の再サンプリング周波数 [Hz]

export interface NoteResult {
  index: number;
  note: SongNote;
  frames: number;
  voiced: number;
  hits: number;
  /** hits / frames（歌っていないフレームも外れとして数える） */
  accuracy: number;
  /** 有声フレームのズレの平均（オクターブ無視）。null = 声が出ていない */
  meanCents: number | null;
  /** 有声フレームの平均音量 [dB] */
  meanDb: number | null;
  stabilitySd?: number;
  vibrato?: { rate: number; extent: number; seconds: number };
  shakuri?: boolean;
}

export interface ProblemSection {
  start: number;
  end: number;
  accuracy: number;
  meanCents: number | null;
  /** 高め / 低め / 不安定 / 声が出ていない */
  kind: 'sharp' | 'flat' | 'unstable' | 'silent';
}

export interface ScoreResult {
  total: number;
  pitch: number;
  stability: number | null;
  expression: number | null;
  expressionDb: number | null;
  vibrato: { count: number; seconds: number };
  shakuri: { count: number };
  notes: NoteResult[];
  sections: ProblemSection[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

/** 時刻順に並んだ points から [t0, t1) の範囲を二分探索で切り出す */
function slice(points: PitchPoint[], t0: number, t1: number): PitchPoint[] {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (points[m].t < t0) lo = m + 1;
    else hi = m;
  }
  const out: PitchPoint[] = [];
  for (let i = lo; i < points.length && points[i].t < t1; i++) out.push(points[i]);
  return out;
}

function movingAverage(x: number[], w: number): number[] {
  const half = Math.floor(w / 2);
  return x.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(x.length, i + half + 1);
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    return s / (b - a);
  });
}

/** 有声フレームのセント列を GRID Hz の等間隔に直す（途切れは線形補間、端は切る） */
function resampleCents(pts: PitchPoint[], target: number): number[] {
  const v = pts.filter((p) => p.midi !== null);
  if (v.length < 2) return [];
  const out: number[] = [];
  let j = 0;
  for (let t = v[0].t; t <= v[v.length - 1].t; t += 1 / GRID) {
    while (j < v.length - 2 && v[j + 1].t < t) j++;
    const a = v[j];
    const b = v[j + 1];
    const f = (t - a.t) / (b.t - a.t || 1);
    const ca = octaveFoldedCents(a.midi!, target);
    const cb = octaveFoldedCents(b.midi!, target);
    out.push(ca + (cb - ca) * Math.max(0, Math.min(1, f)));
  }
  return out;
}

/** ビブラート検出。x は GRID Hz のセント列。周期的な揺れがあれば {rate, extent, seconds} */
export function detectVibrato(x: number[]): NoteResult['vibrato'] | undefined {
  const win = Math.round(0.6 * GRID);
  const step = Math.round(0.2 * GRID);
  if (x.length < win) return undefined;
  // ゆっくりした音程の変化（ずり上げ等）を除く
  const trend = movingAverage(x, Math.round(0.4 * GRID));
  const r = x.map((v, i) => v - trend[i]);
  const minLag = Math.floor(GRID / 8);
  const maxLag = Math.ceil(GRID / 4.5);
  let covered = 0;
  const rates: number[] = [];
  const extents: number[] = [];
  for (let s = 0; s + win <= r.length; s += step) {
    const seg = r.slice(s, s + win);
    const m = mean(seg);
    const z = seg.map((v) => v - m);
    const e0 = z.reduce((a, v) => a + v * v, 0);
    if (e0 === 0) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let i = 0; i + lag < z.length; i++) c += z[i] * z[i + lag];
      c /= e0 * ((z.length - lag) / z.length); // 重なりの長さで正規化
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    const extent = Math.sqrt(2) * Math.sqrt(e0 / z.length); // 正弦波なら振幅
    if (best > 0.5 && extent >= 15 && extent <= 150) {
      covered += step;
      rates.push(GRID / bestLag);
      extents.push(extent);
    }
  }
  const seconds = covered / GRID;
  if (seconds < 0.4) return undefined;
  return { rate: mean(rates), extent: mean(extents), seconds };
}

/** しゃくり検出 */
export function detectShakuri(pts: PitchPoint[], note: SongNote, prev?: SongNote): boolean {
  const v = pts.filter((p) => p.midi !== null && p.t >= note.start - 0.08 && p.t <= note.start + 0.4);
  if (v.length < 6) return false;
  const c = v.map((p) => octaveFoldedCents(p.midi!, note.midi));
  const onset = mean(c.slice(0, 3));
  if (onset > -60 || onset < -350) return false;
  // 直前の音符から切れ目なく移っただけ（スラー）の場合は数えない
  if (prev && note.start - prev.end < 0.08 && prev.midi < note.midi) {
    if (Math.abs(octaveFoldedCents(v[0].midi!, prev.midi)) < 50) return false;
  }
  // 0.35 秒以内に目標 ±30 セントへ到達
  const reach = v.findIndex((p, i) => i >= 3 && Math.abs(c[i]) <= 30 && p.t - v[0].t <= 0.35);
  return reach > 0;
}

export function scoreSong(notes: SongNote[], track: PitchPoint[], range?: { start: number; end: number }): ScoreResult {
  const pts = [...track].sort((a, b) => a.t - b.t);
  const results: NoteResult[] = [];
  notes.forEach((note, index) => {
    if (range && (note.end <= range.start || note.start >= range.end)) return;
    // 出だしは少し猶予を与える（しゃくり・子音）
    const grace = Math.min(0.1, (note.end - note.start) * 0.25);
    const inNote = slice(pts, note.start + grace, note.end);
    if (!inNote.length) return;
    const voicedPts = inNote.filter((p) => p.midi !== null);
    const cents = voicedPts.map((p) => octaveFoldedCents(p.midi!, note.midi));
    const hits = cents.filter((c) => Math.abs(c) <= HIT_CENTS).length;
    const r: NoteResult = {
      index,
      note,
      frames: inNote.length,
      voiced: voicedPts.length,
      hits,
      accuracy: hits / inNote.length,
      meanCents: cents.length ? mean(cents) : null,
      meanDb: voicedPts.length ? mean(voicedPts.map((p) => p.db)) : null,
    };
    const dur = note.end - note.start;
    if (dur >= LONG_NOTE) {
      const body = resampleCents(slice(pts, note.start + 0.25, note.end - 0.05), note.midi);
      if (body.length >= 0.4 * GRID) {
        // ビブラート（4.5Hz 以上）が消える幅で平滑化し、残ったゆっくりしたふらつきを見る
        r.stabilitySd = sd(movingAverage(body, Math.round(0.25 * GRID)));
      }
    }
    if (dur >= VIB_NOTE) {
      r.vibrato = detectVibrato(resampleCents(slice(pts, note.start + 0.15, note.end), note.midi));
    }
    if (dur >= 0.25) r.shakuri = detectShakuri(pts, note, notes[index - 1]);
    results.push(r);
  });

  const totalFrames = results.reduce((a, r) => a + r.frames, 0);
  const pitch = totalFrames ? (100 * results.reduce((a, r) => a + r.hits, 0)) / totalFrames : 0;

  const sds = results.filter((r) => r.stabilitySd !== undefined).map((r) => r.stabilitySd!);
  const stability = sds.length ? mean(sds.map((s) => clamp(100 - (s - 3) * 3))) : null;

  const dbs = results.filter((r) => r.meanDb !== null && r.voiced >= 5).map((r) => r.meanDb!).sort((a, b) => a - b);
  let expressionDb: number | null = null;
  let expression: number | null = null;
  if (dbs.length >= 5) {
    const q = (p: number) => dbs[Math.min(dbs.length - 1, Math.floor(p * dbs.length))];
    expressionDb = q(0.9) - q(0.1);
    expression = clamp(((expressionDb - 2) / 10) * 100);
  }

  const vib = results.filter((r) => r.vibrato);
  const total = Math.round(
    0.7 * pitch + 0.15 * (stability ?? pitch) + 0.15 * (expression ?? pitch),
  );

  return {
    total,
    pitch: Math.round(pitch),
    stability: stability === null ? null : Math.round(stability),
    expression: expression === null ? null : Math.round(expression),
    expressionDb,
    vibrato: { count: vib.length, seconds: vib.reduce((a, r) => a + r.vibrato!.seconds, 0) },
    shakuri: { count: results.filter((r) => r.shakuri).length },
    notes: results,
    sections: findProblemSections(results),
  };
}

/** 正確率の低い音符をまとめて「ズレた区間」にする */
export function findProblemSections(results: NoteResult[], maxGap = 1.0): ProblemSection[] {
  const bad = results.filter((r) => r.accuracy < 0.5);
  const groups: NoteResult[][] = [];
  for (const r of bad) {
    const g = groups.at(-1);
    if (g && r.note.start - g.at(-1)!.note.end <= maxGap) g.push(r);
    else groups.push([r]);
  }
  return groups.map((g) => {
    const frames = g.reduce((a, r) => a + r.frames, 0);
    const voiced = g.reduce((a, r) => a + r.voiced, 0);
    const withCents = g.filter((r) => r.meanCents !== null);
    const mc = withCents.length
      ? withCents.reduce((a, r) => a + r.meanCents! * r.voiced, 0) / Math.max(1, withCents.reduce((a, r) => a + r.voiced, 0))
      : null;
    let kind: ProblemSection['kind'];
    if (voiced < frames * 0.3 || mc === null) kind = 'silent';
    else if (mc > 30) kind = 'sharp';
    else if (mc < -30) kind = 'flat';
    else kind = 'unstable';
    return {
      start: g[0].note.start,
      end: g.at(-1)!.note.end,
      accuracy: g.reduce((a, r) => a + r.hits, 0) / Math.max(1, frames),
      meanCents: mc,
      kind,
    };
  });
}
