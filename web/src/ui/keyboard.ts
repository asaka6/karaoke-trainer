// 鍵盤の上に音域を色で示す部品（音域タブ）と、音域を横棒で比べる小さな部品（選曲・ライブラリ）
import { midiToName } from '../lib/music';
import type { Range } from '../lib/storage';

const LO = 36; // C2
const HI = 84; // C6
const BLACK = new Set([1, 3, 6, 8, 10]);

export class RangeKeyboard {
  readonly el: HTMLElement;
  private keys = new Map<number, SVGRectElement>();
  private current: number | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'keyboard';
    const whites = [];
    for (let m = LO; m <= HI; m++) if (!BLACK.has(m % 12)) whites.push(m);
    const ww = 10;
    const W = whites.length * ww;
    const H = 46;
    let svg = `<svg viewBox="0 0 ${W} ${H + 12}" preserveAspectRatio="none" role="img" aria-label="音域の鍵盤表示">`;
    const xOf = new Map<number, number>();
    whites.forEach((m, i) => xOf.set(m, i * ww));
    for (const m of whites) {
      svg += `<rect class="k w" data-m="${m}" x="${xOf.get(m)! + 0.4}" y="0" width="${ww - 0.8}" height="${H}" rx="1.6"/>`;
      if (m % 12 === 0) svg += `<text x="${xOf.get(m)! + ww / 2}" y="${H + 9}" text-anchor="middle">${midiToName(m)}</text>`;
    }
    for (let m = LO; m <= HI; m++) {
      if (!BLACK.has(m % 12)) continue;
      const x = xOf.get(m - 1)! + ww * 0.68;
      svg += `<rect class="k b" data-m="${m}" x="${x}" y="0" width="${ww * 0.64}" height="${H * 0.6}" rx="1.2"/>`;
    }
    svg += '</svg>';
    this.el.innerHTML = svg;
    this.el.querySelectorAll<SVGRectElement>('rect.k').forEach((r) => this.keys.set(+r.dataset.m!, r));
  }

  setRanges(chest: Range | null, falsetto: Range | null) {
    for (const [m, r] of this.keys) {
      const inC = !!chest && m >= chest.min && m <= chest.max;
      const inF = !!falsetto && m >= falsetto.min && m <= falsetto.max;
      r.classList.toggle('chest', inC);
      r.classList.toggle('falsetto', inF && !inC);
    }
  }

  setCurrent(midi: number | null) {
    const m = midi === null ? null : Math.round(midi);
    if (m === this.current) return;
    if (this.current !== null) this.keys.get(this.current)?.classList.remove('now');
    this.current = m;
    if (m !== null) this.keys.get(m)?.classList.add('now');
  }
}

/** 自分の音域（背景）と曲の音域（前景）を横棒で比べる */
export function rangeBar(user: Range | null, song: Range, shift = 0): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rbar';
  const lo = Math.min(LO, song.min + shift, user?.min ?? LO);
  const hi = Math.max(HI - 12, song.max + shift, user?.max ?? HI);
  const pct = (m: number) => ((m - lo) / (hi - lo + 1)) * 100;
  const seg = (cls: string, r: Range) =>
    `<span class="${cls}" style="left:${pct(r.min)}%;width:${pct(r.max + 1) - pct(r.min)}%"></span>`;
  const s = { min: song.min + shift, max: song.max + shift };
  const fits = !!user && s.min >= user.min && s.max <= user.max;
  el.innerHTML = (user ? seg('u', user) : '') + seg(fits ? 's ok' : 's', s);
  el.title = `曲 ${midiToName(s.min)}〜${midiToName(s.max)}`;
  return el;
}
