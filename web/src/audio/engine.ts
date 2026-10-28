// AudioContext・マイク・ピッチ推定 worklet をまとめて管理する。
import workletUrl from './pitch-worklet.ts?worker&url';
import { PitchTracker, type PitchPoint, type RawFrame } from '../lib/tracker';

export type PitchListener = (p: PitchPoint) => void;

class AudioEngine {
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private testOsc: OscillatorNode | null = null;
  private listeners = new Set<PitchListener>();
  readonly tracker = new PitchTracker();
  running = false;

  /** URL に ?test=440 などがあればマイクの代わりにサイン波を入力（動作確認用） */
  private testFreq(): number | null {
    const v = new URLSearchParams(location.search).get('test');
    return v ? parseFloat(v) : null;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(workletUrl);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const ctx = await this.ensureContext();
    this.node = new AudioWorkletNode(ctx, 'pitch-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e: MessageEvent<RawFrame>) => {
      const p = this.tracker.push(e.data);
      this.listeners.forEach((l) => l(p));
    };
    const tf = this.testFreq();
    if (tf) {
      this.testOsc = ctx.createOscillator();
      this.testOsc.frequency.value = tf;
      const g = ctx.createGain();
      g.gain.value = 0.3;
      this.testOsc.connect(g).connect(this.node);
      this.testOsc.start();
    } else {
      // 歌声の音程が加工されないよう、ブラウザの音声処理はすべて切る
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      ctx.createMediaStreamSource(this.stream).connect(this.node);
    }
    this.tracker.reset();
    this.running = true;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.testOsc?.stop();
    this.node?.disconnect();
    this.stream = null;
    this.testOsc = null;
    this.node = null;
    this.running = false;
  }

  onPitch(l: PitchListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** 出力（スピーカー）側の遅延の目安 [s] */
  outputLatency(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    return (c?.baseLatency ?? 0) + (c?.outputLatency ?? 0);
  }
}

export const engine = new AudioEngine();
