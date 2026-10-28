// 横スクロールする音程グラフ（縦軸 = 半音ごとの音名グリッド）
import { midiToName } from '../lib/music';

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
  grid: string;
  gridC: string;
  label: string;
  line: string;
  guide: string;
  guideHit: string;
  guideMiss: string;
  target: string;
  now: string;
}

const PITCH_JUMP = 1.5; // これ以上離れた点は線で結ばない [半音]

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
      grid: v('--graph-grid'),
      gridC: v('--graph-grid-c'),
      label: v('--muted'),
      line: v('--accent'),
      guide: v('--guide'),
      guideHit: v('--good'),
      guideMiss: v('--bad'),
      target: v('--target'),
      now: v('--muted'),
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

  render(now: number) {
    const { ctx, canvas, opts, palette: P } = this;
    const W = canvas.width;
    const H = canvas.height;
    const d = this.dpr;
    const t0 = now - opts.windowSec * opts.nowFrac;
    const x = (t: number) => ((t - t0) / opts.windowSec) * W;

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

    // 音名グリッド
    ctx.font = `${11 * d}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let m = Math.ceil(lo); m <= lo + opts.span; m++) {
      const isC = m % 12 === 0;
      const isNatural = [0, 2, 4, 5, 7, 9, 11].includes(((m % 12) + 12) % 12);
      ctx.strokeStyle = isC ? P.gridC : P.grid;
      ctx.lineWidth = isC ? 1.5 * d : d;
      ctx.beginPath();
      ctx.moveTo(0, y(m));
      ctx.lineTo(W, y(m));
      ctx.stroke();
      if (isC || (isNatural && rowH > 14 * d) || rowH > 22 * d) {
        ctx.fillStyle = P.label;
        ctx.fillText(midiToName(m), 4 * d, y(m) - 0.01);
      }
    }

    // ガイドメロディ（音程バー）
    for (const g of this.guide) {
      if (g.end < t0 || g.start > t0 + opts.windowSec) continue;
      ctx.fillStyle = g.score === undefined ? P.guide : g.score >= 0.7 ? P.guideHit : g.score >= 0.4 ? P.target : P.guideMiss;
      const h = Math.max(rowH * 0.8, 4 * d);
      ctx.globalAlpha = 0.55;
      roundRect(ctx, x(g.start), y(g.midi) - h / 2, Math.max(2, x(g.end) - x(g.start)), h, 3 * d);
      ctx.globalAlpha = 1;
    }

    // 目標音などの水平線
    for (const mk of this.marks) {
      if (mk.band) {
        ctx.fillStyle = P.target;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(0, y(mk.midi + mk.band), W, y(mk.midi - mk.band) - y(mk.midi + mk.band));
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = P.target;
      ctx.lineWidth = 2 * d;
      ctx.setLineDash([6 * d, 4 * d]);
      ctx.beginPath();
      ctx.moveTo(0, y(mk.midi));
      ctx.lineTo(W, y(mk.midi));
      ctx.stroke();
      ctx.setLineDash([]);
      if (mk.label) {
        ctx.fillStyle = P.target;
        ctx.textAlign = 'right';
        ctx.fillText(mk.label, W - 4 * d, y(mk.midi) - 9 * d);
        ctx.textAlign = 'left';
      }
    }

    // 自分のピッチ
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 3 * d;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let prev: number | null = null;
    for (const p of this.points) {
      if (p.t < t0 - 0.1 || p.t > now) continue;
      if (p.midi === null) {
        prev = null;
        continue;
      }
      if (prev === null || Math.abs(p.midi - prev) > PITCH_JUMP) ctx.moveTo(x(p.t), y(p.midi));
      else ctx.lineTo(x(p.t), y(p.midi));
      prev = p.midi;
    }
    ctx.stroke();

    if (opts.nowFrac < 1) {
      ctx.strokeStyle = P.now;
      ctx.lineWidth = d;
      ctx.beginPath();
      ctx.moveTo(x(now), 0);
      ctx.lineTo(x(now), H);
      ctx.stroke();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}
