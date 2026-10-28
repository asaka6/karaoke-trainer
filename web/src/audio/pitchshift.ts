// テンポを変えずにキー（音の高さ）だけを変える。
// 位相ボコーダで時間を r 倍に引き伸ばし、それを r 倍速で読み直す（= 長さは元通り・音程は r 倍）。
// 位相のにじみ（「シュワシュワ」した音）を減らすため、スペクトルのピークに位相を揃える
// identity phase locking (Laroche & Dolson, 1999) を使う。

const N = 2048; // FFT 長
const HS = 512; // 合成側のホップ（N/4）

class FFT {
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** 複素数配列 (re, im) をその場で変換。inverse なら 1/n も掛ける */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const { n, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sgn * this.sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }
}

const TWO_PI = 2 * Math.PI;
const wrap = (x: number) => x - TWO_PI * Math.round(x / TWO_PI);

/** 1チャンネルを時間方向に r 倍に伸ばす（音程はそのまま） */
export function timeStretch(x: Float32Array, r: number, onProgress?: (p: number) => void): Float32Array {
  const fft = new FFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / N);
  const ha = HS / r;
  const bins = N / 2 + 1;
  const frames = Math.max(1, Math.ceil((x.length + N) / ha));
  const out = new Float32Array(Math.ceil(frames * HS + N));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(bins);
  const phase = new Float64Array(bins);
  const prevPhase = new Float64Array(bins);
  const synPhase = new Float64Array(bins);
  const isPeak = new Uint8Array(bins);
  const peakOf = new Int32Array(bins);
  let prevPos = 0;

  for (let m = 0; m < frames; m++) {
    // 解析位置は整数サンプルに丸め、実際の間隔で位相差を計算する
    const pos = Math.round(m * ha) - N; // 先頭にも窓が掛かるよう N だけ前から始める
    for (let i = 0; i < N; i++) {
      const s = pos + i;
      re[i] = s >= 0 && s < x.length ? x[s] * win[i] : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < bins; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      phase[k] = Math.atan2(im[k], re[k]);
    }

    if (m === 0) {
      synPhase.set(phase);
    } else {
      const hop = pos - prevPos;
      // ピーク（左右2ビンより大きい）を探し、各ビンを最寄りのピークに割り当てる
      isPeak.fill(0);
      const peaks: number[] = [];
      for (let k = 2; k < bins - 2; k++) {
        const v = mag[k];
        if (v > mag[k - 1] && v >= mag[k + 1] && v > mag[k - 2] && v >= mag[k + 2]) {
          isPeak[k] = 1;
          peaks.push(k);
        }
      }
      if (peaks.length === 0) peaks.push(0);
      let p = 0;
      for (let k = 0; k < bins; k++) {
        while (p + 1 < peaks.length && Math.abs(peaks[p + 1] - k) <= Math.abs(peaks[p] - k)) p++;
        peakOf[k] = peaks[p];
      }
      // ピークは真の周波数から位相を進め、周りのビンはピークとの位相関係を保つ
      for (const k of peaks) {
        const omega = (TWO_PI * k) / N;
        const dev = wrap(phase[k] - prevPhase[k] - omega * hop);
        const freq = omega + dev / hop;
        synPhase[k] = synPhase[k] + freq * HS;
      }
      for (let k = 0; k < bins; k++) {
        if (isPeak[k]) continue;
        const pk = peakOf[k];
        synPhase[k] = synPhase[pk] + (phase[k] - phase[pk]);
      }
    }
    prevPhase.set(phase);
    prevPos = pos;

    // 合成（共役対称にして実信号へ）
    for (let k = 0; k < bins; k++) {
      re[k] = mag[k] * Math.cos(synPhase[k]);
      im[k] = mag[k] * Math.sin(synPhase[k]);
    }
    for (let k = 1; k < N / 2; k++) {
      re[N - k] = re[k];
      im[N - k] = -im[k];
    }
    fft.transform(re, im, true);
    const o = m * HS;
    for (let i = 0; i < N; i++) out[o + i] += re[i] * win[i];
    if (onProgress && m % 256 === 0) onProgress(m / frames);
  }

  // Hann 窓を2回掛けて N/4 ずつ重ねると振幅は 1.5 倍になる。
  // フレーム m の窓の中心は入力の m*ha - N/2、出力の m*HS + N/2 に置いたので、
  // 入力時刻 t に対応する出力位置は r*t + N(1+r)/2。その分だけ先頭を切り落とす。
  const offset = Math.round((N * (1 + r)) / 2);
  const len = Math.round(x.length * r);
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) y[i] = (out[i + offset] ?? 0) / 1.5;
  return y;
}

/** 線形補間で長さ len に読み直す（r 倍速で読む） */
function resample(x: Float32Array, len: number): Float32Array {
  const y = new Float32Array(len);
  const step = (x.length - 1) / Math.max(1, len - 1);
  for (let i = 0; i < len; i++) {
    const p = i * step;
    const j = Math.floor(p);
    const f = p - j;
    y[i] = x[j] * (1 - f) + (x[Math.min(j + 1, x.length - 1)] ?? 0) * f;
  }
  return y;
}

/** キーを semitones 半音変える（長さは変わらない） */
export function pitchShift(x: Float32Array, semitones: number, onProgress?: (p: number) => void): Float32Array {
  if (semitones === 0) return x.slice();
  const r = Math.pow(2, semitones / 12);
  return resample(timeStretch(x, r, onProgress), x.length);
}
