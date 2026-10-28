import './style.css';
import { bus, startMic } from './app';
import { engine } from './audio/engine';
import { icons } from './ui/icons';
import { createFreeMode } from './modes/free';
import type { Mode } from './modes/mode';
import { createRangeMode } from './modes/range';
import { createSongMode } from './modes/song';
import { createSuggestMode } from './modes/suggest';
import { createTrainerMode } from './modes/trainer';

const modes: Mode[] = [createFreeMode(), createRangeMode(), createTrainerMode(), createSongMode(), createSuggestMode()];

const tabs = document.querySelector<HTMLElement>('#tabs')!;
const main = document.querySelector<HTMLElement>('#main')!;
const micBtn = document.querySelector<HTMLButtonElement>('#mic')!;
const micIco = micBtn.querySelector<HTMLElement>('.mic-ico')!;
const micTxt = micBtn.querySelector<HTMLElement>('.mic-txt')!;
const levelBars = [...micBtn.querySelectorAll<HTMLElement>('.mic-level i')];

let active: Mode = modes[0];

for (const m of modes) {
  const b = document.createElement('button');
  b.innerHTML = `${m.icon}<span>${m.title}</span>`;
  b.dataset.mode = m.id;
  b.addEventListener('click', () => activate(m));
  tabs.append(b);
  m.el.hidden = true;
  main.append(m.el);
}

function activate(m: Mode, payload?: unknown) {
  if (m !== active) {
    active.hide?.();
    active.el.hidden = true;
    active = m;
    m.el.hidden = false;
    m.show?.();
    window.scrollTo({ top: 0 });
  }
  if (payload !== undefined) m.open?.(payload);
  tabs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.mode === m.id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  try {
    localStorage.setItem('karaoke-trainer.tab', m.id);
  } catch {
    /* 保存できなくても動作に支障はない */
  }
}

let savedTab = 'free';
try {
  savedTab = localStorage.getItem('karaoke-trainer.tab') ?? 'free';
} catch {
  /* ignore */
}
active.el.hidden = false;
activate(modes.find((m) => m.id === savedTab) ?? modes[0]);

bus.addEventListener('goto', (e) => {
  const { mode, payload } = (e as CustomEvent<{ mode: string; payload?: unknown }>).detail;
  const m = modes.find((x) => x.id === mode);
  if (m) activate(m, payload);
});

// ---- マイク ----
let level = -90;
engine.onPitch((p) => {
  level = Math.max(p.db, level - 1.5); // 下がるときはゆっくり
  active.onPitch?.(p);
});

async function toggleMic() {
  if (engine.running) {
    active.hide?.(); // 曲の再生中なら止めて採点する
    engine.stop();
    active.show?.();
  } else {
    await startMic();
  }
}
micBtn.addEventListener('click', toggleMic);
// グラフ上の「タップしてマイクをオン」
main.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-start-mic]')) void startMic();
});

// 歌っている間は画面を消さない
let wakeLock: WakeLockSentinel | null = null;
async function syncWakeLock() {
  try {
    if (engine.running && !wakeLock && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!engine.running && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* 対応していない・許可されない環境では何もしない */
  }
}
document.addEventListener('visibilitychange', syncWakeLock);

// 曲タブの「開始」でもマイクが始まるので、表示は毎フレーム状態に合わせる
let micShown: boolean | null = null;
function syncMicButton() {
  if (micShown !== engine.running) {
    micShown = engine.running;
    micTxt.textContent = engine.running ? 'マイク ON' : 'マイク OFF';
    micIco.innerHTML = engine.running ? icons.mic : icons.micOff;
    micBtn.classList.toggle('live', engine.running);
    micBtn.setAttribute('aria-pressed', String(engine.running));
    micBtn.setAttribute('aria-label', engine.running ? 'マイクを止める' : 'マイクを開始');
    document.body.classList.toggle('mic-on', engine.running);
    void syncWakeLock();
  }
  if (engine.running) {
    // -60dB〜-15dB を 5 段で表示
    const lv = Math.max(0, Math.min(1, (level + 60) / 45));
    levelBars.forEach((b, i) => b.classList.toggle('on', lv > i / 5));
    level -= 0.5;
  }
}

// キーボード: Space = 曲の開始/停止（曲タブ）・それ以外はマイクのオン/オフ
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t.closest('input:not([type=range]):not([type=checkbox]), select, textarea, button, summary, [contenteditable]')) return;
  e.preventDefault();
  if (!active.onSpace?.()) void toggleMic();
});

// 画面描画ループ。推定結果は解析窓の中心時刻なので少し遅らせて描くと線が途切れない
function loop() {
  const now = engine.ctx ? engine.ctx.currentTime - 0.03 : performance.now() / 1000;
  active.frame?.(now);
  syncMicButton();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
