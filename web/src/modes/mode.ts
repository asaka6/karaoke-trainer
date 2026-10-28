import type { PitchPoint } from '../lib/tracker';
import { icons } from '../ui/icons';

export interface Mode {
  id: string;
  title: string;
  icon: string;
  el: HTMLElement;
  /** マイクのピッチが届くたびに呼ばれる */
  onPitch?(p: PitchPoint): void;
  /** 毎フレーム呼ばれる（now = AudioContext 時刻） */
  frame?(now: number): void;
  show?(): void;
  hide?(): void;
  /** 他のタブから開かれたときに渡されるデータ */
  open?(payload: unknown): void;
  /** Space キー。true を返したら処理済み */
  onSpace?(): boolean;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

/** グラフ canvas と、マイクが止まっているときに出す「タップで開始」の覆い */
export function stageHtml(cls = 'graph', extra = '') {
  return `<div class="stage">
    <canvas class="${cls}"></canvas>${extra}
    <button class="stage-mic" data-start-mic>${icons.mic}<span>タップしてマイクをオン</span></button>
  </div>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
