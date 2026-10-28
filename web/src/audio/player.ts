// 伴奏の再生（キー変更つき）とガイドメロディの発音
import type { ShiftMessage, ShiftRequest } from './shift-worker';
import { midiToFreq } from '../lib/music';
import type { SongNote } from '../lib/song';

/** キーごとに変換済みの伴奏をキャッシュする */
export class KeyCache {
  private cache = new Map<number, AudioBuffer>();
  constructor(private ctx: AudioContext, readonly original: AudioBuffer) {
    this.cache.set(0, original);
  }

  async get(semitones: number, onProgress?: (p: number) => void): Promise<AudioBuffer> {
    const hit = this.cache.get(semitones);
    if (hit) return hit;
    const src = this.original;
    const channels = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c).slice());
    const worker = new Worker(new URL('./shift-worker.ts', import.meta.url), { type: 'module' });
    try {
      const shifted = await new Promise<Float32Array[]>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<ShiftMessage>) => {
          if (e.data.type === 'progress') onProgress?.(e.data.value);
          else resolve(e.data.channels);
        };
        worker.onerror = (e) => reject(new Error(e.message));
        const req: ShiftRequest = { channels, semitones };
        worker.postMessage(req, channels.map((c) => c.buffer));
      });
      const buf = this.ctx.createBuffer(shifted.length, shifted[0].length, src.sampleRate);
      shifted.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
      this.cache.set(semitones, buf);
      return buf;
    } finally {
      worker.terminate();
    }
  }
}

/** ガイドメロディを三角波で鳴らす。startAt（AudioContext 時刻）に曲の offset 秒が来るように予約する */
export function scheduleGuide(
  ctx: AudioContext,
  dest: AudioNode,
  notes: SongNote[],
  offset: number,
  startAt: number,
): () => void {
  const oscs: OscillatorNode[] = [];
  for (const n of notes) {
    if (n.end <= offset) continue;
    const t0 = startAt + Math.max(0, n.start - offset);
    const t1 = startAt + (n.end - offset);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(n.midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
    g.gain.setValueAtTime(0.25, Math.max(t0 + 0.02, t1 - 0.03));
    g.gain.linearRampToValueAtTime(0, t1);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t1 + 0.01);
    oscs.push(osc);
  }
  return () =>
    oscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* 既に止まっている */
      }
      o.disconnect();
    });
}
