// 実ブラウザでの動作確認。
// Chrome の偽マイク（WAV ファイルを入力にする機能）で、マイク → AudioWorklet → 表示 の経路を確かめ、
// スマホ幅のスクリーンショットをライト/ダークで撮る。
//   node e2e/smoke.mjs            （事前に python e2e/make_fake_voice.py e2e-shots/voice.wav）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const outDir = resolve('e2e-shots');
mkdirSync(outDir, { recursive: true });
const wav = resolve(outDir, 'voice.wav');
if (!existsSync(wav)) execFileSync('python', ['e2e/make_fake_voice.py', wav], { stdio: 'inherit' });

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const url = 'http://localhost:5199/';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav.replaceAll('\\', '/')}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // フリー：A3 → C4 … と鳴っているので、出てきた音名を集める
    await page.click('#mic');
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(100);
      const n = await page.textContent('section:not([hidden]) .readout-note');
      if (n && n !== '--') seen.add(n.trim());
    }
    if (scheme === 'light') {
      check('フリー: 偽マイクの A3/C4/G3 を検出', ['A3', 'C4', 'G3'].every((n) => seen.has(n)), [...seen].join(','));
    }
    await page.screenshot({ path: `${outDir}/free-${scheme}.png` });

    // 音域（地声）：A3, C4, G3 は採用、0.3秒の E4 は不採用 → G3〜C4
    await page.click('#tabs button[data-mode="range"]');
    await page.waitForTimeout(8000);
    const chest = await page.textContent('.result-row[data-voice="chest"] .val');
    if (scheme === 'light') check('音域: 0.5秒以上の音だけ採用 (G3〜C4)', chest.startsWith('G3 〜 C4'), chest);
    const stored = await page.evaluate(() => localStorage.getItem('karaoke-trainer.ranges.v1'));
    if (scheme === 'light') check('音域: localStorage に保存', stored?.includes('"chest"'), stored ?? 'null');
    await page.screenshot({ path: `${outDir}/range-${scheme}.png` });

    // 裏声に切り替えると別に記録される
    await page.click('.seg button[data-voice="falsetto"]');
    await page.waitForTimeout(4500);
    const fal = await page.textContent('.result-row[data-voice="falsetto"] .val');
    if (scheme === 'light') check('音域: 裏声は別枠で記録', fal !== '未測定', fal);

    // ボイトレ：目標 A3 で偽マイクが A3 を出している間に「OK」が出るか
    await page.click('#tabs button[data-mode="trainer"]');
    await page.selectOption('.target', '57');
    let judged = '';
    for (let i = 0; i < 60 && judged !== 'OK'; i++) {
      await page.waitForTimeout(100);
      judged = (await page.textContent('.s-judge')) ?? '';
    }
    if (scheme === 'light') check('ボイトレ: A3 を正しく出したら OK', judged === 'OK', judged);
    await page.screenshot({ path: `${outDir}/trainer-${scheme}.png` });

    // スマホ幅で横スクロールが出ていないか
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`${scheme}: 横スクロールなし`, !overflow);
    check(`${scheme}: コンソールエラーなし`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
