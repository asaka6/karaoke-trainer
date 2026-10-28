// ボイトレ：目標音を鳴らし、同じ音を出したときのズレと安定度を表示
import { engine } from '../audio/engine';
import { midiToFreq, midiToName, octaveFoldedCents } from '../lib/music';
import type { PitchPoint } from '../lib/tracker';
import { PitchGraph } from '../ui/graph';
import { Readout } from '../ui/readout';
import { h, type Mode } from './mode';

const WINDOW = 1.0; // 直近何秒で評価するか

/** 直近区間のピッチから平均ズレと安定度を求める */
export function evaluateHold(points: PitchPoint[], target: number) {
  const c = points.filter((p) => p.midi !== null).map((p) => octaveFoldedCents(p.midi!, target));
  if (c.length < 10) return null;
  const mean = c.reduce((a, b) => a + b, 0) / c.length;
  const sd = Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / c.length);
  return { mean, sd, stability: Math.max(0, Math.min(100, Math.round(100 - sd * 2))) };
}

export function createTrainerMode(): Mode {
  let target = 57; // A3
  let muteUntil = 0;
  const recent: PitchPoint[] = [];

  const options = Array.from({ length: 84 - 36 + 1 }, (_, i) => 36 + i)
    .map((m) => `<option value="${m}">${midiToName(m)}</option>`)
    .join('');
  const el = h('section', { class: 'mode' }, `
    <div class="target-row">
      <button class="step" data-step="-1" aria-label="半音下げる">−</button>
      <select class="target" aria-label="目標音">${options}</select>
      <button class="step" data-step="1" aria-label="半音上げる">＋</button>
      <button class="primary play">▶ お手本</button>
    </div>
    <div class="readout-slot"></div>
    <div class="stats">
      <div><span class="muted">平均ズレ</span><b class="s-mean">--</b></div>
      <div><span class="muted">安定度</span><b class="s-stab">--</b></div>
      <div><span class="muted">判定</span><b class="s-judge">--</b></div>
    </div>
    <p class="octave-note muted">&nbsp;</p>
    <canvas class="graph"></canvas>
    <p class="hint">お手本を聞いてから同じ高さで伸ばします。直近1秒の平均ズレと揺れ（安定度）を表示します。イヤホン推奨。</p>`);

  const sel = el.querySelector<HTMLSelectElement>('.target')!;
  const readout = new Readout(el.querySelector('.readout-slot')!);
  const graph = new PitchGraph(el.querySelector('canvas')!, { span: 12 });
  graph.autoCenter = false;
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;

  const setTarget = (m: number) => {
    target = Math.max(36, Math.min(84, m));
    sel.value = String(target);
    graph.center = target;
    graph.marks = [{ midi: target, label: midiToName(target), band: 0.15 }];
    recent.length = 0;
  };
  sel.addEventListener('change', () => setTarget(parseInt(sel.value, 10)));
  el.querySelectorAll<HTMLButtonElement>('.step').forEach((b) =>
    b.addEventListener('click', () => setTarget(target + parseInt(b.dataset.step!, 10))),
  );
  $('.play').addEventListener('click', async () => {
    const ctx = await engine.ensureContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(target);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.03);
    g.gain.setValueAtTime(0.3, t + 1.3);
    g.gain.linearRampToValueAtTime(0, t + 1.5);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.55);
    muteUntil = t + 1.7; // お手本の音をマイクが拾っても評価しない
    recent.length = 0;
  });
  setTarget(target);

  return {
    id: 'trainer',
    title: 'ボイトレ',
    el,
    onPitch(p) {
      if (p.t < muteUntil) return;
      readout.update(p.midi, p.t, target);
      graph.push(p);
      recent.push(p);
      while (recent.length && recent[0].t < p.t - WINDOW) recent.shift();
      const r = evaluateHold(recent, target);
      if (!r) return;
      const m = Math.round(r.mean);
      $('.s-mean').textContent = `${m > 0 ? '+' : ''}${m}¢`;
      $('.s-stab').textContent = String(r.stability);
      const ok = Math.abs(r.mean) <= 20 && r.stability >= 70;
      $('.s-judge').textContent = ok ? 'OK' : Math.abs(r.mean) > 20 ? (r.mean > 0 ? '高い' : '低い') : '揺れ';
      $('.s-judge').dataset.ok = String(ok);
      const last = recent.filter((q) => q.midi !== null).at(-1)!;
      const oct = Math.round((last.midi! - target) / 12);
      $('.octave-note').textContent = oct
        ? `${Math.abs(oct)}オクターブ${oct > 0 ? '上' : '下'}で歌っています（ズレはオクターブを無視して計算）`
        : ' ';
    },
    frame(now) {
      graph.render(now);
    },
  };
}
