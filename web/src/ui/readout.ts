// 現在の音名とセントのズレを表示する部品
import { centsOff, midiToName } from '../lib/music';

/** "C#4" → 音名・♯・オクターブを分けて大きく見せる HTML（textContent は "C#4" のまま） */
export function noteHtml(midi: number): string {
  const m = /^([A-G])(#?)(-?\d)$/.exec(midiToName(midi))!;
  return `${m[1]}${m[2] ? `<span class="sharp">#</span>` : ''}<span class="oct">${m[3]}</span>`;
}

export class Readout {
  private note: HTMLElement;
  private cents: HTMLElement;
  private needle: HTMLElement;
  private root: HTMLElement;
  private lastVoiced = 0;
  private shownMidi: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('readout');
    root.innerHTML = `
      <div class="readout-note">--</div>
      <div class="meter" aria-hidden="true">
        <div class="meter-zone"></div>
        <div class="meter-ticks"></div>
        <div class="meter-needle"></div>
      </div>
      <div class="meter-labels" aria-hidden="true"><span>低い</span><span class="readout-cents">&nbsp;</span><span>高い</span></div>`;
    this.note = root.querySelector('.readout-note')!;
    this.cents = root.querySelector('.readout-cents')!;
    this.needle = root.querySelector('.meter-needle')!;
  }

  /** reference を渡すとその音からのズレを表示（ボイトレ用） */
  update(midi: number | null, t: number, reference?: number) {
    if (midi === null) {
      // 一瞬途切れただけで表示が消えるとチラつくので 0.3 秒は残す
      if (t - this.lastVoiced > 0.3 && this.shownMidi !== null) {
        this.shownMidi = null;
        this.note.textContent = '--';
        this.cents.innerHTML = '&nbsp;';
        this.root.dataset.state = 'idle';
      }
      return;
    }
    this.lastVoiced = t;
    const c = reference === undefined ? centsOff(midi) : (midi - reference) * 100;
    const rounded = Math.round(midi);
    if (rounded !== this.shownMidi) {
      this.shownMidi = rounded;
      this.note.innerHTML = noteHtml(rounded);
    }
    const shown = Math.round(c);
    this.cents.textContent = `${shown > 0 ? '+' : ''}${shown}¢`;
    const clamped = Math.max(-50, Math.min(50, c));
    this.needle.style.left = `${50 + clamped}%`;
    const abs = Math.abs(c);
    this.root.dataset.state = abs <= 15 ? 'ok' : abs <= 30 ? 'near' : 'off';
  }
}
