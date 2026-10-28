// フェーズ3（曲で練習・採点・選曲提案）の実ブラウザ動作確認。
// ?test=guide でガイド音をそのままピッチ推定に入れる＝「ガイド通りに完璧に歌った」状態を作り、採点が高くなるかを見る。
//   node e2e/song.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const outDir = resolve('e2e-shots/song');
mkdirSync(outDir, { recursive: true });

// ---- 合成の曲データ（著作物ではない） ----
const melody = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 67, 64, 60];
const notes = [];
let t = 1.0;
for (const [i, m] of melody.entries()) {
  const d = i % 5 === 4 ? 1.2 : 0.5;
  notes.push({ start: +t.toFixed(3), end: +(t + d).toFixed(3), midi: m });
  t += d + 0.1;
}
const duration = t + 1;
const song = { title: 'テスト曲', artist: 'e2e', notes, range: { min: 60, max: 72 }, duration };
writeFileSync(`${outDir}/test.json`, JSON.stringify(song));

// 伴奏: C の和音を鳴らし続ける WAV
const SR = 44100;
const n = Math.round(SR * duration);
const pcm = Buffer.alloc(44 + n * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + n * 2, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  const s = [130.81, 164.81, 196].reduce((a, f) => a + Math.sin((2 * Math.PI * f * i) / SR), 0) * 0.1;
  pcm.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
}
writeFileSync(`${outDir}/accompaniment.wav`, pcm);

const index = {
  songs: [
    { id: 'a', title: 'そのまま曲', artist: 'x', range: { min: 50, max: 64 } },
    { id: 'b', title: '高い曲', artist: 'y', range: { min: 55, max: 69 } },
    { id: 'c', title: '広すぎる曲', artist: 'z', range: { min: 40, max: 76 } },
  ],
};
writeFileSync(`${outDir}/index.json`, JSON.stringify(index));

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

async function singThrough(page, keyValue) {
  await page.selectOption('.key-sel', String(keyValue));
  await page.click('.start');
  // キー変更の処理（Worker）が終わって再生が始まるまで待つ
  await page.waitForSelector('.start.live', { timeout: 60000 });
  await page.waitForSelector('.result:not([hidden])', { timeout: (duration + 20) * 1000 });
  return {
    total: +(await page.textContent('.r-total')),
    pitch: parseFloat(await page.textContent('.r-pitch')),
    sections: await page.$$eval('.sections li', (li) => li.map((x) => x.textContent)),
  };
}

try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://localhost:5198/?test=guide');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('karaoke-trainer.ranges.v1', JSON.stringify({ chest: { min: 48, max: 64 }, falsetto: { min: 60, max: 67 } }));
    });
    await page.reload();

    await page.click('#tabs button[data-mode="song"]');
    await page.setInputFiles('.files', [`${outDir}/test.json`, `${outDir}/accompaniment.wav`]);
    await page.waitForSelector('.start:not([disabled])');
    const info = await page.textContent('.song-info');
    if (scheme === 'light') check('曲: JSON と伴奏を読み込み', info.includes('テスト曲') && info.includes('accompaniment.wav'), info);

    if (scheme === 'light') {
      const r0 = await singThrough(page, 0);
      check('曲: ガイド通りに歌うと音程正確率が高い（原曲キー）', r0.pitch >= 90, JSON.stringify(r0));
      const t0 = Date.now();
      const r2 = await singThrough(page, 2);
      check('曲: キー +2（伴奏をピッチシフト）でも採点が合う', r2.pitch >= 90, `${JSON.stringify(r2)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } else {
      await singThrough(page, -3);
    }
    await page.evaluate(() => document.querySelector('.result').scrollIntoView());
    await page.screenshot({ path: `${outDir}/result-${scheme}.png`, fullPage: true });

    // 途中で止めた場合：歌った範囲だけ採点される
    if (scheme === 'light') {
      await page.selectOption('.key-sel', '0');
      await page.click('.start');
      await page.waitForSelector('.start.live');
      await page.waitForTimeout(4500);
      await page.screenshot({ path: `${outDir}/playing-${scheme}.png` });
      await page.click('.start');
      await page.waitForSelector('.result:not([hidden])');
      const partial = parseFloat(await page.textContent('.r-pitch'));
      check('曲: 途中停止でも歌った範囲で採点', partial >= 85, String(partial));

      // ライブラリ：再読み込み後もタップで開け、記録が残っている
      await page.reload();
      await page.click('#tabs button[data-mode="song"]');
      await page.waitForSelector('.lib-open');
      await page.screenshot({ path: `${outDir}/library-${scheme}.png` });
      const libText = await page.textContent('.lib-items');
      check('ライブラリ: 再読み込み後も曲と自己ベストが残る', libText.includes('テスト曲') && /\d+点/.test(libText), libText);
      await page.click('.lib-open');
      await page.waitForSelector('.start:not([disabled])');
      const info2 = await page.textContent('.song-info');
      check('ライブラリ: タップで伴奏ごと開ける', info2.includes('accompaniment.wav'), info2);
    }

    // 選曲提案
    await page.click('#tabs button[data-mode="suggest"]');
    await page.setInputFiles('.index-file', `${outDir}/index.json`);
    await page.waitForFunction(() => document.querySelectorAll('.list').length === 3 && document.body.textContent.includes('そのまま曲'));
    const lists = await page.$$eval('.list', (ls) => ls.map((l) => l.textContent));
    if (scheme === 'light') {
      check('選曲: そのまま歌える', lists[0].includes('そのまま曲'), lists[0]);
      check('選曲: キー変更で歌える', lists[1].includes('高い曲') && lists[1].includes('キー -2'), lists[1]);
      check('選曲: 難しい', lists[2].includes('広すぎる曲'), lists[2]);
    }
    await page.screenshot({ path: `${outDir}/suggest-${scheme}.png`, fullPage: true });
    if (scheme === 'light') {
      // ライブラリにある曲は選曲から直接練習へ
      await page.click('.song-item.playable');
      await page.waitForSelector('.player:not([hidden]) .start:not([disabled])');
      const k = await page.$eval('.key-sel', (s) => s.value);
      check('選曲: タップで曲タブに移りおすすめキー(-5)で開く', k === '-5', `key=${k}`);
    }

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
