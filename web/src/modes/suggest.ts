// 選曲提案：音域測定の結果と、index.json・ライブラリの曲を照らし合わせる
import { goTo } from '../app';
import { listSongs } from '../lib/library';
import { midiToName } from '../lib/music';
import { parseIndex, type IndexEntry } from '../lib/song';
import { INDEX_KEY, SUGGEST_OPTS_KEY, load, loadRanges, loadSuggestOpts, save } from '../lib/storage';
import { combineRanges, suggest, type Fit, type Suggestion } from '../lib/suggest';
import { icons } from '../ui/icons';
import { RangeKeyboard, rangeBar } from '../ui/keyboard';
import { fmtRange } from './range';
import { esc, h, type Mode } from './mode';

const fmtKey = (f: Fit) => {
  const parts = [];
  if (f.octave) parts.push(`${f.octave > 0 ? '1オクターブ上' : '1オクターブ下'}`);
  if (f.key || !f.octave) parts.push(`キー ${f.key > 0 ? '+' : ''}${f.key}`);
  return parts.join(' ・ ');
};

export function createSuggestMode(): Mode {
  let indexSongs: IndexEntry[] = load<{ songs: IndexEntry[] }>(INDEX_KEY, { songs: [] }).songs;
  let libraryIds = new Set<string>();
  let songs: IndexEntry[] = [];
  const opts = loadSuggestOpts();

  const el = h('section', { class: 'mode' }, `
    <div class="mode-head"><h2>選曲</h2><p>測った音域で歌える曲と、おすすめのキーを出します。ライブラリの曲はタップでそのまま練習へ。</p></div>
    <div class="card my-range">
      <div class="my-range-head"><b>あなたの音域</b><button class="small ghost go-range">測りなおす</button></div>
      <div class="my-range-vals"></div>
      <div class="kb-slot"></div>
    </div>
    <div class="opts">
      <label class="switch"><input type="checkbox" class="opt-fal"><span></span>裏声の音域も使う</label>
      <label class="switch"><input type="checkbox" class="opt-oct"><span></span>1オクターブ上下にずらすのも可</label>
    </div>
    <div class="card index-card">
      <label class="file-btn">${icons.file}<span>index.json を選ぶ</span><input type="file" class="index-file" accept=".json,application/json"></label>
      <p class="index-info hint"></p>
    </div>
    <p class="warn msg"></p>
    <div class="lists"></div>`);

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const fal = $<HTMLInputElement>('.opt-fal');
  const oct = $<HTMLInputElement>('.opt-oct');
  fal.checked = opts.falsetto;
  oct.checked = opts.octave;
  const kb = new RangeKeyboard();
  $('.kb-slot').append(kb.el);
  $('.go-range').addEventListener('click', () => goTo('range'));

  const songLine = (s: Suggestion, extra: string, user: { min: number; max: number }) => {
    const inLib = libraryIds.has(s.song.id);
    const li = h('li');
    const item = h(inLib ? 'button' : 'div', { class: `song-item${inLib ? ' playable' : ''}` });
    const r = s.song.range!;
    const shift = s.best ? s.best.key + s.best.octave : 0;
    item.innerHTML = `
      <div class="si-main">
        <div class="song-title">${esc(s.song.title)}</div>
        <div class="muted small">${s.song.artist ? esc(s.song.artist) + ' ・ ' : ''}${midiToName(r.min)}〜${midiToName(r.max)}</div>
      </div>
      <div class="si-side"><div class="tag">${esc(extra)}</div>${inLib ? `<span class="play-hint">${icons.play}練習</span>` : ''}</div>`;
    item.querySelector('.si-main')!.append(rangeBar(user, r, shift));
    if (inLib) item.addEventListener('click', () => goTo('song', { id: s.song.id, key: s.best?.key ?? 0 }));
    li.append(item);
    return li;
  };

  const section = (title: string, items: HTMLElement[], cls: string) => {
    const wrap = h('div', { class: `list ${cls}` });
    const head = h('h3');
    head.innerHTML = `<span class="list-dot"></span>${esc(title)} <span class="muted">${items.length}曲</span>`;
    const ul = h('ul');
    if (!items.length) ul.append(h('li', { class: 'muted small none' }, 'なし'));
    else ul.append(...items);
    wrap.append(head, ul);
    return wrap;
  };

  const render = () => {
    const ranges = loadRanges();
    $('.my-range-vals').innerHTML = `<div><span class="dot chest"></span>地声 <b>${fmtRange(ranges.chest)}</b></div><div><span class="dot falsetto"></span>裏声 <b>${fmtRange(ranges.falsetto)}</b></div>`;
    kb.setRanges(ranges.chest, fal.checked ? ranges.falsetto : null);
    $('.index-info').textContent = indexSongs.length
      ? `index.json: ${indexSongs.length} 曲（この端末に保存）。ライブラリの曲も自動で含めます。`
      : 'ライブラリの曲は自動で対象になります。まだ入れていない曲も見たいときは songs/index.json を選びます。';
    const lists = $('.lists');
    lists.innerHTML = '';
    const msg = $('.msg');
    const user = combineRanges(ranges.chest, ranges.falsetto, fal.checked);
    if (!user) {
      msg.innerHTML = '';
      const b = h('button', { class: 'primary' }, `${icons.range}<span>先に音域を測る</span>`);
      b.addEventListener('click', () => goTo('range'));
      msg.append(b);
      return;
    }
    msg.textContent = '';
    if (!songs.length) {
      lists.append(h('p', { class: 'hint' }, '曲がまだありません。「曲」タブで曲を追加するか、index.json を選んでください。'));
      return;
    }
    const r = suggest(songs, user, oct.checked);
    lists.append(
      section('そのまま歌える', r.asIs.map((s) => songLine(s, '原曲キー', user)), 'ok'),
      section(
        'キーを変えれば歌える',
        r.shifted.map((s) => {
          const keys = s.fits.filter((f) => f.octave === s.best!.octave).map((f) => f.key);
          const span = keys.length > 1 ? `（${Math.min(...keys)}〜${Math.max(...keys)} で可）` : '';
          return songLine(s, `${fmtKey(s.best!)}${span}`, user);
        }),
        'shift',
      ),
      section('難しい（±6 では収まらない）', r.hard.map((s) => songLine(s, `あと ${s.shortBy} 半音`, user)), 'hard'),
    );
    if (r.unknown.length) {
      const p = h('p', { class: 'hint' });
      p.textContent = `音域が不明な曲: ${r.unknown.map((s) => s.title).join('、')}`;
      lists.append(p);
    }
  };

  /** index.json とライブラリを合わせる（同じ ID ならライブラリ側） */
  const refresh = async () => {
    const lib = await listSongs();
    libraryIds = new Set(lib.map((s) => s.id));
    const merged = new Map<string, IndexEntry>(indexSongs.map((s) => [s.id, s]));
    for (const s of lib) merged.set(s.id, { id: s.id, title: s.title, artist: s.artist, range: s.range, duration: s.duration });
    songs = [...merged.values()];
    render();
  };

  $<HTMLInputElement>('.index-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      indexSongs = parseIndex(await f.text());
      save(INDEX_KEY, { songs: indexSongs });
      await refresh();
    } catch (err) {
      $('.msg').textContent = `読み込めませんでした: ${(err as Error).message}`;
    }
  });
  for (const c of [fal, oct]) {
    c.addEventListener('change', () => {
      save(SUGGEST_OPTS_KEY, { falsetto: fal.checked, octave: oct.checked });
      render();
    });
  }
  render();
  void refresh();

  return {
    id: 'suggest',
    title: '選曲',
    icon: icons.sparkle,
    el,
    show() {
      indexSongs = load<{ songs: IndexEntry[] }>(INDEX_KEY, { songs: [] }).songs;
      void refresh();
    },
  };
}
