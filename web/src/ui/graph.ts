// 横スクロールする音程グラフ（ピアノロール風。縦軸 = 半音ごとの音名グリッド）
import { midiToName, octaveFoldedCents } from '../lib/music';

export interface GraphPoint {
  t: number;
  midi: number | null;
}

export interface GuideNote {
  start: number;
  end: number;
  midi: number;
  /** 採点後の色分け用（0〜1）。未設定なら通常色 */
  score?: number;
}

export interface GraphOptions {
  windowSec: number;
  /** 「現在」を横幅のどこに置くか（1 = 右端） */
  nowFrac: number;
  /** 表示する半音数 */
  span: number;
}

interface Palette {
  bg: string;
  black: string;
  grid: string;
  gridC: string;
  label: string;
  line: string;
  good: string;
  guide: string;
  guideHit: string;
  guideMiss: string;
  target: string;
  now: string;
}

const PITCH_JUMP = 1.5; // これ以上離れた点は線で結ばない [半音]
const GUTTER = 30; // 左の音名欄の幅 [CSS px]
const BLACK = new Set([1, 3, 6, 8, 10]);

export class PitchGraph {
  readonly ctx: CanvasRenderingContext2D;
  opts: GraphOptions;
  points: GraphPoint[] = [];
  guide: GuideNote[] = [];
  /** 目標音（ボイトレ）・音域の目印など、水平線で表示する音 */
  marks: { midi: number; label?: string; band?: number }[] = [];
  /** 表示範囲の中心（自動追従しないときは固定値を入れる） */
  center = 57;
  autoCenter = true;
  /** false にすると「現在」より後の点も描く（歌い終わった後の見返し用） */
  live = true;
  /** true にするとガイドに合っている部分の線を緑で描く */
  matchGuide = false;
  private palette!: Palette;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement, opts: Partial<GraphOptions> = {}) {
    this.opts = { windowSec: 8, nowFrac: 1, span: 24, ...opts };
    this.ctx = canvas.getContext('2d')!;
    this.readPalette();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readPalette());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  readPalette() {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    this.palette = {
      bg: v('--graph-bg'),
      black: v('--graph-black'),
      grid: v('--graph-grid'),
      gridC: v('--graph-grid-c'),
      label: v('--muted'),
      line: v('--line'),
      good: v('--good'),
      guide: v('--guide'),
      guideHit: v('--good'),
      guideMiss: v('--bad'),
      target: v('--target'),
      now: v('--accent'),
    };
  }

  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  push(p: GraphPoint) {
    this.points.push(p);
    // 古い点は捨てる（表示窓の2倍だけ残す）
    const cutoff = p.t - this.opts.windowSec * 2;
    let i = 0;
    while (i < this.points.length && this.points[i].t < cutoff) i++;
    if (i > 0) this.points.splice(0, i);
  }

  clear() {
    this.points = [];
  }

  private guideAt(t: number): GuideNote | undefined {
    // ガイドは時刻順。表示中の数十個を線形に見るだけなので十分速い
    for (const g of this.guide) {
      if (g.start > t) return undefined;
      if (t < g.end) return g;
    }
    return undefined;
  }

  render(now: number) {
    const { ctx, canvas, opts, palette: P } = this;
    const W = canvas.width;
    const H = canvas.height;
    const d = this.dpr;
    const gx = GUTTER * d;
    const t0 = now - opts.windowSec * opts.nowFrac;
    const x = (t: number) => gx + ((t - t0) / opts.windowSec) * (W - gx);

    if (this.autoCenter) {
      // 直近の有声音に向けて表示範囲をなめらかに追従させる
      const recent = this.points.filter((p) => p.midi !== null && p.t > now - 1.5);
      if (recent.length) {
        const m = recent.reduce((a, p) => a + p.midi!, 0) / recent.length;
        if (Math.abs(m - this.center) > opts.span * 0.3) this.center += (m - this.center) * 0.08;
      }
    }
    const lo = this.center - opts.span / 2;
    const y = (m: number) => H - ((m - lo) / opts.span) * H;
    const rowH = H / opts.span;

    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, W, H);

    // 黒鍵の段を少し暗くしてピアノロールにする
    ctx.fillStyle = P.black;
    for (let m = Math.floor(lo); m <= lo + opts.span + 1; m++) {
      if (BLACK.has(((m % 12) + 12) % 12)) ctx.fillRect(gx, y(m + 0.5), W - gx, rowH);
    }
    // 音名グリッド（C だけ濃い線）
    ctx.font = `600 ${10.5 * d}px Outfit, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let m = Math.ceil(lo); m <= lo + opts.span; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (pc === 0 || pc === 5) {
        ctx.strokeStyle = pc === 0 ? P.gridC : P.grid;
        ctx.lineWidth = d;
        ctx.beginPath();
        ctx.moveTo(gx, y(m - 0.5));
        ctx.lineTo(W, y(m - 0.5));
        ctx.stroke();
      }
      const showLabel = pc === 0 || (!BLACK.has(pc) && rowH > 13 * d) || rowH > 22 * d;
      if (showLabel) {
        ctx.fillStyle = P.label;
        ctx.globalAlpha = pc === 0 ? 1 : 0.7;
        ctx.fillText(midiToName(m), 5 * d, y(m));
        ctx.globalAlpha = 1;
      }
    }

    // ガイドメロディ（音程バー）
    const nowLine = this.live && opts.nowFrac < 1;
    for (const g of this.guide) {
      if (g.end < t0 || g.start > t0 + opts.windowSec) continue;
      const scored = g.score !== undefined;
      ctx.fillStyle = !scored ? P.guide : g.score! >= 0.7 ? P.guideHit : g.score! >= 0.4 ? P.target : P.guideMiss;
      const h = Math.max(rowH * 0.78, 5 * d);
      // 歌い終わった音符は薄く、いま歌う音符は濃く
      ctx.globalAlpha = scored ? 0.6 : !nowLine ? 0.45 : g.end < now ? 0.22 : g.start <= now ? 0.75 : 0.45;
      roundRect(ctx, x(g.start), y(g.midi) - h / 2, Math.max(2 * d, x(g.end) - x(g.start)), h, h / 2);
      ctx.globalAlpha = 1;
    }

    // 目標音などの水平線
    for (const mk of this.marks) {
      if (mk.band) {
        ctx.fillStyle = P.target;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(gx, y(mk.midi + mk.band), W - gx, y(mk.midi - mk.band) - y(mk.midi + mk.band));
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = P.target;
      ctx.lineWidth = 1.5 * d;
      ctx.setLineDash([5 * d, 5 * d]);
      ctx.beginPath();
      ctx.moveTo(gx, y(mk.midi));
      ctx.lineTo(W, y(mk.midi));
      ctx.stroke();
      ctx.setLineDash([]);
      if (mk.label) {
        ctx.font = `700 ${11 * d}px Outfit, system-ui, sans-serif`;
        ctx.fillStyle = P.target;
        ctx.textAlign = 'right';
        ctx.fillText(mk.label, W - 6 * d, y(mk.midi) - 9 * d);
        ctx.textAlign = 'left';
      }
    }

    // 自分のピッチ。ガイドに合っている部分は緑にする（色が変わるところで線を区切る）
    ctx.lineWidth = 3.5 * d;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10 * d;
    let prev: GraphPoint | null = null;
    let color = '';
    let last: GraphPoint | null = null;
    const tEnd = this.live ? now : t0 + opts.windowSec + 0.1;
    const colorOf = (p: GraphPoint) => {
      if (!this.matchGuide) return P.line;
      const g = this.guideAt(p.t);
      return g && Math.abs(octaveFoldedCents(p.midi!, g.midi)) <= 50 ? P.good : P.line;
    };
    ctx.beginPath();
    for (const p of this.points) {
      if (p.t < t0 - 0.1 || p.t > tEnd) continue;
      if (p.midi === null) {
        prev = null;
        continue;
      }
      const c = colorOf(p);
      if (c !== color) {
        ctx.stroke();
        ctx.strokeStyle = ctx.shadowColor = color = c;
        ctx.beginPath();
        if (prev) ctx.moveTo(x(prev.t), y(prev.midi!));
      }
      if (prev === null || Math.abs(p.midi - prev.midi!) > PITCH_JUMP) ctx.moveTo(x(p.t), y(p.midi));
      else ctx.lineTo(x(p.t), y(p.midi));
      prev = p;
      last = p;
    }
    ctx.stroke();

    // いま出している音の位置に光る点
    if (this.live && last && now - last.t < 0.15) {
      ctx.fillStyle = ctx.shadowColor = colorOf(last);
      ctx.shadowBlur = 16 * d;
      ctx.beginPath();
      ctx.arc(x(last.t), y(last.midi!), 5.5 * d, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (nowLine) {
      ctx.strokeStyle = P.now;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5 * d;
      ctx.beginPath();
      ctx.moveTo(x(now), 0);
      ctx.lineTo(x(now), H);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}
