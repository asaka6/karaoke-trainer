// 選曲提案：音域測定の結果と index.json を照らし合わせる
import { midiToName } from '../lib/music';
import { parseIndex, type IndexEntry } from '../lib/song';
import { load, loadRanges, save } from '../lib/storage';
import { combineRanges, suggest, type Fit, type Suggestion } from '../lib/suggest';
import { fmtRange } from './range';
import { h, type Mode } from './mode';

const INDEX_KEY = 'karaoke-trainer.index.v1';
const OPTS_KEY = 'karaoke-trainer.suggest.v1';

const fmtKey = (f: Fit) => {
  const parts = [];
  if (f.octave) parts.push(`${f.octave > 0 ? '1オクターブ上' : '1オクターブ下'}`);
  if (f.key || !f.octave) parts.push(`キー ${f.key > 0 ? '+' : ''}${f.key}`);
  return parts.join(' ・ ');
};

export function createSuggestMode(): Mode {
  let songs: IndexEntry[] = load<{ songs: IndexEntry[] }>(INDEX_KEY, { songs: [] }).songs;
  const opts = load(OPTS_KEY, { falsetto: true, octave: false });

  const el = h('section', { class: 'mode' }, `
    <div class="card">
      <label class="file-btn">📂 index.json を選ぶ<input type="file" class="index-file" accept=".json,application/json"></label>
      <p class="index-info hint" style="margin:6px 0 0"></p>
    </div>
    <div class="card my-range"></div>
    <div class="opts">
      <label><input type="checkbox" class="opt-fal"> 裏声の音域も使う</label>
      <label><input type="checkbox" class="opt-oct"> 1オクターブ上下にずらすのも可</label>
    </div>
    <p class="warn msg"></p>
    <div class="lists"></div>`);

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const fal = $<HTMLInputElement>('.opt-fal');
  const oct = $<HTMLInputElement>('.opt-oct');
  fal.checked = opts.falsetto;
  oct.checked = opts.octave;

  const songLine = (s: Suggestion, extra: string) => {
    const li = h('li', { class: 'song-item' });
    const r = s.song.range!;
    const title = h('div', { class: 'song-title' });
    title.textContent = s.song.title;
    const sub = h('div', { class: 'muted small' });
    sub.textContent = `${s.song.artist ? s.song.artist + ' ・ ' : ''}${midiToName(r.min)}〜${midiToName(r.max)}`;
    const tag = h('div', { class: 'tag' });
    tag.textContent = extra;
    const left = h('div');
    left.append(title, sub);
    li.append(left, tag);
    return li;
  };

  const section = (title: string, items: HTMLElement[], cls: string) => {
    const wrap = h('div', { class: `list ${cls}` });
    const head = h('h3');
    head.textContent = `${title}（${items.length}曲）`;
    const ul = h('ul');
    if (!items.length) ul.append(h('li', { class: 'muted' }, 'なし'));
    else ul.append(...items);
    wrap.append(head, ul);
    return wrap;
  };

  const render = () => {
    const ranges = loadRanges();
    $('.my-range').innerHTML = `<div><b>自分の音域</b></div><div>地声 ${fmtRange(ranges.chest)}</div><div>裏声 ${fmtRange(ranges.falsetto)}</div>`;
    $('.index-info').textContent = songs.length ? `${songs.length} 曲を読み込み済み（この端末に保存）` : 'パイプラインが出力した songs/index.json を選んでください。';
    const lists = $('.lists');
    lists.innerHTML = '';
    const msg = $('.msg');
    const user = combineRanges(ranges.chest, ranges.falsetto, fal.checked);
    if (!user) {
      msg.textContent = '先に「音域」タブで音域を測ってください。';
      return;
    }
    msg.textContent = '';
    if (!songs.length) return;
    const r = suggest(songs, user, oct.checked);
    lists.append(
      section('そのまま歌える', r.asIs.map((s) => songLine(s, '原曲キー')), 'ok'),
      section(
        'キーを変えれば歌える',
        r.shifted.map((s) => {
          const keys = s.fits.filter((f) => f.octave === s.best!.octave).map((f) => f.key);
          const span = keys.length > 1 ? `（${Math.min(...keys)}〜${Math.max(...keys)} で可）` : '';
          return songLine(s, `${fmtKey(s.best!)}${span}`);
        }),
        'shift',
      ),
      section('難しい（±6 では収まらない）', r.hard.map((s) => songLine(s, `あと ${s.shortBy} 半音`)), 'hard'),
    );
    if (r.unknown.length) {
      const p = h('p', { class: 'hint' });
      p.textContent = `音域が不明な曲: ${r.unknown.map((s) => s.title).join('、')}`;
      lists.append(p);
    }
  };

  $<HTMLInputElement>('.index-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      songs = parseIndex(await f.text());
      save(INDEX_KEY, { songs });
      render();
    } catch (err) {
      $('.msg').textContent = `読み込めませんでした: ${(err as Error).message}`;
    }
  });
  for (const c of [fal, oct]) {
    c.addEventListener('change', () => {
      save(OPTS_KEY, { falsetto: fal.checked, octave: oct.checked });
      render();
    });
  }
  render();

  return { id: 'suggest', title: '選曲', el, show: render };
}
