import { beforeAll, describe, expect, it } from 'vitest';
import { Yin } from '../src/audio/yin';
import { freqToMidi, midiToFreq, midiToName } from '../src/lib/music';

// worklet と同じく 32kHz 未満(=2倍間引き後)は 1024 サンプル、それ以外は 2048
let N = 2048;

function sine(freq: number, sr: number, n = N, amp = 0.5, phase = 0.3): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return out;
}

/** 声に近い倍音構造（基音が弱め・2倍音が強い）の波形 */
function harmonic(freq: number, sr: number, n = N): Float32Array {
  const amps = [0.5, 1.0, 0.6, 0.4, 0.25, 0.15];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    amps.forEach((a, k) => {
      s += a * Math.sin((2 * Math.PI * freq * (k + 1) * i) / sr + k);
    });
    out[i] = 0.2 * s;
  }
  return out;
}

// 乱数を固定してテストを再現可能にする
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const cents = (est: number, truth: number) => 1200 * Math.log2(est / truth);

describe.each([22050, 24000, 44100, 48000])('YIN @ %i Hz', (sr) => {
  const yin = new Yin({ sampleRate: sr });
  beforeAll(() => { N = sr < 32000 ? 1024 : 2048; });

  // A2(45) 〜 C6(84) の全半音
  const midis = Array.from({ length: 84 - 45 + 1 }, (_, i) => 45 + i);

  it.each(midis)('サイン波 MIDI %i を ±5セント以内で推定', (midi) => {
    const f = midiToFreq(midi);
    const r = yin.detect(sine(f, sr));
    expect(r, midiToName(midi)).not.toBeNull();
    expect(Math.abs(cents(r!.freq, f))).toBeLessThan(5);
    expect(r!.clarity).toBeGreaterThan(0.9);
  });

  it.each([45, 52, 57, 64, 69, 76, 81])('倍音を含む波形 MIDI %i でオクターブを誤らない', (midi) => {
    const f = midiToFreq(midi);
    const r = yin.detect(harmonic(f, sr));
    expect(r).not.toBeNull();
    expect(Math.abs(cents(r!.freq, f))).toBeLessThan(5);
  });

  it('半音間の周波数（A4 + 30セント）も正しく出る', () => {
    const f = 440 * 2 ** (30 / 1200);
    const r = yin.detect(sine(f, sr))!;
    expect(freqToMidi(r.freq)).toBeCloseTo(69.3, 1);
  });

  it('白色雑音は低 clarity（無声扱い）', () => {
    const rand = rng(1);
    const buf = new Float32Array(N).map(() => rand() * 2 - 1);
    const r = yin.detect(buf);
    expect(r === null || r.clarity < 0.5).toBe(true);
  });

  it('無音は null または低 clarity', () => {
    const r = yin.detect(new Float32Array(N));
    expect(r === null || r.clarity < 0.5).toBe(true);
  });
});
