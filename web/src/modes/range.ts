// 音域測定：0.5秒以上安定して出せた音だけを採用し、地声・裏声別に最低音・最高音を記録
import { midiToName } from '../lib/music';
import { StableNoteDetector } from '../lib/stable';
import { extendRange, loadRanges, saveRanges, type Range, type VoiceRanges } from '../lib/storage';
import { PitchGraph } from '../ui/graph';
import { Readout } from '../ui/readout';
import { h, type Mode } from './mode';

type Voice = keyof VoiceRanges;
const VOICE_LABEL: Record<Voice, string> = { chest: '地声', falsetto: '裏声' };

export function fmtRange(r: Range | null): string {
  if (!r) return '未測定';
  return `${midiToName(r.min)} 〜 ${midiToName(r.max)}（${r.max - r.min + 1}音）`;
}

export function createRangeMode(): Mode {
  let ranges = loadRanges();
  let voice: Voice = 'chest';
  const detector = new StableNoteDetector();

  const el = h('section', { class: 'mode' }, `
    <div class="seg">
      <button data-voice="chest" class="on">地声</button>
      <button data-voice="falsetto">裏声</button>
    </div>
    <div class="readout-slot"></div>
    <div class="progress" title="安定度"><div class="progress-bar"></div></div>
    <p class="last-confirmed muted">&nbsp;</p>
    <canvas class="graph"></canvas>
    <div class="results">
      <div class="result-row" data-voice="chest"><span class="lbl">地声</span><span class="val"></span><button class="small" data-reset="chest">リセット</button></div>
      <div class="result-row" data-voice="falsetto"><span class="lbl">裏声</span><span class="val"></span><button class="small" data-reset="falsetto">リセット</button></div>
    </div>
    <p class="hint">楽な高さから一音ずつ、0.5秒以上まっすぐ伸ばしてください（バーが満タンで採用）。低い方・高い方へ少しずつ広げていきます。結果はこの端末に保存されます。</p>
    <p class="save-warn warn" hidden>この環境では保存できません（プライベートモード等）。ページを閉じると消えます。</p>`);

  const readout = new Readout(el.querySelector('.readout-slot')!);
  const graph = new PitchGraph(el.querySelector('canvas')!);
  const bar = el.querySelector<HTMLElement>('.progress-bar')!;
  const lastEl = el.querySelector<HTMLElement>('.last-confirmed')!;
  const warn = el.querySelector<HTMLElement>('.save-warn')!;

  const render = () => {
    for (const v of ['chest', 'falsetto'] as Voice[]) {
      el.querySelector(`.result-row[data-voice="${v}"] .val`)!.textContent = fmtRange(ranges[v]);
      el.querySelector(`.result-row[data-voice="${v}"]`)!.classList.toggle('current', v === voice);
    }
    el.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.voice === voice));
    const r = ranges[voice];
    graph.marks = r
      ? [
          { midi: r.min, label: `最低 ${midiToName(r.min)}` },
          { midi: r.max, label: `最高 ${midiToName(r.max)}` },
        ]
      : [];
  };
  const persist = () => {
    warn.hidden = saveRanges(ranges);
  };

  el.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
    b.addEventListener('click', () => {
      voice = b.dataset.voice as Voice;
      detector.reset();
      render();
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.reset as Voice;
      if (!confirm(`${VOICE_LABEL[v]}の記録を消しますか？`)) return;
      ranges = { ...ranges, [v]: null };
      persist();
      render();
    }),
  );
  render();

  return {
    id: 'range',
    title: '音域',
    el,
    onPitch(p) {
      readout.update(p.midi, p.t);
      graph.push(p);
      const s = detector.push(p);
      bar.style.width = `${s.progress * 100}%`;
      bar.classList.toggle('done', s.progress >= 1);
      if (s.confirmed !== null) {
        const before = ranges[voice];
        ranges = { ...ranges, [voice]: extendRange(before, s.confirmed) };
        const isNew = !before || s.confirmed < before.min || s.confirmed > before.max;
        lastEl.textContent = `${VOICE_LABEL[voice]} ${midiToName(s.confirmed)} を採用${isNew ? '（記録更新）' : ''}`;
        persist();
        render();
      }
    },
    frame(now) {
      graph.render(now);
    },
    show() {
      ranges = loadRanges(); // 他のタブで変わっている可能性
      render();
    },
  };
}
