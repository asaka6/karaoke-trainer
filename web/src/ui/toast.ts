// 画面下に数秒だけ出る通知
export type ToastKind = 'info' | 'error' | 'success';

export function toast(message: string, kind: ToastKind = 'info', ms = 3200) {
  let box = document.querySelector<HTMLElement>('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.textContent = message;
  box.append(t);
  const close = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  };
  t.addEventListener('click', close);
  setTimeout(close, kind === 'error' ? ms * 2 : ms);
}
