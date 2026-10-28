// 周波数・MIDIノート番号・音名の相互変換

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 60 → "C4" */
export function midiToName(midi: number): string {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

/** "A4" → 69（不正なら NaN） */
export function nameToMidi(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name.trim());
  if (!m) return NaN;
  return NOTE_NAMES.indexOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
}

/** 最も近い半音からのズレ（セント, -50〜+50） */
export function centsOff(midi: number): number {
  return (midi - Math.round(midi)) * 100;
}

/** a - b をオクターブ違いを無視して -600〜+600 セントに畳み込む */
export function octaveFoldedCents(a: number, b: number): number {
  let c = ((a - b) * 100) % 1200;
  if (c > 600) c -= 1200;
  if (c < -600) c += 1200;
  return c;
}
