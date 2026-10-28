// AudioWorklet: マイク入力を溜めて一定間隔で YIN を回し、結果をメインスレッドに送る。
// 32kHz 以上では 2 サンプル平均で間引いて計算量を 1/4 にする（声の基本周波数には十分）。
import { Yin, rms } from './yin';

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export interface PitchFrame {
  /** 解析窓の中心の AudioContext 時刻 [s] */
  t: number;
  freq: number | null;
  clarity: number;
  rms: number;
}

class PitchProcessor extends AudioWorkletProcessor {
  private readonly decim = sampleRate >= 32000 ? 2 : 1;
  private readonly rate = sampleRate / this.decim;
  private readonly size = 1024; // 間引き後のサンプル数（≈43ms）
  private readonly hop = 256; // 間引き後（≈10.7ms ごとに推定）
  private readonly buf = new Float32Array(this.size);
  private readonly frame = new Float32Array(this.size);
  private write = 0;
  private filled = 0;
  private sinceHop = 0;
  private pending = 0; // 間引き用に1サンプル持ち越し
  private hasPending = false;
  private readonly yin = new Yin({ sampleRate: this.rate });

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i];
      if (this.decim === 2) {
        if (!this.hasPending) {
          this.pending = v;
          this.hasPending = true;
          continue;
        }
        v = 0.5 * (v + this.pending);
        this.hasPending = false;
      }
      this.buf[this.write] = v;
      this.write = (this.write + 1) % this.size;
      if (this.filled < this.size) this.filled++;
      if (++this.sinceHop >= this.hop && this.filled === this.size) {
        this.sinceHop = 0;
        // 最後に書いたサンプルの時刻から解析窓の中心時刻を求める
        const tLast = currentTime + (i + 1) / sampleRate;
        this.analyze(tLast - this.size / 2 / this.rate);
      }
    }
    return true;
  }

  private analyze(t: number) {
    // リングバッファを時系列順に並べ直す
    const { buf, frame, size, write } = this;
    frame.set(buf.subarray(write), 0);
    frame.set(buf.subarray(0, write), size - write);
    const level = rms(frame);
    const r = level > 1e-4 ? this.yin.detect(frame) : null;
    const msg: PitchFrame = { t, freq: r ? r.freq : null, clarity: r ? r.clarity : 0, rms: level };
    this.port.postMessage(msg);
  }
}

registerProcessor('pitch-processor', PitchProcessor);
