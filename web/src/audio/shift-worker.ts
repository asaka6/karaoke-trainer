// キー変更の重い計算を UI と別スレッドで行う
import { pitchShift } from './pitchshift';

export interface ShiftRequest {
  channels: Float32Array[];
  semitones: number;
}

export type ShiftMessage = { type: 'progress'; value: number } | { type: 'done'; channels: Float32Array[] };

self.onmessage = (e: MessageEvent<ShiftRequest>) => {
  const { channels, semitones } = e.data;
  const out = channels.map((ch, c) =>
    pitchShift(ch, semitones, (p) => {
      const msg: ShiftMessage = { type: 'progress', value: (c + p) / channels.length };
      self.postMessage(msg);
    }),
  );
  const msg: ShiftMessage = { type: 'done', channels: out };
  (self as unknown as Worker).postMessage(msg, out.map((c) => c.buffer));
};
