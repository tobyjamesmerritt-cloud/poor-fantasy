/** A styled yes/no dialog (instead of the browser's confirm()). Resolves true for OK. */
export function confirmDialog(opts: { title: string; text: string; ok: string; cancel: string; danger?: boolean }): Promise<boolean> {
  const dlg = document.getElementById('confirm-dialog') as HTMLDialogElement;
  const title = dlg.querySelector('h2')!;
  const text = dlg.querySelector('p')!;
  const ok = dlg.querySelector<HTMLButtonElement>('.ok')!;
  const cancel = dlg.querySelector<HTMLButtonElement>('.cancel')!;
  title.textContent = opts.title;
  text.textContent = opts.text;
  ok.textContent = opts.ok;
  cancel.textContent = opts.cancel;
  ok.classList.toggle('danger', !!opts.danger);
  return new Promise((resolve) => {
    const finish = (answer: boolean) => {
      ok.onclick = cancel.onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    dlg.onclose = () => finish(false); // Escape key
    dlg.showModal();
    cancel.focus(); // the safe choice is the default
  });
}
