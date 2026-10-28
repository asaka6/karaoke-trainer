"""コマンドライン: 音声ファイル（またはフォルダ）→ 伴奏 MP3 ＋ メロディ JSON ＋ index.json

  python -m karaoke_pipeline 曲.mp3                 # 1曲
  python -m karaoke_pipeline D:/music/karaoke/      # フォルダ内を一括（サブフォルダも）
  python -m karaoke_pipeline --index-only           # index.json だけ作り直す
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .audio_io import find_audio_files, load_audio, save_mp3
from .meta import guess_title_artist, slugify
from .notes import SegmentOptions, freq_to_midi, note_range, segment_notes

SEP_SR = 44100


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def process_file(path: Path, out_dir: Path, args: argparse.Namespace) -> Path:
    from . import f0 as f0mod

    title, artist = guess_title_artist(path)
    if args.title:
        title = args.title
    if args.artist:
        artist = args.artist
    song_id = slugify(path.stem)
    song_dir = out_dir / song_id
    json_path = song_dir / f"{song_id}.json"
    if json_path.exists() and not args.force:
        log(f"スキップ（処理済み。やり直すなら --force）: {path.name}")
        return json_path
    song_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    log(f"読み込み: {path.name}")
    audio = load_audio(path, SEP_SR, 2)
    duration = len(audio) / SEP_SR

    if args.no_separate:
        vocals = audio
        log("分離はスキップ（入力をボーカルとして扱う）")
    else:
        from .separate import pick_device, separate

        device = pick_device(args.device)
        log(f"Demucs({args.model}) で分離中… device={device}（CPU だと曲の長さの0.5〜2倍程度かかります）")
        vocals, accomp = separate(audio, SEP_SR, args.model, device)
        save_mp3(song_dir / "accompaniment.mp3", accomp, SEP_SR)
        if not args.no_vocals:
            save_mp3(song_dir / "vocals.mp3", vocals, SEP_SR)
        log(f"分離完了 ({time.time() - t0:.0f}s)")

    # F0 抽出（16kHz モノラル）
    import librosa

    mono = librosa.resample(vocals.mean(axis=1), orig_sr=SEP_SR, target_sr=f0mod.SR)
    method = args.f0 if args.f0 != "auto" else f0mod.available_method()
    device = "cpu"
    if method == "crepe":
        from .separate import pick_device

        device = pick_device(args.device)
        if device == "mps":
            device = "cpu"  # torchcrepe は MPS で不安定なことがある
    crepe_model = args.crepe_model or ("full" if device == "cuda" else "tiny")
    log(f"F0 抽出中… method={method}{f' model={crepe_model}' if method == 'crepe' else ''}")
    t1 = time.time()
    hz = f0mod.extract_f0(mono, method, device=device, crepe_model=crepe_model)
    log(f"F0 抽出完了 ({time.time() - t1:.0f}s, 有声 {np.isfinite(hz).mean() * 100:.0f}%)")

    notes = segment_notes(freq_to_midi(hz), f0mod.HOP / f0mod.SR, SegmentOptions(min_note=args.min_note))
    rng = note_range(notes)
    song = {
        "title": title,
        "artist": artist,
        "notes": [n.to_dict() for n in notes],
        "range": rng,
        "duration": round(duration, 3),
        "accompaniment": None if args.no_separate else "accompaniment.mp3",
        "source": path.name,
        "f0_method": method,
    }
    json_path.write_text(json.dumps(song, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"保存: {json_path}  音符 {len(notes)} 個, 音域 {fmt_range(rng)}  (計 {time.time() - t0:.0f}s)")
    return json_path


def fmt_range(r: dict | None) -> str:
    if not r:
        return "-"
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    f = lambda m: f"{names[m % 12]}{m // 12 - 1}"  # noqa: E731
    return f"{f(r['min'])}〜{f(r['max'])}"


def build_index(out_dir: Path) -> Path:
    """出力フォルダ内の全曲 JSON から index.json を作る（過去に処理した曲も含む）"""
    songs = []
    for jp in sorted(out_dir.glob("*/*.json")):
        if jp.parent.name != jp.stem:
            continue
        try:
            s = json.loads(jp.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        songs.append(
            {
                "id": jp.stem,
                "title": s.get("title"),
                "artist": s.get("artist"),
                "range": s.get("range"),
                "duration": s.get("duration"),
                "noteCount": len(s.get("notes", [])),
                "json": f"{jp.parent.name}/{jp.name}",
                "accompaniment": f"{jp.parent.name}/{s['accompaniment']}" if s.get("accompaniment") else None,
            }
        )
    index = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "songs": songs}
    p = out_dir / "index.json"
    p.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"index.json を更新: {len(songs)} 曲 → {p}")
    return p


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="karaoke_pipeline", description="カラオケ練習用の曲データを作る")
    ap.add_argument("inputs", nargs="*", type=Path, help="音声ファイル（mp3/wav/m4a…）またはフォルダ")
    ap.add_argument("-o", "--out", type=Path, default=Path("songs"), help="出力フォルダ（既定: ./songs）")
    ap.add_argument("--f0", choices=["auto", "crepe", "pyin"], default="auto", help="F0 抽出法（既定: torchcrepe があれば crepe）")
    ap.add_argument("--crepe-model", choices=["tiny", "full"], help="既定: GPU なら full, CPU なら tiny")
    ap.add_argument("--device", default="auto", help="auto / cpu / cuda / mps")
    ap.add_argument("--model", default="htdemucs", help="Demucs モデル名（htdemucs, htdemucs_ft など）")
    ap.add_argument("--no-separate", action="store_true", help="分離しない（入力がボーカルのみの場合）")
    ap.add_argument("--no-vocals", action="store_true", help="分離したボーカルの MP3 を保存しない")
    ap.add_argument("--min-note", type=float, default=0.10, help="これより短い音符を捨てる [秒]")
    ap.add_argument("--title", help="曲名を指定（1ファイルのときのみ）")
    ap.add_argument("--artist", help="アーティスト名を指定（1ファイルのときのみ）")
    ap.add_argument("--force", action="store_true", help="処理済みの曲もやり直す")
    ap.add_argument("--index-only", action="store_true", help="index.json の再生成だけ行う")
    args = ap.parse_args(argv)
    # Windows のコンソール (cp932) で「〜」等が出せず落ちるのを防ぐ
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    args.out.mkdir(parents=True, exist_ok=True)
    if args.index_only:
        build_index(args.out)
        return 0
    if not args.inputs:
        ap.error("入力ファイルまたはフォルダを指定してください")

    files = find_audio_files(args.inputs)
    if not files:
        log("音声ファイルが見つかりません")
        return 1
    if len(files) > 1 and (args.title or args.artist):
        ap.error("--title / --artist は1ファイルのときだけ使えます")

    failed = []
    for i, f in enumerate(files, 1):
        log(f"=== ({i}/{len(files)}) {f}")
        try:
            process_file(f, args.out, args)
        except Exception as e:  # 1曲失敗しても残りは続ける
            log(f"失敗: {f.name}: {e}")
            failed.append(f)
    build_index(args.out)
    if failed:
        log(f"{len(failed)} 曲失敗: " + ", ".join(p.name for p in failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
