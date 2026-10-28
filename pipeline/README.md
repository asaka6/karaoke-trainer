# pipeline — 曲データ前処理 CLI

手元の音声ファイル（mp3 / wav / m4a / flac …）から、カラオケ練習アプリ用のデータを作ります。

1. **Demucs**（htdemucs）でボーカルと伴奏に分離 → `accompaniment.mp3`（練習用の伴奏）と `vocals.mp3`
2. ボーカルから **torchcrepe**（無ければ librosa の **pyin**）で F0（基本周波数）を 10ms ごとに抽出
3. F0 を音符単位（開始・終了時刻・MIDI ノート番号）に区切る。短すぎる音（0.1 秒未満）や前後から大きく外れた音（オクターブ誤りなど）は除去
4. 曲ごとの JSON と、全曲の音域をまとめた `index.json` を出力

GPU が無くても動きます（CPU だと 1 曲あたり数分）。

> 出力（`songs/` 以下）は著作物由来なので **絶対にコミットしないでください**。`.gitignore` で除外してあります。

## セットアップ（Windows / macOS / Linux 共通）

Python 3.10〜3.12 を想定。リポジトリの `pipeline/` で:

```bash
python -m venv .venv
# Windows (Git Bash):  source .venv/Scripts/activate
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# macOS / Linux:        source .venv/bin/activate

# 1) PyTorch（約 200MB〜）。GPU が無いなら CPU 版:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
#    NVIDIA GPU がある場合は https://pytorch.org/get-started/locally/ のコマンドで CUDA 版を入れる
#    macOS は: pip install torch torchaudio

# 2) 本体と Demucs / torchcrepe
pip install -e ".[ml,dev]"
```

- 音声のデコードは `imageio-ffmpeg` に同梱の ffmpeg を使うので、ffmpeg を別に入れる必要はありません。
- Demucs のモデル（約 80MB）は初回実行時に自動でダウンロードされます。
- torch を入れたくない場合は `pip install -e .` だけでも、`--no-separate --f0 pyin`（ボーカルのみの音源向け）で動きます。

## 使い方

```bash
# 1曲
python -m karaoke_pipeline "D:/music/アーティスト - 曲名.mp3"

# フォルダごと一括（サブフォルダも対象。処理済みの曲は自動でスキップ）
python -m karaoke_pipeline "D:/music/karaoke"

# 出力先を変える（既定は ./songs）
python -m karaoke_pipeline song.m4a -o ../songs

# index.json だけ作り直す
python -m karaoke_pipeline --index-only -o ../songs
```

主なオプション:

| オプション | 説明 |
|---|---|
| `--f0 auto/crepe/pyin` | F0 抽出法。既定は torchcrepe があれば crepe |
| `--crepe-model tiny/full` | 既定は GPU なら full、CPU なら tiny（full は高精度だが CPU では数倍遅い） |
| `--device auto/cpu/cuda/mps` | 計算デバイス |
| `--model htdemucs_ft` | Demucs のモデル（`htdemucs_ft` は高品質だが 4 倍遅い） |
| `--no-separate` | 分離しない（入力がアカペラ・ボーカルのみの場合） |
| `--no-vocals` | 分離したボーカル MP3 を保存しない |
| `--min-note 0.1` | これより短い音符を捨てる [秒] |
| `--title` / `--artist` | 曲名・アーティスト名を指定（1 ファイルのとき） |
| `--force` | 処理済みの曲もやり直す |

曲名・アーティスト名は、音声ファイルのタグ → ファイル名「アーティスト - 曲名」の順で決まります。

## 出力

```
songs/
  index.json
  <曲ID>/
    <曲ID>.json          … メロディ（Web アプリの「曲」タブで読み込む）
    accompaniment.mp3    … 伴奏（同上）
    vocals.mp3           … 分離したボーカル（確認用）
```

`<曲ID>.json`:

```json
{
  "title": "曲名", "artist": "アーティスト",
  "notes": [{ "start": 12.34, "end": 12.80, "midi": 64 }, ...],
  "range": { "min": 55, "max": 72 },
  "duration": 245.1, "accompaniment": "accompaniment.mp3", "source": "元ファイル名.mp3", "f0_method": "crepe"
}
```

`index.json`:

```json
{ "generated": "...", "songs": [{ "id": "...", "title": "...", "artist": "...", "range": { "min": 55, "max": 72 }, "duration": 245.1, "noteCount": 412, "json": "<曲ID>/<曲ID>.json", "accompaniment": "<曲ID>/accompaniment.mp3" }] }
```

## スマホで使うとき

Web アプリはサーバーから曲データを読まず、端末内のファイルを選んで読み込みます。
`songs/<曲ID>/` の JSON と `accompaniment.mp3`、それと `index.json` を、Google ドライブ / iCloud Drive / USB などでスマホに移してください。

## テスト

```bash
pytest                 # 音符化ロジックのテスト（軽い）
pytest -m slow -s      # 合成音で CLI 全体（Demucs・crepe・pyin）を通すテスト
```

## 精度について

- 分離後のボーカルにコーラスやハモリが残っていると、そちらを拾うことがあります。
- 音符の区切りは F0 の変化から自動で推定しているため、同じ高さの音が続く歌詞（「ラララ」など）は 1 つの音符にまとまることがあります。採点（音程正確率）には影響しません。
