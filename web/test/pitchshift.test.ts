import { describe, expect, it } from 'vitest';
import { pitchShift } from '../src/audio/pitchshift';
import { Yin, rms } from '../src/audio/yin';

const SR = 44100;

function tone(freqs: number[], seconds: number): Float32Array {
  const x = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    freqs.forEach((f, k) => (s += Math.sin((2 * Math.PI * f * i) / SR) / (k + 1)));
    x[i] = 0.3 * s;
  }
  return x;
}

function pitchAt(x: Float32Array, at: number): number {
  const yin = new Yin({ sampleRate: SR });
  const i = Math.round(at * SR);
  return yin.detect(x.subarray(i, i + 2048))!.freq;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('pitchShift', () => {
  it.each([2, -3, 6, -6, 1])('%i 半音：音程が変わり、長さ・音量は保たれる', (s) => {
    const x = tone([440], 1.5);
    const y = pitchShift(x, s);
    expect(y.length).toBe(x.length);
    const expected = 440 * 2 ** (s / 12);
    for (const t of [0.3, 0.7, 1.1]) expect(Math.abs(cents(pitchAt(y, t), expected))).toBeLessThan(8);
    const ratio = rms(y, SR * 0.2, SR * 1.3) / rms(x, SR * 0.2, SR * 1.3);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it('和音（倍音を含む音）の基本周波数も正しく移る', () => {
    const x = tone([220, 440, 660, 880], 1.0);
    const y = pitchShift(x, 4);
    expect(Math.abs(cents(pitchAt(y, 0.5), 220 * 2 ** (4 / 12)))).toBeLessThan(8);
  });

  it('タイミングがずれない（音の出だしの位置が同じ）', () => {
    const x = new Float32Array(SR);
    const burst = tone([330], 0.2);
    x.set(burst, Math.round(0.5 * SR));
    const y = pitchShift(x, 3);
    const onset = (z: Float32Array) => z.findIndex((v) => Math.abs(v) > 0.05);
    expect(Math.abs(onset(y) - onset(x)) / SR).toBeLessThan(0.03);
  });
});
