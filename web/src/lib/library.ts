// 曲ライブラリ：一度読み込んだ曲 JSON と伴奏をこの端末（IndexedDB）に保存し、次回からワンタップで開けるようにする。
// 曲データは著作物由来なのでサーバーには一切送らない（端末内だけ）。
import { parseSong, type SongData } from './song';

export interface ScoreRecord {
  at: number;
  key: number;
  total: number;
  pitch: number;
  /** 曲の何秒から何秒までを歌ったか */
  from: number;
  to: number;
}

export interface LibrarySong {
  id: string;
  title: string;
  artist: string;
  range: SongData['range'];
  duration?: number;
  /** 曲 JSON の中身（そのまま保存して開くときに parseSong する） */
  json: string;
  audio: Blob | null;
  audioName: string;
  addedAt: number;
  playedAt?: number;
  lastKey?: number;
  scores: ScoreRecord[];
}

const DB = 'karaoke-trainer';
const STORE = 'songs';

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** IndexedDB が使えない環境（プライベートモード等）では、ページを開いている間だけメモリに置く */
const memory = new Map<string, LibrarySong>();

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error('no db'));
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function persistent(): Promise<boolean> {
  return (await open()) !== null;
}

export async function listSongs(): Promise<LibrarySong[]> {
  let all: LibrarySong[];
  try {
    all = await run<LibrarySong[]>('readonly', (s) => s.getAll());
  } catch {
    all = [...memory.values()];
  }
  // 最近歌った曲・追加した曲が上
  return all.sort((a, b) => (b.playedAt ?? b.addedAt) - (a.playedAt ?? a.addedAt));
}

export async function getSong(id: string): Promise<LibrarySong | null> {
  try {
    return (await run<LibrarySong | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return memory.get(id) ?? null;
  }
}

export async function putSong(song: LibrarySong): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(song));
  } catch {
    memory.set(song.id, song);
  }
}

export async function deleteSong(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    memory.delete(id);
  }
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm)$/i;
const isJson = (f: File) => /\.json$/i.test(f.name);
const isAudio = (f: File) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/');
const dirOf = (f: File) => {
  const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
};
const stem = (name: string) => name.replace(/\.[^.]+$/, '');

export interface ImportResult {
  songs: LibrarySong[];
  /** 一緒に選ばれた index.json の中身 */
  index: string | null;
  errors: string[];
}

/**
 * 選ばれたファイル（またはフォルダ）から曲を取り込む。
 * パイプラインの出力 songs/<曲ID>/<曲ID>.json + accompaniment.mp3 を想定し、同じフォルダの音声を伴奏として組にする。
 * フォルダ情報が無い（ファイルを個別に選んだ）ときは、曲 JSON が1つなら選ばれた音声をその伴奏にする。
 */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const res: ImportResult = { songs: [], index: null, errors: [] };
  const jsons = files.filter(isJson);
  const audios = files.filter(isAudio);
  // 伴奏を優先（vocals.mp3 は確認用なので使わない）
  const pickAudio = (cands: File[]) =>
    cands.find((f) => /accompaniment|inst|karaoke|off ?vocal/i.test(f.name)) ?? cands.find((f) => !/vocals?\./i.test(f.name)) ?? null;

  const songJsons: File[] = [];
  for (const f of jsons) {
    if (f.name.toLowerCase() === 'index.json') res.index = await f.text();
    else songJsons.push(f);
  }
  const existing = new Map((await listSongs()).map((s) => [s.id, s]));
  for (const f of songJsons) {
    try {
      const text = await f.text();
      const song = parseSong(text);
      const dir = dirOf(f);
      const audio = dir ? pickAudio(audios.filter((a) => dirOf(a) === dir)) : songJsons.length === 1 ? pickAudio(audios) : null;
      const id = stem(f.name);
      const prev = existing.get(id);
      const entry: LibrarySong = {
        id,
        title: song.title,
        artist: song.artist,
        range: song.range,
        duration: song.duration,
        json: text,
        // 伴奏を選ばずに JSON だけ入れ直したときは、前に入れた伴奏を使い続ける
        audio: audio ?? prev?.audio ?? null,
        audioName: audio?.name ?? prev?.audioName ?? '',
        addedAt: prev?.addedAt ?? Date.now(),
        playedAt: prev?.playedAt,
        lastKey: prev?.lastKey,
        scores: prev?.scores ?? [],
      };
      await putSong(entry);
      res.songs.push(entry);
    } catch (e) {
      res.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  if (!songJsons.length && !res.index) res.errors.push('曲の JSON ファイルが見つかりませんでした');
  return res;
}

export function bestScore(s: LibrarySong): number | null {
  return s.scores.length ? Math.max(...s.scores.map((r) => r.total)) : null;
}
