import './style.css';
import { engine } from './audio/engine';
import { createFreeMode } from './modes/free';
import type { Mode } from './modes/mode';
import { createRangeMode } from './modes/range';
import { createTrainerMode } from './modes/trainer';

const modes: Mode[] = [createFreeMode(), createRangeMode(), createTrainerMode()];

const tabs = document.querySelector<HTMLElement>('#tabs')!;
const main = document.querySelector<HTMLElement>('#main')!;
const micBtn = document.querySelector<HTMLButtonElement>('#mic')!;
const status = document.querySelector<HTMLElement>('#status')!;

let active: Mode = modes[0];

for (const m of modes) {
  const b = document.createElement('button');
  b.textContent = m.title;
  b.dataset.mode = m.id;
  b.addEventListener('click', () => activate(m));
  tabs.append(b);
  m.el.hidden = true;
  main.append(m.el);
}

function activate(m: Mode) {
  active.hide?.();
  active.el.hidden = true;
  active = m;
  m.el.hidden = false;
  m.show?.();
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m.id));
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
activate(modes.find((m) => m.id === savedTab) ?? modes[0]);

engine.onPitch((p) => active.onPitch?.(p));

micBtn.addEventListener('click', async () => {
  if (engine.running) {
    engine.stop();
  } else {
    try {
      status.textContent = '';
      await engine.start();
    } catch (e) {
      status.textContent = `マイクを開始できませんでした: ${(e as Error).message}`;
    }
  }
  micBtn.textContent = engine.running ? '■ 停止' : '🎤 マイク開始';
  micBtn.classList.toggle('live', engine.running);
});

// 画面描画ループ。推定結果は解析窓の中心時刻なので少し遅らせて描くと線が途切れない
function loop() {
  const now = engine.ctx ? engine.ctx.currentTime - 0.03 : performance.now() / 1000;
  active.frame?.(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
