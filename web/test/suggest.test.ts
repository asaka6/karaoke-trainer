import { describe, expect, it } from 'vitest';
import { combineRanges, fitsFor, suggest } from '../src/lib/suggest';
import type { IndexEntry } from '../src/lib/song';

const song = (id: string, min: number, max: number): IndexEntry => ({ id, title: id, artist: '', range: { min, max } });
const USER = { min: 48, max: 67 }; // C3〜G4

describe('suggest', () => {
  it('そのまま歌える / キー変更で歌える / 難しい に分類', () => {
    const r = suggest(
      [song('ok', 50, 65), song('high2', 52, 69), song('low3', 45, 60), song('wide', 45, 72), { id: 'x', title: 'x', artist: '', range: null }],
      USER,
    );
    expect(r.asIs.map((s) => s.song.id)).toEqual(['ok']);
    expect(r.shifted.map((s) => [s.song.id, s.best!.key])).toEqual([
      ['high2', -2],
      ['low3', 3],
    ]);
    expect(r.hard.map((s) => [s.song.id, s.shortBy])).toEqual([['wide', 8]]);
    expect(r.unknown.map((s) => s.id)).toEqual(['x']);
  });

  it('キー変更は ±6 まで', () => {
    expect(fitsFor({ min: 55, max: 74 }, USER, false)).toEqual([]); // -7 が必要
    expect(fitsFor({ min: 54, max: 73 }, USER, false)).toEqual([{ key: -6, octave: 0 }]);
  });

  it('オクターブ移動を許すと女性曲も1オクターブ下で候補になる', () => {
    const female = song('f', 70, 84); // A#4〜C6
    expect(suggest([female], USER).hard).toHaveLength(1);
    const r = suggest([female], USER, true);
    expect(r.shifted[0].best).toEqual({ key: -5, octave: -12 });
  });

  it('地声と裏声の音域を合わせる', () => {
    expect(combineRanges({ min: 48, max: 64 }, { min: 60, max: 74 }, true)).toEqual({ min: 48, max: 74 });
    expect(combineRanges({ min: 48, max: 64 }, { min: 60, max: 74 }, false)).toEqual({ min: 48, max: 64 });
    expect(combineRanges(null, null, true)).toBeNull();
  });
});
