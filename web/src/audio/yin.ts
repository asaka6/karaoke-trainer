// YIN 基本周波数推定 (de Cheveigné & Kawahara, 2002)
// AudioWorklet とテストの両方から使う純粋関数。

export interface YinOptions {
  sampleRate: number;
  minFreq?: number; // 既定 60 Hz
  maxFreq?: number; // 既定 1100 Hz
  threshold?: number; // 累積平均正規化差分の閾値（既定 0.15）
}

export interface YinResult {
  freq: number;
  /** 1 - d'(τ)。1に近いほど周期的（有声らしい） */
  clarity: number;
}

/** 作業用バッファを使い回して GC を避けるためのクラス */
export class Yin {
  private readonly cmnd: Float32Array;
  readonly tauMin: number;
  readonly tauMax: number;
  private readonly threshold: number;
  private readonly sampleRate: number;

  constructor(opts: YinOptions) {
    this.sampleRate = opts.sampleRate;
    this.tauMin = Math.max(2, Math.floor(opts.sampleRate / (opts.maxFreq ?? 1100)));
    this.tauMax = Math.ceil(opts.sampleRate / (opts.minFreq ?? 60));
    this.threshold = opts.threshold ?? 0.15;
    this.cmnd = new Float32Array(this.tauMax + 2);
  }

  /** 推定に必要な最小バッファ長 */
  get minBufferLength(): number {
    return this.tauMax * 2 + 2;
  }

  /** buf の先頭から推定。周期性が見つからなければ null */
  detect(buf: ArrayLike<number>): YinResult | null {
    const { tauMin, tauMax, cmnd } = this;
    const W = buf.length - tauMax - 1; // 積分窓長
    if (W < tauMax) throw new Error(`buffer too short: ${buf.length}`);

    // 1-2. 差分関数 d(τ) と累積平均正規化 d'(τ)
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let d = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        d += diff * diff;
      }
      runningSum += d;
      cmnd[tau] = runningSum > 0 ? (d * tau) / runningSum : 1;
    }

    // 3. 閾値を下回った最初の谷を探す（オクターブ上の誤りを避ける）
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < this.threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      // 閾値を下回らなければ全体の最小値（clarity が低いので呼び出し側で弾かれる）
      let min = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (cmnd[tau] < min) {
          min = cmnd[tau];
          best = tau;
        }
      }
    }
    if (best <= tauMin || best >= tauMax) return null; // 範囲の端＝範囲外の音高

    // 4. 放物線補間でサブサンプル精度に
    const a = cmnd[best - 1];
    const b = cmnd[best];
    const c = cmnd[best + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const tau = best + Math.max(-1, Math.min(1, shift));
    return { freq: this.sampleRate / tau, clarity: 1 - b };
  }
}

export function rms(buf: ArrayLike<number>, start = 0, end = buf.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, end - start));
}
