// 「0.5秒以上安定して出せた音」を検出する（音域測定用）。
import type { PitchPoint } from './tracker';

export interface StableOptions {
  /** 安定とみなす継続時間 [s] */
  minDuration: number;
  /** 区間平均からの許容ズレ [半音]（0.5 = ±50セント） */
  tolerance: number;
  /** これより長い無声区間で計測をやり直す [s] */
  maxGap: number;
}

export const DEFAULT_STABLE: StableOptions = { minDuration: 0.5, tolerance: 0.5, maxGap: 0.08 };

export interface StableState {
  /** 現在の区間の安定度合い 0〜1（1で確定） */
  progress: number;
  /** 今回のフレームで新たに確定した音（MIDI 整数） */
  confirmed: number | null;
}

export class StableNoteDetector {
  private start = 0;
  private lastVoiced = -Infinity;
  private sum = 0;
  private count = 0;
  private emitted = false;

  constructor(private opts: StableOptions = DEFAULT_STABLE) {}

  push(p: PitchPoint): StableState {
    if (p.midi === null) {
      if (p.t - this.lastVoiced > this.opts.maxGap) this.reset();
      return { progress: this.count ? this.progress(this.lastVoiced) : 0, confirmed: null };
    }
    if (this.count > 0 && Math.abs(p.midi - this.sum / this.count) > this.opts.tolerance) {
      this.reset();
    }
    if (this.count === 0) this.start = p.t;
    this.sum += p.midi;
    this.count++;
    this.lastVoiced = p.t;

    const progress = this.progress(p.t);
    let confirmed: number | null = null;
    if (progress >= 1 && !this.emitted) {
      this.emitted = true;
      confirmed = Math.round(this.sum / this.count);
    }
    return { progress, confirmed };
  }

  reset() {
    this.sum = 0;
    this.count = 0;
    this.emitted = false;
  }

  private progress(t: number) {
    return Math.min(1, (t - this.start) / this.opts.minDuration);
  }
}
