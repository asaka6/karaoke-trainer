// 選曲提案：自分の音域と曲の音域を比べ、そのまま歌える曲・キーを変えれば歌える曲を探す
import type { Range } from './storage';
import type { IndexEntry } from './song';

export const MAX_KEY = 6;

export interface Fit {
  /** キー変更（半音, -6〜+6） */
  key: number;
  /** オクターブ移動（-12 / 0 / +12）。男女で1オクターブ違えて歌う場合 */
  octave: number;
}

export interface Suggestion {
  song: IndexEntry;
  fits: Fit[];
  best: Fit | null;
  /** どのキーでも収まらないとき、あと何半音分の音域が足りないか */
  shortBy: number;
}

export interface SuggestResult {
  asIs: Suggestion[];
  shifted: Suggestion[];
  hard: Suggestion[];
  unknown: IndexEntry[];
}

export function combineRanges(chest: Range | null, falsetto: Range | null, useFalsetto: boolean): Range | null {
  const rs = [chest, useFalsetto ? falsetto : null].filter((r): r is Range => !!r);
  if (!rs.length) return null;
  return { min: Math.min(...rs.map((r) => r.min)), max: Math.max(...rs.map((r) => r.max)) };
}

export function fitsFor(song: Range, user: Range, allowOctave: boolean): Fit[] {
  const fits: Fit[] = [];
  for (const octave of allowOctave ? [0, -12, 12] : [0]) {
    for (let key = -MAX_KEY; key <= MAX_KEY; key++) {
      const s = octave + key;
      if (song.min + s >= user.min && song.max + s <= user.max) fits.push({ key, octave });
    }
  }
  // オクターブ移動なしを優先し、その中でキー変更の小さい順
  return fits.sort((a, b) => Math.abs(a.octave) - Math.abs(b.octave) || Math.abs(a.key) - Math.abs(b.key) || a.key - b.key);
}

export function suggest(songs: IndexEntry[], user: Range, allowOctave = false): SuggestResult {
  const res: SuggestResult = { asIs: [], shifted: [], hard: [], unknown: [] };
  for (const song of songs) {
    if (!song.range) {
      res.unknown.push(song);
      continue;
    }
    const fits = fitsFor(song.range, user, allowOctave);
    const best = fits[0] ?? null;
    const shortBy = best ? 0 : shortage(song.range, user, allowOctave);
    const s: Suggestion = { song, fits, best, shortBy };
    if (best && best.key === 0 && best.octave === 0) res.asIs.push(s);
    else if (best) res.shifted.push(s);
    else res.hard.push(s);
  }
  res.shifted.sort((a, b) => Math.abs(a.best!.key) - Math.abs(b.best!.key) || Math.abs(a.best!.octave) - Math.abs(b.best!.octave));
  res.hard.sort((a, b) => a.shortBy - b.shortBy);
  return res;
}

/** 最も近いキー変更をしても、上下合わせて何半音はみ出すか */
function shortage(song: Range, user: Range, allowOctave: boolean): number {
  let best = Infinity;
  for (const octave of allowOctave ? [0, -12, 12] : [0]) {
    for (let key = -MAX_KEY; key <= MAX_KEY; key++) {
      const s = octave + key;
      const over = Math.max(0, user.min - (song.min + s)) + Math.max(0, song.max + s - user.max);
      best = Math.min(best, over);
    }
  }
  return best;
}

/** 保存済みの音域と選曲条件から、その曲のおすすめ（null = 音域未測定 or 収まらない） */
export function recommendFit(song: Range | null, user: Range | null, allowOctave: boolean): Fit | null {
  if (!song || !user) return null;
  return fitsFor(song, user, allowOctave)[0] ?? null;
}
