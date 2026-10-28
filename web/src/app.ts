// 画面どうしの連携（タブ移動・マイク開始）。モードから main.ts を直接 import しないためのつなぎ役
import { engine } from './audio/engine';
import { toast } from './ui/toast';

export const bus = new EventTarget();

/** 別のタブへ移動する。payload はそのモードの open() に渡る */
export function goTo(mode: string, payload?: unknown) {
  bus.dispatchEvent(new CustomEvent('goto', { detail: { mode, payload } }));
}

export async function startMic(): Promise<boolean> {
  if (engine.running) return true;
  try {
    await engine.start();
    return true;
  } catch (e) {
    const err = e as Error;
    const msg = err.name === 'NotAllowedError' ? 'マイクの使用が許可されていません。ブラウザの設定で許可してください。' : err.message;
    toast(`マイクを開始できませんでした: ${msg}`, 'error');
    return false;
  }
}
