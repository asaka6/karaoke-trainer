// worklet からの生の推定値を「表示・採点に使える音高列」に整える。
// 無音（音量が小さい）・無声（周期性が低い）を除き、直近3フレームのメディアンで単発の誤推定を消す。
import { freqToMidi } from './music';

export interface RawFrame {
  t: number;
  freq: number | null;
  clarity: number;
  rms: number;
}

export interface PitchPoint {
  t: number;
  /** 小数を含む MIDI ノート番号。無声・無音なら null */
  midi: number | null;
  /** 音量 [dBFS] */
  db: number;
}

export interface TrackerOptions {
  /** これより小さい音量は無音扱い [dBFS] */
  minDb: number;
  /** これより低い clarity は無声扱い */
  minClarity: number;
}

export const DEFAULT_TRACKER: TrackerOptions = { minDb: -50, minClarity: 0.75 };

export class PitchTracker {
  private hist: (number | null)[] = [];
  constructor(public opts: TrackerOptions = DEFAULT_TRACKER) {}

  push(f: RawFrame): PitchPoint {
    const db = 20 * Math.log10(Math.max(f.rms, 1e-6));
    const voiced = f.freq !== null && db >= this.opts.minDb && f.clarity >= this.opts.minClarity;
    this.hist.push(voiced ? freqToMidi(f.freq!) : null);
    if (this.hist.length > 3) this.hist.shift();
    return { t: f.t, midi: voiced ? median3(this.hist) : null, db };
  }

  reset() {
    this.hist = [];
  }
}

/** 直近の値のうち有声が2つ以上あればそのメディアン（2つなら新しい方）、なければ null */
function median3(h: (number | null)[]): number | null {
  const v = h.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  if (v.length === 2) {
    // 2つの値が大きく離れているときは新しい方を信じる（音の跳躍に遅れずに追従）
    return Math.abs(v[0] - v[1]) > 1 ? v[1] : (v[0] + v[1]) / 2;
  }
  return [...v].sort((a, b) => a - b)[1];
}
