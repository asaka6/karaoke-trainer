// localStorage は使えない環境（プライベートモード等）があるので必ず try/catch で包む

export function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? { ...fallback, ...JSON.parse(s) } : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export interface Range {
  min: number;
  max: number;
}

export interface VoiceRanges {
  chest: Range | null; // 地声
  falsetto: Range | null; // 裏声
}

export const RANGE_KEY = 'karaoke-trainer.ranges.v1';

export function loadRanges(): VoiceRanges {
  return load<VoiceRanges>(RANGE_KEY, { chest: null, falsetto: null });
}

export function saveRanges(r: VoiceRanges): boolean {
  return save(RANGE_KEY, r);
}

export function extendRange(r: Range | null, midi: number): Range {
  return r ? { min: Math.min(r.min, midi), max: Math.max(r.max, midi) } : { min: midi, max: midi };
}

/** 選曲タブで読み込んだ index.json */
export const INDEX_KEY = 'karaoke-trainer.index.v1';
/** 選曲の条件（裏声も使う・オクターブ移動可） */
export const SUGGEST_OPTS_KEY = 'karaoke-trainer.suggest.v1';
export const loadSuggestOpts = () => load(SUGGEST_OPTS_KEY, { falsetto: true, octave: false });
