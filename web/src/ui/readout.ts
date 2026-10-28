// 現在の音名とセントのズレを表示する部品
import { centsOff, midiToName } from '../lib/music';

export class Readout {
  private note: HTMLElement;
  private cents: HTMLElement;
  private needle: HTMLElement;
  private lastVoiced = 0;

  constructor(root: HTMLElement) {
    root.classList.add('readout');
    root.innerHTML = `
      <div class="readout-note">--</div>
      <div class="meter"><div class="meter-zero"></div><div class="meter-needle"></div></div>
      <div class="readout-cents">&nbsp;</div>`;
    this.note = root.querySelector('.readout-note')!;
    this.cents = root.querySelector('.readout-cents')!;
    this.needle = root.querySelector('.meter-needle')!;
  }

  /** reference を渡すとその音からのズレを表示（ボイトレ用） */
  update(midi: number | null, t: number, reference?: number) {
    if (midi === null) {
      // 一瞬途切れただけで表示が消えるとチラつくので 0.3 秒は残す
      if (t - this.lastVoiced > 0.3) {
        this.note.textContent = '--';
        this.cents.innerHTML = '&nbsp;';
        this.needle.style.opacity = '0';
      }
      return;
    }
    this.lastVoiced = t;
    const c = reference === undefined ? centsOff(midi) : (midi - reference) * 100;
    this.note.textContent = midiToName(midi);
    const shown = Math.round(c);
    this.cents.textContent = `${shown > 0 ? '+' : ''}${shown} セント`;
    const clamped = Math.max(-50, Math.min(50, c));
    this.needle.style.opacity = '1';
    this.needle.style.left = `${50 + clamped}%`;
    this.needle.dataset.ok = String(Math.abs(c) <= 15);
  }
}
