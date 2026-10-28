"""曲名・アーティスト名の取得（タグ → ファイル名「アーティスト - 曲名」の順）"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path


def read_tags(path: Path) -> tuple[str | None, str | None]:
    try:
        import mutagen

        f = mutagen.File(str(path), easy=True)
        if f is None or not f.tags:
            return None, None
        title = (f.tags.get("title") or [None])[0]
        artist = (f.tags.get("artist") or [None])[0]
        return title, artist
    except Exception:
        return None, None


def guess_title_artist(path: Path) -> tuple[str, str]:
    title, artist = read_tags(path)
    stem = path.stem
    if not (title and artist):
        m = re.match(r"^\s*(.+?)\s+-\s+(.+?)\s*$", stem)
        if m:
            artist = artist or m.group(1)
            title = title or m.group(2)
    return title or stem, artist or ""


def slugify(text: str) -> str:
    """フォルダ名に使える ID（日本語はそのまま残す）"""
    text = unicodedata.normalize("NFKC", text).strip()
    text = re.sub(r'[\\/:*?"<>|\s]+', "_", text)
    return text.strip("._")[:80] or "song"
