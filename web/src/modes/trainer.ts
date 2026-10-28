// ボイトレ：目標音を鳴らし、同じ音を出したときのズレと安定度を表示
import { engine } from '../audio/engine';
import { midiToFreq, midiToName, octaveFoldedCents } from '../lib/music';
import { load, save } from '../lib/storage';
import type { PitchPoint } from '../lib/tracker';
import { icons } from '../ui/icons';
import { PitchGraph } from '../ui/graph';
import { Readout } from '../ui/readout';
import { h, stageHtml, type Mode } from './mode';

const WINDOW = 1.0; // 直近何秒で評価するか
const CLEAR_HOLD = 1.0; // 自動で次へ進むのに必要な「OK」の継続時間 [s]
const KEY = 'karaoke-trainer.trainer.v1';

type Auto = 'off' | 'up' | 'down';
const AUTO_LABEL: Record<Auto, string> = { off: '自動で次の音へ: オフ', up: '自動で次の音へ: ↑ 上へ', down: '自動で次の音へ: ↓ 下へ' };

/** 直近区間のピッチから平均ズレと安定度を求める */
export function evaluateHold(points: PitchPoint[], target: number) {
  const c = points.filter((p) => p.midi !== null).map((p) => octaveFoldedCents(p.midi!, target));
  if (c.length < 10) return null;
  const mean = c.reduce((a, b) => a + b, 0) / c.length;
  const sd = Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / c.length);
  return { mean, sd, stability: Math.max(0, Math.min(100, Math.round(100 - sd * 2))) };
}

export function createTrainerMode(): Mode {
  const saved = load(KEY, { target: 57, auto: 'off' as Auto });
  let target = saved.target;
  let auto: Auto = saved.auto;
  let muteUntil = 0;
  let okSince: number | null = null;
  let streak = 0;
  const recent: PitchPoint[] = [];

  const options = Array.from({ length: 84 - 36 + 1 }, (_, i) => 36 + i)
    .map((m) => `<option value="${m}">${midiToName(m)}</option>`)
    .join('');
  const el = h('section', { class: 'mode' }, `
    <div class="mode-head"><h2>ボイトレ</h2><p>お手本を聞いて同じ高さで伸ばします。直近1秒の平均ズレと揺れを判定。イヤホン推奨。</p></div>
    <div class="target-row card">
      <button class="step icon-btn" data-step="-1" aria-label="半音下げる">${icons.minus}</button>
      <div class="target-box"><span class="target-cap">目標</span><select class="target" aria-label="目標音">${options}</select></div>
      <button class="step icon-btn" data-step="1" aria-label="半音上げる">${icons.plus}</button>
      <button class="primary play">${icons.speaker}<span>お手本</span></button>
    </div>
    <div class="readout-slot"></div>
    <div class="stats">
      <div><span>平均ズレ</span><b class="s-mean">--</b></div>
      <div><span>安定度</span><b class="s-stab">--</b></div>
      <div class="judge"><span>判定</span><b class="s-judge">--</b></div>
    </div>
    <div class="trainer-opts">
      <button class="chip auto-btn"></button>
      <span class="streak muted"></span>
    </div>
    <p class="octave-note muted">&nbsp;</p>
    ${stageHtml()}`);

  const sel = el.querySelector<HTMLSelectElement>('.target')!;
  const readout = new Readout(el.querySelector('.readout-slot')!);
  const graph = new PitchGraph(el.querySelector('canvas')!, { span: 12 });
  graph.autoCenter = false;
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
  const autoBtn = $('.auto-btn');

  const persist = () => save(KEY, { target, auto });
  const renderAuto = () => {
    autoBtn.textContent = AUTO_LABEL[auto];
    autoBtn.classList.toggle('on', auto !== 'off');
    $('.streak').textContent = auto !== 'off' && streak ? `連続クリア ${streak}` : '';
  };

  const setTarget = (m: number) => {
    target = Math.max(36, Math.min(84, m));
    sel.value = String(target);
    graph.center = target;
    graph.marks = [{ midi: target, label: midiToName(target), band: 0.15 }];
    recent.length = 0;
    okSince = null;
    persist();
  };

  const playExample = async () => {
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
    okSince = null;
  };

  sel.addEventListener('change', () => setTarget(parseInt(sel.value, 10)));
  el.querySelectorAll<HTMLButtonElement>('.step').forEach((b) =>
    b.addEventListener('click', () => setTarget(target + parseInt(b.dataset.step!, 10))),
  );
  $('.play').addEventListener('click', playExample);
  autoBtn.addEventListener('click', () => {
    auto = auto === 'off' ? 'up' : auto === 'up' ? 'down' : 'off';
    streak = 0;
    persist();
    renderAuto();
  });
  setTarget(target);
  renderAuto();

  return {
    id: 'trainer',
    title: 'ボイトレ',
    icon: icons.target,
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
      const judge = $('.s-judge');
      judge.textContent = ok ? 'OK' : Math.abs(r.mean) > 20 ? (r.mean > 0 ? '高い' : '低い') : '揺れ';
      judge.dataset.ok = String(ok);
      $('.judge').dataset.ok = String(ok);
      const last = recent.filter((q) => q.midi !== null).at(-1)!;
      const oct = Math.round((last.midi! - target) / 12);
      $('.octave-note').textContent = oct
        ? `${Math.abs(oct)}オクターブ${oct > 0 ? '上' : '下'}で歌っています（ズレはオクターブを無視して計算）`
        : ' ';

      // 自動で次へ：OK が一定時間続いたら半音動かしてお手本を鳴らす
      okSince = ok ? (okSince ?? p.t) : null;
      if (auto !== 'off' && okSince !== null && p.t - okSince >= CLEAR_HOLD) {
        streak++;
        setTarget(target + (auto === 'up' ? 1 : -1));
        renderAuto();
        void playExample();
      }
    },
    frame(now) {
      graph.render(now);
    },
  };
}
