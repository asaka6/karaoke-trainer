// 曲で練習：ライブラリから曲を選び、伴奏を流しながらガイドメロディと自分のピッチを重ねて表示し、歌い終わったら採点する
import { engine } from '../audio/engine';
import { KeyCache, scheduleGuide } from '../audio/player';
import { bestScore, deleteSong, getSong, importFiles, listSongs, putSong, type LibrarySong } from '../lib/library';
import { midiToName, octaveFoldedCents } from '../lib/music';
import { scoreSong, type ProblemSection, type ScoreResult } from '../lib/scoring';
import { parseIndex, parseSong, shiftNotes, type SongData, type SongNote } from '../lib/song';
import { INDEX_KEY, load, loadRanges, loadSuggestOpts, save } from '../lib/storage';
import { combineRanges, recommendFit } from '../lib/suggest';
import type { PitchPoint } from '../lib/tracker';
import { PitchGraph } from '../ui/graph';
import { icons } from '../ui/icons';
import { rangeBar } from '../ui/keyboard';
import { noteHtml } from '../ui/readout';
import { Timeline } from '../ui/timeline';
import { toast } from '../ui/toast';
import { esc, h, stageHtml, type Mode } from './mode';

const SETTINGS_KEY = 'karaoke-trainer.song.v1';
interface Settings {
  latencyMs: number | null; // null = 自動
  volume: number;
  guide: boolean;
}

export const fmtTime = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60);
  return `${m}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
};

const KIND_LABEL: Record<ProblemSection['kind'], string> = {
  sharp: '高め',
  flat: '低め',
  unstable: '不安定',
  silent: '声が出ていない',
};

const fmtKey = (k: number) => (k === 0 ? '原曲キー' : `キー ${k > 0 ? '+' : ''}${k}`);

/** 採点を残すのに必要な最低限の音符数（数秒だけ試しに歌ったものは記録しない） */
const MIN_NOTES_TO_RECORD = 5;

export interface OpenSong {
  id: string;
  key?: number;
}

export function createSongMode(): Mode {
  let settings = load<Settings>(SETTINGS_KEY, { latencyMs: null, volume: 0.8, guide: false });
  let song: SongData | null = null;
  let entry: LibrarySong | null = null;
  let keyCache: KeyCache | null = null;
  let key = 0;
  let notes: SongNote[] = [];
  let cursor = 0; // 開始位置・見返し位置

  // 再生中の状態
  let playing = false;
  let starting = false;
  let startAt = 0; // 曲の offset 秒が鳴る AudioContext 時刻
  let offset = 0;
  let latency = 0;
  let source: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let stopGuide: (() => void) | null = null;
  let track: PitchPoint[] = [];
  let result: ScoreResult | null = null;

  const el = h('section', { class: 'mode song-mode' }, `
    <div class="library">
      <div class="mode-head"><h2>曲で練習</h2><p>一度入れた曲はこの端末に保存され、次からタップで開けます。</p></div>
      <div class="import card">
        <div class="import-btns">
          <label class="file-btn primary">${icons.file}<span>ファイルを選ぶ</span><input type="file" class="files" multiple accept=".json,application/json,audio/*,.mp3,.m4a,.wav"></label>
          <label class="file-btn">${icons.folder}<span>フォルダごと追加</span><input type="file" class="folder" webkitdirectory multiple></label>
        </div>
        <p class="hint">パイプラインの <code>曲ID.json</code> と <code>accompaniment.mp3</code> を一緒に選ぶか、<code>songs</code> フォルダをまるごと選びます。PC ならここへドラッグ&ドロップも可。</p>
      </div>
      <div class="lib-list"></div>
    </div>

    <div class="player" hidden>
      <div class="player-head">
        <button class="icon-btn back" aria-label="ライブラリに戻る">${icons.back}</button>
        <div class="song-info"></div>
      </div>
      <div class="now-row">
        <div class="now-cell"><span>いま</span><b class="cur-note">--</b></div>
        <div class="now-cell"><span>ガイド</span><b class="guide-note">--</b></div>
        <div class="dev" data-ok="">--</div>
      </div>
      ${stageHtml('graph song-graph', '<div class="countdown" hidden></div>')}
      <div class="tl-slot"></div>
      <div class="transport">
        <div class="key-ctl">
          <button class="icon-btn key-step" data-step="-1" aria-label="キーを下げる">${icons.minus}</button>
          <label class="key-box"><span>キー</span><select class="key-sel"></select></label>
          <button class="icon-btn key-step" data-step="1" aria-label="キーを上げる">${icons.plus}</button>
        </div>
        <button class="primary start round" disabled aria-label="開始">${icons.play}</button>
        <button class="chip guide-btn" aria-pressed="false">${icons.guide}<span>ガイド</span></button>
      </div>
      <button class="chip rec-key" hidden></button>
      <div class="busy" hidden><span class="busy-txt"></span><div class="progress"><div class="progress-bar"></div></div></div>
      <details class="settings">
        <summary>${icons.settings}<span>音量・遅延の設定</span></summary>
        <label>伴奏の音量 <input type="range" class="vol" min="0" max="1" step="0.05"></label>
        <label>遅延補正 <input type="range" class="lat" min="0" max="500" step="10"> <span class="lat-val"></span></label>
        <button class="small ghost lat-auto">遅延を自動に戻す</button>
        <p class="hint">自分の線がガイドより毎回遅れて見えるときは遅延補正を大きくします（Bluetooth イヤホンは 150〜300ms 程度）。Space キーで開始／停止。</p>
      </details>

      <div class="result" hidden>
        <div class="score-hero card">
          <div class="ring"><svg viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fg" cx="60" cy="60" r="52" pathLength="100"/></svg>
            <div class="ring-txt"><b class="r-total">--</b><span>点</span></div></div>
          <div class="hero-side">
            <div class="best-badge" hidden>${icons.trophy}<span>自己ベスト更新！</span></div>
            <div class="r-history muted"></div>
            <button class="primary again">${icons.retry}<span>もう一度</span></button>
          </div>
        </div>
        <div class="score-grid">
          <div><span>音程正確率</span><b class="r-pitch"></b></div>
          <div><span>安定性</span><b class="r-stab"></b></div>
          <div><span>抑揚</span><b class="r-expr"></b></div>
          <div><span>ビブラート</span><b class="r-vib"></b></div>
          <div><span>しゃくり</span><b class="r-shak"></b></div>
        </div>
        <h3>ズレた区間 <span class="muted small">タップで表示 / ▶ でそこから練習</span></h3>
        <ul class="sections"></ul>
        <p class="hint">ガイドの色: 緑 = 合っていた / 黄 = 半分くらい / 赤 = ズレていた。下の帯をドラッグして全体を見返せます。</p>
      </div>
    </div>`);

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const library = $('.library');
  const player = $('.player');
  const graph = new PitchGraph($('canvas'), { windowSec: 8, nowFrac: 0.35, span: 20 });
  graph.autoCenter = false;
  graph.matchGuide = true;
  const timeline = new Timeline();
  $('.tl-slot').append(timeline.el);
  const keySel = $<HTMLSelectElement>('.key-sel');
  keySel.innerHTML = Array.from({ length: 13 }, (_, i) => i - 6)
    .map((k) => `<option value="${k}"${k === 0 ? ' selected' : ''}>${k > 0 ? '+' : ''}${k}${k === 0 ? '（原曲）' : ''}</option>`)
    .join('');
  const startBtn = $<HTMLButtonElement>('.start');
  const busy = $('.busy');
  const vol = $<HTMLInputElement>('.vol');
  const lat = $<HTMLInputElement>('.lat');
  const guideBtn = $('.guide-btn');
  const recKey = $<HTMLButtonElement>('.rec-key');
  const countdown = $('.countdown');

  const setBusy = (text: string | null, progress?: number) => {
    busy.hidden = text === null;
    if (text === null) return;
    $('.busy-txt').textContent = text;
    $('.busy .progress').hidden = progress === undefined;
    $('.busy .progress-bar').style.width = `${(progress ?? 0) * 100}%`;
  };

  // ---------------- 設定 ----------------
  const autoLatencyMs = () => Math.round((engine.outputLatency() + 0.02) * 1000);
  const renderSettings = () => {
    vol.value = String(settings.volume);
    guideBtn.classList.toggle('on', settings.guide);
    guideBtn.setAttribute('aria-pressed', String(settings.guide));
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
  guideBtn.addEventListener('click', () => {
    settings.guide = !settings.guide;
    saveSettings();
    if (playing) toast(`ガイド音${settings.guide ? 'オン' : 'オフ'}は次の開始から反映されます`);
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

  // ---------------- おすすめキー ----------------
  const userRange = () => {
    const r = loadRanges();
    return combineRanges(r.chest, r.falsetto, loadSuggestOpts().falsetto);
  };
  const recommend = (range: SongData['range']) => recommendFit(range, userRange(), loadSuggestOpts().octave);

  // ---------------- ライブラリ ----------------
  const renderLibrary = async () => {
    const list = $('.lib-list');
    const songs = await listSongs();
    list.innerHTML = '';
    if (!songs.length) {
      list.append(h('div', { class: 'empty' }, `${icons.music}<p>まだ曲がありません</p><p class="hint">上のボタンから曲データを追加してください。</p>`));
      return;
    }
    const user = userRange();
    const head = h('div', { class: 'list-head' }, `<h3>ライブラリ <span class="muted">${songs.length}曲</span></h3>`);
    const ul = h('ul', { class: 'lib-items' });
    for (const s of songs) {
      const fit = recommend(s.range);
      const best = bestScore(s);
      const li = h('li', { class: 'lib-item' });
      const btn = h('button', { class: 'lib-open' }, `
        <div class="lib-main">
          <div class="song-title">${esc(s.title)}</div>
          <div class="muted small">${esc(s.artist || '—')}${s.range ? ` ・ ${midiToName(s.range.min)}〜${midiToName(s.range.max)}` : ''}${s.duration ? ` ・ ${fmtTime(s.duration)}` : ''}${s.audio ? '' : ' ・ 伴奏なし'}</div>
        </div>
        <div class="lib-side">
          ${best !== null ? `<span class="best">${best}<small>点</small></span>` : ''}
          ${fit ? `<span class="pill ${fit.key === 0 && !fit.octave ? 'ok' : 'shift'}">${fit.key === 0 && !fit.octave ? 'そのまま' : fmtKey(fit.key)}${fit.octave ? (fit.octave > 0 ? '・1oct上' : '・1oct下') : ''}</span>` : ''}
        </div>`);
      if (s.range) btn.querySelector('.lib-main')!.append(rangeBar(user, s.range, fit ? fit.key + fit.octave : 0));
      btn.addEventListener('click', () => openSong({ id: s.id }));
      const del = h('button', { class: 'icon-btn del', 'aria-label': `${s.title} を削除` }, icons.trash);
      del.addEventListener('click', async () => {
        if (!confirm(`「${s.title}」をライブラリから削除しますか？（記録も消えます）`)) return;
        await deleteSong(s.id);
        renderLibrary();
      });
      li.append(btn, del);
      ul.append(li);
    }
    list.append(head, ul);
  };

  const showView = (v: 'library' | 'player') => {
    library.hidden = v !== 'library';
    player.hidden = v !== 'player';
    if (v === 'library') void renderLibrary();
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy('読み込み中…');
    const r = await importFiles(files);
    setBusy(null);
    if (r.index) {
      try {
        save(INDEX_KEY, { songs: parseIndex(r.index) });
      } catch (e) {
        toast(`index.json: ${(e as Error).message}`, 'error');
      }
    }
    r.errors.forEach((e) => toast(`読み込めませんでした: ${e}`, 'error'));
    if (r.songs.length === 1) {
      await openSong({ id: r.songs[0].id });
    } else if (r.songs.length) {
      toast(`${r.songs.length} 曲をライブラリに追加しました`, 'success');
      showView('library');
    }
  };
  for (const cls of ['.files', '.folder']) {
    $<HTMLInputElement>(cls).addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      await handleFiles([...(input.files ?? [])]);
      input.value = '';
    });
  }
  // ドラッグ&ドロップ（PC）
  library.addEventListener('dragover', (e) => {
    e.preventDefault();
    library.classList.add('drop');
  });
  library.addEventListener('dragleave', () => library.classList.remove('drop'));
  library.addEventListener('drop', (e) => {
    e.preventDefault();
    library.classList.remove('drop');
    void handleFiles([...(e.dataTransfer?.files ?? [])]);
  });

  // ---------------- 曲を開く ----------------
  const duration = () => keyCache?.original.duration ?? song?.duration ?? (song?.notes.at(-1)?.end ?? 0) + 2;

  async function openSong(p: OpenSong) {
    if (playing) stop();
    const e = await getSong(p.id);
    if (!e) {
      toast('ライブラリに見つかりませんでした。曲タブで追加してください。', 'error');
      return;
    }
    entry = e;
    song = parseSong(e.json);
    keyCache = null;
    clearResult();
    showView('player');
    startBtn.disabled = true;
    const fit = recommend(song.range);
    setKey(p.key ?? e.lastKey ?? fit?.key ?? 0);
    cursor = 0;
    graph.clear();
    timeline.notes = song.notes;
    timeline.duration = duration();
    timeline.sung = null;
    timeline.problems = [];
    renderInfo();
    if (e.audio) {
      try {
        setBusy('伴奏を読み込み中…');
        const ctx = await engine.ensureContext();
        const buf = await ctx.decodeAudioData(await e.audio.arrayBuffer());
        if (entry !== e) return; // 読み込み中に別の曲が開かれた
        keyCache = new KeyCache(ctx, buf);
        timeline.duration = duration();
        renderInfo();
        setBusy(null);
      } catch (err) {
        setBusy(`伴奏を読み込めませんでした: ${(err as Error).message}`);
      }
    }
    startBtn.disabled = false;
    timeline.invalidate();
    e.playedAt = Date.now();
    void putSong(e);
  }

  $('.back').addEventListener('click', () => {
    if (playing) stop();
    showView('library');
  });

  // ---------------- キー ----------------
  const setKey = (k: number) => {
    key = Math.max(-6, Math.min(6, k));
    keySel.value = String(key);
    notes = song ? shiftNotes(song.notes, key) : [];
    graph.guide = notes.map((n) => ({ ...n }));
    if (song?.range) {
      const lo = song.range.min + key;
      const hi = song.range.max + key;
      graph.center = (lo + hi) / 2;
      graph.opts.span = Math.max(14, hi - lo + 6);
    }
    const fit = song ? recommend(song.range) : null;
    recKey.hidden = !fit || fit.key === key;
    if (fit) recKey.innerHTML = `${icons.sparkle}<span>あなたの音域なら <b>${fmtKey(fit.key)}</b>${fit.octave ? `（1オクターブ${fit.octave > 0 ? '上' : '下'}で）` : ''} がおすすめ</span>`;
    renderInfo();
  };
  const changeKey = (k: number) => {
    if (playing) return;
    setKey(k);
    if (result) clearResult();
  };
  keySel.addEventListener('change', () => changeKey(parseInt(keySel.value, 10)));
  el.querySelectorAll<HTMLButtonElement>('.key-step').forEach((b) => b.addEventListener('click', () => changeKey(key + parseInt(b.dataset.step!, 10))));
  recKey.addEventListener('click', () => {
    const fit = song && recommend(song.range);
    if (fit) changeKey(fit.key);
  });

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
    const d = h('div', { class: 'muted small' });
    d.textContent = `音域 ${rangeText} ・ ${fmtTime(duration())} ・ 伴奏: ${entry?.audioName || 'なし'}`;
    info.append(t, d);
  };

  // ---------------- 位置（開始位置・見返し） ----------------
  const setCursor = (t: number) => {
    cursor = Math.max(0, Math.min(Math.max(0, duration() - 1), t));
    timeline.setPosition(cursor);
  };
  timeline.onSeek = (t) => {
    if (!playing) setCursor(t);
  };

  // ---------------- 再生 ----------------
  const start = async () => {
    if (!song || starting) return;
    starting = true;
    startBtn.disabled = true;
    try {
      const ctx = await engine.ensureContext();
      if (!engine.running) await engine.start();
      let buffer: AudioBuffer | null = null;
      if (keyCache) {
        if (key) setBusy('キー変更の処理中…', 0);
        buffer = await keyCache.get(key, (p) => setBusy(`キー変更の処理中… ${Math.round(p * 100)}%`, p));
        setBusy(null);
      }
      clearResult();
      offset = cursor >= duration() - 1.5 ? 0 : cursor;
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
      timeline.enabled = false;
      timeline.sung = null;
      timeline.problems = [];
      startBtn.innerHTML = icons.stop;
      startBtn.setAttribute('aria-label', '停止');
      startBtn.classList.add('live');
      el.classList.add('playing');
      if (entry) {
        entry.lastKey = key;
        entry.playedAt = Date.now();
        void putSong(entry);
      }
    } catch (err) {
      setBusy(`開始できませんでした: ${(err as Error).message}`);
    } finally {
      starting = false;
      startBtn.disabled = false;
    }
  };

  const songNow = () => (engine.ctx ? offset + (engine.ctx.currentTime - startAt) - latency : 0);

  const stop = () => {
    if (!playing) return;
    playing = false;
    const end = Math.max(offset, Math.min(duration(), songNow()));
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
    gainNode = null;
    startBtn.innerHTML = icons.play;
    startBtn.setAttribute('aria-label', '開始');
    startBtn.classList.remove('live');
    el.classList.remove('playing');
    countdown.hidden = true;
    timeline.enabled = true;
    showResult(scoreSong(notes, track, { start: offset, end }), offset, end);
  };

  const toggle = () => (playing ? stop() : start());
  startBtn.addEventListener('click', toggle);
  $('.again').addEventListener('click', () => {
    setCursor(timeline.sung?.start ?? 0);
    void start();
  });

  // ---------------- 結果 ----------------
  const clearResult = () => {
    result = null;
    $('.result').hidden = true;
    graph.guide = notes.map((n) => ({ ...n }));
  };

  const showResult = (r: ScoreResult, from: number, to: number) => {
    result = r;
    $('.result').hidden = false;
    $('.r-total').textContent = String(r.total);
    $<HTMLElement>('.ring-fg').style.strokeDashoffset = String(100 - r.total);
    $('.score-hero').dataset.grade = r.total >= 85 ? 'a' : r.total >= 65 ? 'b' : 'c';
    $('.r-pitch').textContent = `${r.pitch}%`;
    $('.r-stab').textContent = r.stability === null ? '-' : `${r.stability}`;
    $('.r-expr').textContent = r.expression === null ? '-' : `${r.expression}`;
    $('.r-vib').textContent = r.vibrato.count ? `${r.vibrato.count}回 / ${r.vibrato.seconds.toFixed(1)}秒` : '0回';
    $('.r-shak').textContent = `${r.shakuri.count}回`;
    const byIndex = new Map(r.notes.map((n) => [n.index, n.accuracy]));
    graph.guide = notes.map((n, i) => ({ ...n, score: byIndex.get(i) }));
    graph.points = track; // 全体を見返せるようにする

    // 記録
    const badge = $('.best-badge');
    badge.hidden = true;
    const hist = $('.r-history');
    hist.textContent = `${fmtKey(key)} ・ ${fmtTime(from)}〜${fmtTime(to)}`;
    if (entry && r.notes.length >= MIN_NOTES_TO_RECORD) {
      const prevBest = bestScore(entry);
      entry.scores = [...entry.scores, { at: Date.now(), key, total: r.total, pitch: r.pitch, from, to }].slice(-50);
      void putSong(entry);
      if (prevBest !== null && r.total > prevBest) badge.hidden = false;
      hist.textContent += ` ・ ${entry.scores.length}回目 ・ ベスト ${Math.max(prevBest ?? 0, r.total)}点`;
    }

    const ul = $('.sections');
    ul.innerHTML = '';
    if (!r.sections.length) ul.append(h('li', { class: 'muted' }, r.notes.length ? '大きくズレた区間はありません 🎉' : '採点できる音符がありませんでした'));
    for (const s of r.sections) {
      const li = h('li', { class: 'section' });
      li.dataset.kind = s.kind;
      const b = h('button', { class: 'section-btn' });
      const cents = s.meanCents === null ? '' : ` 平均 ${s.meanCents > 0 ? '+' : ''}${Math.round(s.meanCents)}¢`;
      b.innerHTML = `<span class="sec-time">${fmtTime(s.start)}〜${fmtTime(s.end)}</span><span class="sec-kind">${KIND_LABEL[s.kind]}</span><span class="sec-detail muted">正確率 ${Math.round(s.accuracy * 100)}%${cents}</span>`;
      b.addEventListener('click', () => {
        setCursor(s.start - 1);
        $('.stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const retry = h('button', { class: 'icon-btn retry', 'aria-label': 'ここから練習' }, icons.play);
      retry.addEventListener('click', () => {
        setCursor(s.start - 2);
        $('.stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
        void start();
      });
      li.append(b, retry);
      ul.append(li);
    }
    timeline.sung = { start: from, end: to };
    timeline.problems = r.sections;
    setCursor(r.sections[0] ? r.sections[0].start - 1 : from);
    timeline.invalidate();
  };

  /** 現在の時刻に鳴っているガイドの音符 */
  const guideAt = (t: number) => notes.find((n) => t >= n.start && t < n.end);

  /** 次の歌い出しまでのカウントダウン（前の音から 2.5 秒以上空いているときだけ） */
  const updateCountdown = (t: number) => {
    const next = notes.find((n) => n.start > t);
    const prevEnd = notes.filter((n) => n.end <= t).at(-1)?.end ?? -Infinity;
    const remain = next ? next.start - t : Infinity;
    const show = next && remain <= 3 && next.start - Math.max(prevEnd, offset) >= 2.5 && !guideAt(t);
    countdown.hidden = !show;
    if (show) {
      const n = String(Math.ceil(remain));
      if (countdown.textContent !== n) {
        countdown.textContent = n;
        countdown.classList.remove('pop');
        void countdown.offsetWidth;
        countdown.classList.add('pop');
      }
    }
  };

  void renderLibrary();

  return {
    id: 'song',
    title: '曲',
    icon: icons.music,
    el,
    onPitch(p) {
      if (!playing) return;
      const t = offset + (p.t - startAt) - latency;
      if (t < offset) return;
      const q = { ...p, t };
      track.push(q);
      graph.push(q);
      const cur = $('.cur-note');
      const g = guideAt(t);
      cur.innerHTML = p.midi === null ? '--' : noteHtml(p.midi);
      $('.guide-note').innerHTML = g ? noteHtml(g.midi) : '--';
      const dev = $('.dev');
      if (g && p.midi !== null) {
        const c = Math.round(octaveFoldedCents(p.midi, g.midi));
        dev.textContent = `${c > 0 ? '+' : ''}${c}¢`;
        dev.dataset.ok = String(Math.abs(c) <= 50);
      } else {
        dev.textContent = '--';
        dev.dataset.ok = '';
      }
    },
    frame() {
      if (player.hidden) return;
      graph.live = playing || !result;
      if (playing) {
        const t = songNow();
        graph.render(t);
        timeline.setPosition(Math.max(offset, t));
        updateCountdown(t);
      } else {
        graph.render(cursor);
      }
      timeline.render(fmtTime);
    },
    show() {
      if (!library.hidden) void renderLibrary();
      else if (song) setKey(key); // 音域が変わっていればおすすめを更新
    },
    hide() {
      if (playing) stop();
    },
    open(payload) {
      void openSong(payload as OpenSong);
    },
    onSpace() {
      if (player.hidden || startBtn.disabled) return false;
      void toggle();
      return true;
    },
  };
}
