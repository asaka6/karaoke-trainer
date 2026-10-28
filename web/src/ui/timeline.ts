// 曲全体を見渡す細長い帯。音符の分布・再生位置・ズレた区間を表示し、タップ／ドラッグで位置を選ぶ
import type { SongNote } from '../lib/song';

export interface TimelineMark {
  start: number;
  end: number;
}

export class Timeline {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  notes: SongNote[] = [];
  duration = 0;
  position = 0;
  /** 歌った範囲 */
  sung: TimelineMark | null = null;
  problems: TimelineMark[] = [];
  enabled = true;
  onSeek: (t: number) => void = () => {};
  private dpr = 1;
  private dirty = true;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'timeline';
    this.el.innerHTML = `<canvas></canvas><div class="tl-times"><span class="tl-pos">0:00</span><span class="tl-dur">0:00</span></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => {
      this.dpr = window.devicePixelRatio || 1;
      const r = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.round(r.width * this.dpr);
      this.canvas.height = Math.round(r.height * this.dpr);
      this.dirty = true;
    }).observe(this.canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => (this.dirty = true));

    const seekFrom = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.onSeek(f * this.duration);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.duration) return;
      this.canvas.setPointerCapture(e.pointerId);
      seekFrom(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.enabled && this.canvas.hasPointerCapture(e.pointerId)) seekFrom(e);
    });
  }

  invalidate() {
    this.dirty = true;
  }

  setPosition(t: number) {
    if (Math.abs(t - this.position) < 0.02) return;
    this.position = t;
    this.dirty = true;
  }

  render(fmt: (s: number) => string) {
    if (!this.dirty) return;
    this.dirty = false;
    this.el.querySelector('.tl-pos')!.textContent = fmt(this.position);
    this.el.querySelector('.tl-dur')!.textContent = fmt(this.duration);
    this.el.classList.toggle('disabled', !this.enabled);
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const d = this.dpr;
    ctx.clearRect(0, 0, W, H);
    if (!this.duration) return;
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    const x = (t: number) => (t / this.duration) * W;

    ctx.fillStyle = v('--surface-2');
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 6 * d);
    ctx.fill();

    if (this.sung) {
      ctx.fillStyle = v('--line');
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x(this.sung.start), 0, x(this.sung.end) - x(this.sung.start), H);
    }
    ctx.fillStyle = v('--bad');
    ctx.globalAlpha = 0.35;
    for (const p of this.problems) ctx.fillRect(x(p.start), 0, Math.max(2 * d, x(p.end) - x(p.start)), H);
    ctx.globalAlpha = 1;

    // 音符を小さく描く（縦位置 = 音の高さ）
    if (this.notes.length) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of this.notes) {
        lo = Math.min(lo, n.midi);
        hi = Math.max(hi, n.midi);
      }
      const pad = 5 * d;
      const y = (m: number) => H - pad - ((m - lo) / Math.max(1, hi - lo)) * (H - pad * 2);
      ctx.fillStyle = v('--muted');
      ctx.globalAlpha = 0.65;
      for (const n of this.notes) ctx.fillRect(x(n.start), y(n.midi) - d, Math.max(d, x(n.end) - x(n.start)), 2 * d);
      ctx.globalAlpha = 1;
    }

    const px = x(this.position);
    ctx.fillStyle = v('--accent');
    ctx.fillRect(px - d, 0, 2 * d, H);
    ctx.beginPath();
    ctx.arc(px, H / 2, 5 * d, 0, Math.PI * 2);
    ctx.fill();
  }
}
