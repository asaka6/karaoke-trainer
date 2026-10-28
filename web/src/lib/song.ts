// パイプライン（pipeline/）が出力する曲 JSON・index.json の型と読み込み

export interface SongNote {
  start: number;
  end: number;
  midi: number;
}

export interface SongData {
  title: string;
  artist: string;
  notes: SongNote[];
  range: { min: number; max: number } | null;
  duration?: number;
}

export interface IndexEntry {
  id: string;
  title: string;
  artist: string;
  range: { min: number; max: number } | null;
  duration?: number;
  noteCount?: number;
}

export function parseSong(text: string): SongData {
  const j = JSON.parse(text);
  if (!j || !Array.isArray(j.notes)) throw new Error('曲 JSON ではありません（notes がありません）');
  const notes: SongNote[] = j.notes
    .filter((n: SongNote) => Number.isFinite(n.start) && Number.isFinite(n.end) && Number.isFinite(n.midi) && n.end > n.start)
    .sort((a: SongNote, b: SongNote) => a.start - b.start);
  let range = j.range ?? null;
  if (!range && notes.length) {
    range = { min: Math.min(...notes.map((n) => n.midi)), max: Math.max(...notes.map((n) => n.midi)) };
  }
  return { title: String(j.title ?? '無題'), artist: String(j.artist ?? ''), notes, range, duration: j.duration };
}

export function parseIndex(text: string): IndexEntry[] {
  const j = JSON.parse(text);
  const songs = Array.isArray(j) ? j : j?.songs;
  if (!Array.isArray(songs)) throw new Error('index.json ではありません（songs がありません）');
  return songs.map((s: IndexEntry, i: number) => ({
    id: String(s.id ?? i),
    title: String(s.title ?? s.id ?? '無題'),
    artist: String(s.artist ?? ''),
    range: s.range ?? null,
    duration: s.duration,
    noteCount: s.noteCount,
  }));
}

export function shiftNotes(notes: SongNote[], semitones: number): SongNote[] {
  return semitones ? notes.map((n) => ({ ...n, midi: n.midi + semitones })) : notes;
}
