// 曲で練習：伴奏を流しながらガイドメロディと自分のピッチを重ねて表示し、歌い終わったら採点する
import { engine } from '../audio/engine';
import { KeyCache, scheduleGuide } from '../audio/player';
import { midiToName, octaveFoldedCents } from '../lib/music';
import { scoreSong, type ProblemSection, type ScoreResult } from '../lib/scoring';
import { parseSong, shiftNotes, type SongData, type SongNote } from '../lib/song';
import { load, save } from '../lib/storage';
import type { PitchPoint } from '../lib/tracker';
import { PitchGraph } from '../ui/graph';
import { h, type Mode } from './mode';

const SETTINGS_KEY = 'karaoke-trainer.song.v1';
interface Settings {
  latencyMs: number | null; // null = 自動
  volume: number;
  guide: boolean;
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const KIND_LABEL: Record<ProblemSection['kind'], string> = {
  sharp: '高め',
  flat: '低め',
  unstable: '不安定',
  silent: '声が出ていない',
};

export function createSongMode(): Mode {
  let settings = load<Settings>(SETTINGS_KEY, { latencyMs: null, volume: 0.8, guide: false });
  let song: SongData | null = null;
  let keyCache: KeyCache | null = null;
  let accompanimentName = '';
  let key = 0;
  let notes: SongNote[] = [];

  // 再生中の状態
  let playing = false;
  let startAt = 0; // 曲の offset 秒が鳴る AudioContext 時刻
  let offset = 0;
  let latency = 0;
  let source: AudioBufferSourceNode | null = null;
  let stopGuide: (() => void) | null = null;
  let track: PitchPoint[] = [];
  let result: ScoreResult | null = null;
  let reviewT: number | null = null;

  const el = h('section', { class: 'mode' }, `
    <div class="card">
      <label class="file-btn">📂 曲ファイルを選ぶ<input type="file" class="files" multiple accept=".json,application/json,audio/*,.mp3,.m4a,.wav"></label>
      <p class="hint" style="margin:6px 0 0">パイプラインが作った <code>曲ID.json</code> と <code>accompaniment.mp3</code> を一緒に選びます（伴奏なしでも可）。</p>
      <div class="song-info muted"></div>
    </div>
    <div class="controls">
      <label class="key">キー <select class="key-sel"></select></label>
      <button class="primary start" disabled>▶ 開始</button>
    </div>
    <label class="seek-row"><span class="seek-label">開始 0:00</span><input type="range" class="seek" min="0" max="0" step="0.5" value="0" disabled></label>
    <p class="busy muted" hidden></p>
    <div class="now-row"><span>いま <b class="cur-note">--</b></span><span>ガイド <b class="guide-note">--</b></span><span class="dev">&nbsp;</span></div>
    <canvas class="graph song-graph"></canvas>
    <details class="settings">
      <summary>再生の設定</summary>
      <label>伴奏の音量 <input type="range" class="vol" min="0" max="1" step="0.05"></label>
      <label><input type="checkbox" class="guide-chk"> ガイドメロディを鳴らす</label>
      <label>遅延補正 <input type="range" class="lat" min="0" max="500" step="10"> <span class="lat-val"></span></label>
      <button class="small lat-auto">自動に戻す</button>
      <p class="hint">自分の線がガイドより毎回遅れて見えるときは遅延補正を大きくします（Bluetooth イヤホンは 150〜300ms 程度）。</p>
    </details>
    <div class="result" hidden>
      <div class="total"><span class="muted">総合</span><b class="r-total">--</b></div>
      <div class="score-grid">
        <div><span class="muted">音程正確率</span><b class="r-pitch"></b></div>
        <div><span class="muted">安定性</span><b class="r-stab"></b></div>
        <div><span class="muted">抑揚</span><b class="r-expr"></b></div>
        <div><span class="muted">ビブラート</span><b class="r-vib"></b></div>
        <div><span class="muted">しゃくり</span><b class="r-shak"></b></div>
      </div>
      <h3>ズレた区間</h3>
      <ul class="sections"></ul>
      <label class="seek-row"><span class="review-label">見返す 0:00</span><input type="range" class="review" min="0" max="0" step="0.1" value="0"></label>
      <p class="hint">ガイドの色: 緑 = 合っていた / 黄 = 半分くらい / 赤 = ズレていた。区間をタップするとその場所を表示します。</p>
    </div>`);

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const graph = new PitchGraph($('canvas'), { windowSec: 8, nowFrac: 0.35, span: 20 });
  graph.autoCenter = false;
  const keySel = $<HTMLSelectElement>('.key-sel');
  keySel.innerHTML = Array.from({ length: 13 }, (_, i) => i - 6)
    .map((k) => `<option value="${k}"${k === 0 ? ' selected' : ''}>${k > 0 ? '+' : ''}${k}${k === 0 ? '（原曲）' : ''}</option>`)
    .join('');
  const startBtn = $<HTMLButtonElement>('.start');
  const seek = $<HTMLInputElement>('.seek');
  const busy = $('.busy');
  const vol = $<HTMLInputElement>('.vol');
  const lat = $<HTMLInputElement>('.lat');
  const guideChk = $<HTMLInputElement>('.guide-chk');
  const review = $<HTMLInputElement>('.review');

  const autoLatencyMs = () => Math.round((engine.outputLatency() + 0.02) * 1000);
  const renderSettings = () => {
    vol.value = String(settings.volume);
    guideChk.checked = settings.guide;
    const ms = settings.latencyMs ?? autoLatencyMs();
    lat.value = String(ms);
    $('.lat-val').textContent = `${ms}ms${settings.latencyMs === null ? '（自動）' : ''}`;
  };
  const saveSettings = () => {
    save(SETTINGS_KEY, settings);
    renderSettings();
  };
  vol.addEventListener('input', () => {
    settings.volume = parseFloat(vol.value);
    if (gainNode) gainNode.gain.value = settings.volume;
    saveSettings();
  });
  guideChk.addEventListener('change', () => {
    settings.guide = guideChk.checked;
    saveSettings();
  });
  lat.addEventListener('input', () => {
    settings.latencyMs = parseInt(lat.value, 10);
    saveSettings();
  });
  $('.lat-auto').addEventListener('click', () => {
    settings.latencyMs = null;
    saveSettings();
  });
  renderSettings();

  const applyKey = () => {
    key = parseInt(keySel.value, 10);
    notes = song ? shiftNotes(song.notes, key) : [];
    graph.guide = notes.map((n) => ({ ...n }));
    if (song?.range) {
      const lo = song.range.min + key;
      const hi = song.range.max + key;
      graph.center = (lo + hi) / 2;
      graph.opts.span = Math.max(14, hi - lo + 6);
    }
    renderInfo();
  };
  keySel.addEventListener('change', () => {
    applyKey();
    if (result) clearResult();
  });

  const duration = () => keyCache?.original.duration ?? song?.duration ?? (song?.notes.at(-1)?.end ?? 0) + 2;

  const renderInfo = () => {
    const info = $('.song-info');
    if (!song) {
      info.textContent = '';
      return;
    }
    const r = song.range;
    const rangeText = r ? `${midiToName(r.min + key)}〜${midiToName(r.max + key)}${key ? `（原曲 ${midiToName(r.min)}〜${midiToName(r.max)}）` : ''}` : '-';
    info.innerHTML = '';
    const t = h('div', { class: 'song-title' });
    t.textContent = `${song.title}${song.artist ? ' / ' + song.artist : ''}`;
    const d = h('div');
    d.textContent = `音域 ${rangeText} ・ ${fmtTime(duration())} ・ 伴奏: ${accompanimentName || 'なし'}`;
    info.append(t, d);
  };

  $<HTMLInputElement>('.files').addEventListener('change', async (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    const jsonFile = files.find((f) => f.name.toLowerCase().endsWith('.json'));
    const audioFile = files.find((f) => f !== jsonFile);
    busy.hidden = false;
    try {
      if (jsonFile) {
        song = parseSong(await jsonFile.text());
        clearResult();
        if (!audioFile) {
          keyCache = null;
          accompanimentName = '';
        }
      } else if (!song) {
        throw new Error('曲の JSON ファイルも選んでください');
      }
      if (audioFile) {
        busy.textContent = '伴奏を読み込み中…';
        const ctx = await engine.ensureContext();
        const buf = await ctx.decodeAudioData(await audioFile.arrayBuffer());
        keyCache = new KeyCache(ctx, buf);
        accompanimentName = audioFile.name;
      }
      seek.max = String(Math.max(0, duration() - 1));
      seek.value = '0';
      seek.disabled = false;
      startBtn.disabled = false;
      updateSeekLabel();
      applyKey();
      busy.hidden = true;
    } catch (err) {
      busy.textContent = `読み込めませんでした: ${(err as Error).message}`;
    }
  });

  const updateSeekLabel = () => {
    $('.seek-label').textContent = `開始 ${fmtTime(parseFloat(seek.value))}`;
  };
  seek.addEventListener('input', () => {
    updateSeekLabel();
    reviewT = null;
  });

  let gainNode: GainNode | null = null;

  const start = async () => {
    if (!song) return;
    startBtn.disabled = true;
    try {
      const ctx = await engine.ensureContext();
      if (!engine.running) await engine.start();
      let buffer: AudioBuffer | null = null;
      if (keyCache) {
        busy.hidden = false;
        busy.textContent = key ? 'キー変更の処理中… 0%' : '';
        buffer = await keyCache.get(key, (p) => (busy.textContent = `キー変更の処理中… ${Math.round(p * 100)}%`));
        busy.hidden = true;
      }
      clearResult();
      offset = parseFloat(seek.value);
      track = [];
      graph.clear();
      const testGuide = engine.testParam === 'guide';
      latency = testGuide ? 0 : (settings.latencyMs ?? autoLatencyMs()) / 1000;
      startAt = ctx.currentTime + 0.2;
      gainNode = ctx.createGain();
      gainNode.gain.value = settings.volume;
      gainNode.connect(ctx.destination);
      if (buffer) {
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);
        source.start(startAt, offset);
        source.onended = () => playing && stop();
      }
      if (settings.guide || testGuide) {
        const guideOut = testGuide ? engine.input! : gainNode;
        stopGuide = scheduleGuide(ctx, guideOut, notes, offset, startAt);
      }
      playing = true;
      startBtn.textContent = '■ 停止';
      startBtn.classList.add('live');
    } catch (err) {
      busy.hidden = false;
      busy.textContent = `開始できませんでした: ${(err as Error).message}`;
    } finally {
      startBtn.disabled = false;
    }
  };

  const songNow = () => (engine.ctx ? offset + (engine.ctx.currentTime - startAt) - latency : 0);

  const stop = () => {
    if (!playing) return;
    playing = false;
    const end = Math.max(offset, songNow());
    try {
      source?.stop();
    } catch {
      /* 再生終了済み */
    }
    source?.disconnect();
    stopGuide?.();
    gainNode?.disconnect();
    source = null;
    stopGuide = null;
    startBtn.textContent = '▶ 開始';
    startBtn.classList.remove('live');
    showResult(scoreSong(notes, track, { start: offset, end }), offset, end);
  };

  startBtn.addEventListener('click', () => (playing ? stop() : start()));

  const clearResult = () => {
    result = null;
    reviewT = null;
    $('.result').hidden = true;
    graph.guide = notes.map((n) => ({ ...n }));
  };

  const showResult = (r: ScoreResult, from: number, to: number) => {
    result = r;
    $('.result').hidden = false;
    $('.r-total').textContent = String(r.total);
    $('.r-pitch').textContent = `${r.pitch}`;
    $('.r-stab').textContent = r.stability === null ? '-' : `${r.stability}`;
    $('.r-expr').textContent = r.expression === null ? '-' : `${r.expression}`;
    $('.r-vib').textContent = r.vibrato.count ? `${r.vibrato.count}回 / ${r.vibrato.seconds.toFixed(1)}秒` : '0回';
    $('.r-shak').textContent = `${r.shakuri.count}回`;
    const byIndex = new Map(r.notes.map((n) => [n.index, n.accuracy]));
    graph.guide = notes.map((n, i) => ({ ...n, score: byIndex.get(i) }));
    graph.points = track; // 全体を見返せるようにする

    const ul = $('.sections');
    ul.innerHTML = '';
    if (!r.sections.length) ul.append(h('li', { class: 'muted' }, r.notes.length ? '大きくズレた区間はありません' : '採点できる音符がありませんでした'));
    for (const s of r.sections) {
      const b = h('button', { class: 'section-btn' });
      const cents = s.meanCents === null ? '' : `（平均 ${s.meanCents > 0 ? '+' : ''}${Math.round(s.meanCents)}¢）`;
      b.textContent = `${fmtTime(s.start)}〜${fmtTime(s.end)}  ${KIND_LABEL[s.kind]}${cents}  正確率 ${Math.round(s.accuracy * 100)}%`;
      b.dataset.kind = s.kind;
      b.addEventListener('click', () => setReview(s.start - 1));
      const li = h('li');
      li.append(b);
      ul.append(li);
    }
    review.min = String(from);
    review.max = String(Math.max(from, to));
    setReview(r.sections[0] ? r.sections[0].start - 1 : from);
  };

  const setReview = (t: number) => {
    const min = parseFloat(review.min);
    const max = parseFloat(review.max);
    reviewT = Math.max(min, Math.min(max, t));
    review.value = String(reviewT);
    $('.review-label').textContent = `見返す ${fmtTime(reviewT)}`;
  };
  review.addEventListener('input', () => setReview(parseFloat(review.value)));

  /** 現在の時刻に鳴っているガイドの音符 */
  const guideAt = (t: number) => notes.find((n) => t >= n.start && t < n.end);

  return {
    id: 'song',
    title: '曲',
    el,
    onPitch(p) {
      if (!playing) return;
      const t = offset + (p.t - startAt) - latency;
      if (t < offset) return;
      const q = { ...p, t };
      track.push(q);
      graph.push(q);
      $('.cur-note').textContent = p.midi === null ? '--' : midiToName(p.midi);
      const g = guideAt(t);
      $('.guide-note').textContent = g ? midiToName(g.midi) : '--';
      const dev = $('.dev');
      if (g && p.midi !== null) {
        const c = Math.round(octaveFoldedCents(p.midi, g.midi));
        dev.textContent = `${c > 0 ? '+' : ''}${c}¢`;
        dev.dataset.ok = String(Math.abs(c) <= 50);
      } else {
        dev.textContent = ' ';
      }
    },
    frame(now) {
      graph.live = playing || !result;
      if (playing) {
        graph.render(songNow());
      } else if (result && reviewT !== null) {
        // 見返し: 指定位置が左端に来るように表示
        graph.render(reviewT + graph.opts.windowSec * graph.opts.nowFrac);
      } else {
        graph.render(parseFloat(seek.value));
      }
      void now;
    },
    hide() {
      if (playing) stop();
    },
  };
}
