import type { PitchPoint } from '../lib/tracker';

export interface Mode {
  id: string;
  title: string;
  el: HTMLElement;
  /** マイクのピッチが届くたびに呼ばれる */
  onPitch?(p: PitchPoint): void;
  /** 毎フレーム呼ばれる（now = AudioContext 時刻） */
  frame?(now: number): void;
  show?(): void;
  hide?(): void;
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
