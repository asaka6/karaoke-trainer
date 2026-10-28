// 音域測定：0.5秒以上安定して出せた音だけを採用し、地声・裏声別に最低音・最高音を記録
import { midiToName } from '../lib/music';
import { StableNoteDetector } from '../lib/stable';
import { extendRange, loadRanges, saveRanges, type Range, type VoiceRanges } from '../lib/storage';
import { icons } from '../ui/icons';
import { PitchGraph } from '../ui/graph';
import { RangeKeyboard } from '../ui/keyboard';
import { Readout } from '../ui/readout';
import { toast } from '../ui/toast';
import { h, stageHtml, type Mode } from './mode';

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
    <div class="mode-head"><h2>音域</h2><p>楽な高さから一音ずつ 0.5 秒まっすぐ伸ばす → リングが満タンで採用。少しずつ上下に広げます。</p></div>
    <div class="seg" role="tablist">
      <button data-voice="chest" class="on" role="tab">地声</button>
      <button data-voice="falsetto" role="tab">裏声</button>
    </div>
    <div class="range-live">
      <div class="readout-slot"></div>
      <div class="hold" aria-label="安定度"><svg viewBox="0 0 44 44"><circle class="hold-bg" cx="22" cy="22" r="19"/><circle class="hold-fg" cx="22" cy="22" r="19" pathLength="100"/></svg><span class="hold-txt">HOLD</span></div>
    </div>
    <div class="progress" hidden><div class="progress-bar"></div></div>
    <p class="last-confirmed muted">&nbsp;</p>
    <div class="kb-slot card"></div>
    <div class="results">
      <div class="result-row" data-voice="chest"><span class="dot"></span><span class="lbl">地声</span><span class="val"></span><button class="small ghost" data-reset="chest">リセット</button></div>
      <div class="result-row" data-voice="falsetto"><span class="dot"></span><span class="lbl">裏声</span><span class="val"></span><button class="small ghost" data-reset="falsetto">リセット</button></div>
    </div>
    ${stageHtml('graph short')}
    <p class="save-warn warn" hidden>この環境では保存できません（プライベートモード等）。ページを閉じると消えます。</p>`);

  const readout = new Readout(el.querySelector('.readout-slot')!);
  const graph = new PitchGraph(el.querySelector('canvas')!);
  const kb = new RangeKeyboard();
  el.querySelector('.kb-slot')!.append(kb.el);
  const bar = el.querySelector<HTMLElement>('.progress-bar')!;
  const hold = el.querySelector<HTMLElement>('.hold')!;
  const holdFg = el.querySelector<SVGCircleElement>('.hold-fg')!;
  const lastEl = el.querySelector<HTMLElement>('.last-confirmed')!;
  const warn = el.querySelector<HTMLElement>('.save-warn')!;

  const render = () => {
    for (const v of ['chest', 'falsetto'] as Voice[]) {
      el.querySelector(`.result-row[data-voice="${v}"] .val`)!.textContent = fmtRange(ranges[v]);
      el.querySelector(`.result-row[data-voice="${v}"]`)!.classList.toggle('current', v === voice);
    }
    el.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.voice === voice);
      b.setAttribute('aria-selected', String(b.dataset.voice === voice));
    });
    kb.setRanges(ranges.chest, ranges.falsetto);
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
    icon: icons.range,
    el,
    onPitch(p) {
      readout.update(p.midi, p.t);
      graph.push(p);
      kb.setCurrent(p.midi);
      const s = detector.push(p);
      bar.style.width = `${s.progress * 100}%`;
      holdFg.style.strokeDashoffset = String(100 - s.progress * 100);
      hold.classList.toggle('done', s.progress >= 1);
      if (s.confirmed !== null) {
        const before = ranges[voice];
        ranges = { ...ranges, [voice]: extendRange(before, s.confirmed) };
        const isNew = !before || s.confirmed < before.min || s.confirmed > before.max;
        lastEl.textContent = `${VOICE_LABEL[voice]} ${midiToName(s.confirmed)} を採用${isNew ? '（記録更新）' : ''}`;
        lastEl.classList.toggle('new', isNew);
        if (isNew && before) toast(`記録更新！ ${VOICE_LABEL[voice]} ${fmtRange(ranges[voice])}`, 'success', 2000);
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
