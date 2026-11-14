/**
 * Top menu bar (Game / Preferences / About) and the About/Controls dialogs.
 * Menu items that trigger game actions use data-command like other buttons
 * (wired in Hud); this module only handles opening/closing and preferences.
 */
import type { PrefsStore, TextSize } from './prefs';

export function initMenu(prefs: PrefsStore): void {
  const menus = [...document.querySelectorAll<HTMLElement>('.menu')];
  const closeAll = () => menus.forEach((m) => m.classList.remove('open'));

  for (const m of menus) {
    m.querySelector('.menu-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = m.classList.contains('open');
      closeAll();
      if (!wasOpen) m.classList.add('open');
    });
    // Picking an action closes the menu; toggling a preference keeps it open.
    m.querySelectorAll('.menu-panel button').forEach((b) => b.addEventListener('click', closeAll));
    m.querySelector('.menu-panel')!.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });

  // Preferences
  const grid = document.getElementById('pref-grid') as HTMLInputElement;
  const autoEnd = document.getElementById('pref-autoend') as HTMLInputElement;
  const text = document.getElementById('pref-text') as HTMLSelectElement;
  const sync = () => {
    const p = prefs.get();
    grid.checked = p.grid;
    autoEnd.checked = p.autoEndTurn;
    text.value = p.textSize;
  };
  sync();
  grid.addEventListener('change', () => prefs.set('grid', grid.checked));
  autoEnd.addEventListener('change', () => prefs.set('autoEndTurn', autoEnd.checked));
  text.addEventListener('change', () => prefs.set('textSize', text.value as TextSize));

  // Dialogs
  for (const [btnId, dlgId] of [
    ['open-about', 'about'],
    ['open-controls', 'controls'],
  ] as const) {
    const dlg = document.getElementById(dlgId) as HTMLDialogElement;
    document.getElementById(btnId)!.addEventListener('click', () => dlg.showModal());
    dlg.querySelector('.close')!.addEventListener('click', () => dlg.close());
  }
}
