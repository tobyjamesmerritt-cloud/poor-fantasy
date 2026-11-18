/**
 * HTML overlay UI (character card, party roster, message log, status, board
 * overlays). Menus and text live in the DOM rather than Phaser: easier layout,
 * accessibility and mobile scaling. Text is always set via textContent.
 */
import type { Command, CommandBus } from '../engine/commands';

export type Side = 'party' | 'enemy';

export interface SpriteCss {
  url: string;
  frameWidth: number;
  col: number;
  row: number;
  sheetCols: number;
  sheetRows: number;
}

export interface ActiveCard {
  name: string;
  side: Side;
  hp: number;
  maxHp: number;
  ac: number;
  attackName: string;
  attackBonus: number;
  damage: string;
  movesLeft: number;
  speed: number;
  actionUsed: boolean;
  reactionUsed: boolean;
  disengaged: boolean;
  sprite: SpriteCss;
  potions: number;
  bonusUsed: boolean;
  potionTargets: { id: string; name: string; self: boolean }[];
  tempHp?: number;
  effects?: string[]; // "Blessed", "Slowed", …
  concentration?: string; // spell being concentrated on
  slots?: { level: number; left: number; max: number }[];
  spells?: CardSpell[];
  aiming?: { name: string; picked: number; count: number; hint: string; canCastNow: boolean };
  attacks?: { made: number; of: number }; // Extra Attack: attacks in this Attack action
  cunning?: boolean; // Rogue: Dash/Disengage as a Bonus Action
  weapons?: { ref: string; name: string; detail: string; available: boolean }[]; // weapons to switch to (DND-24)
  objectUsed?: boolean; // free object interaction spent this turn
  grappled?: { by: string; dc: number }; // held by a monster: Break free is an action
  features?: { id: 'second-wind' | 'action-surge' | 'lay-on-hands'; name: string; left: number; reason?: string; summary: string; targets?: { id: string; name: string; missing: number }[] }[];
}

export interface CardSpell {
  id: string;
  name: string;
  level: number;
  detail: string; // "cantrip · action · 120 ft"
  summary: string;
  levels: number[];
  reason?: string;
}

/** One slot in the combat turn order bar (DND-17), starting with whoever acts now. */
export interface TurnEntry {
  id: string;
  detail: string[]; // shown when the row is tapped (DND-83): HP, AC, attack, conditions…
  name: string;
  side: Side;
  sprite: SpriteCss;
  hpPct: number;
  active: boolean;
  down: boolean;
}

export interface RosterEntry {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  sprite: SpriteCss;
  state?: 'ok' | 'out' | 'dead';
  cls?: string; // class name
}

export interface PartyRow {
  id: string;
  name: string;
  ac?: number;
  hp: number;
  maxHp: number;
  hitDice?: string; // "1d10"
  state: 'ok' | 'out' | 'dead';
}

export interface ExplorePanel {
  title: string; // location name
  partyName?: string;
  party: readonly RosterEntry[];
  where: string; // "13,7 W"
  clock: string; // "Day 1 · 16:07"
  purse: string; // "60 gp"
}

export interface CampPanel {
  title: string;
  subtitle: string;
  partyName?: string;
  party: readonly RosterEntry[];
  purse: string;
  clock: string;
  actions: { label: string; command: Command; disabledReason?: string }[];
}

export interface PlaceAction {
  label: string;
  command?: Command; // omitted = disabled ("coming soon")
}

export class Hud {
  private logEl = must('log');
  private statusEl = must('status');
  private cardEl = must('card');
  private namePattern: RegExp | null = null;
  private sideByName = new Map<string, Side>();

  /** End turn · Rewind · Flee: shown inside the combat card, under Dash/Dodge/Disengage (kept by reference — it moves). */
  private turnButtons = must('turn-buttons');

  constructor(private bus: CommandBus) {
    document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => bus.dispatch(JSON.parse(btn.dataset.command!) as Command));
    });
  }

  /** Show or hide controls that only make sense in combat. */
  setCombatControls(on: boolean): void {
    this.turnButtons.hidden = !on;
    if (!on) this.setTurnOrder(null);
  }

  /** Initiative order, current turn first; null hides it. */
  private inspected: string | null = null; // turn-order row opened for a closer look
  private lastTurnOrder: TurnEntry[] | null = null;

  setTurnOrder(entries: TurnEntry[] | null): void {
    this.lastTurnOrder = entries;
    const list = must('turn-order');
    list.hidden = !entries?.length;
    if (!entries?.some((t) => t.id === this.inspected)) this.inspected = null;
    list.replaceChildren(
      ...(entries ?? []).map((t) => {
        const hp = el('div', 'to-hp');
        hp.style.width = `${t.hpPct}%`;
        const open = this.inspected === t.id;
        const li = el(
          'li',
          `to-${t.side}${t.active ? ' to-active' : ''}${t.down ? ' to-down' : ''}${open ? ' to-open' : ''}`,
          portrait(t.sprite, 20),
          el('span', 'to-name', t.name),
          hp,
        );
        li.title = open ? 'Tap to close' : `${t.name} — tap for details`;
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-expanded', String(open));
        const toggle = () => {
          this.inspected = open ? null : t.id;
          this.setTurnOrder(this.lastTurnOrder);
        };
        li.addEventListener('click', toggle);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        });
        if (!open) return li;
        const box = el('div', 'to-detail', ...t.detail.map((d) => el('div', '', d)));
        return el('div', 'to-wrap', li, box);
      }),
    );
  }

  /** Register unit names so the log can colour them by side. */
  setNames(units: readonly { name: string; side: Side }[]): void {
    this.sideByName = new Map(units.map((u) => [u.name, u.side]));
    const names = [...this.sideByName.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
    this.namePattern = names.length ? new RegExp(`(${names.join('|')})`, 'g') : null;
  }

  setLog(lines: readonly string[]): void {
    this.logEl.replaceChildren(...lines.slice(-80).map((l) => this.renderLine(l)));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  /** Enable the Flee button only when the active character may flee; the tooltip says why not. */
  setFlee(state: { ok: boolean; reason?: string } | null): void {
    const btn = this.turnButtons.querySelector('#flee-btn') as HTMLButtonElement;
    btn.disabled = !state?.ok;
    btn.title = state?.ok ? 'Flee over the map edge (F)' : (state?.reason ?? 'Flee: stand on the map edge');
  }

  /** Highlight the End turn button when the active unit has used its action or movement. */
  setEndTurnHint(on: boolean): void {
    this.turnButtons.querySelectorAll('[data-command=\'{"type":"endTurn"}\']').forEach((b) => b.classList.toggle('suggest', on));
  }

  /** Full-board victory/defeat banner; hidden while combat is ongoing. */
  setOutcome(outcome: 'ongoing' | 'victory' | 'defeat' | 'fled' | 'none', detail = ''): void {
    const banner = must('banner');
    if (outcome === 'ongoing' || outcome === 'none') {
      banner.hidden = true;
      banner.className = 'overlay';
      return;
    }
    if (!banner.hidden && banner.classList.contains(outcome)) return; // don't replay the animation
    banner.className = `overlay ${outcome}`;
    must('banner-title').textContent =
      outcome === 'victory' ? 'Victory!' : outcome === 'fled' ? 'Retreat!' : 'The party has fallen';
    must('banner-sub').textContent = detail;
    banner.hidden = false;
  }

  /** Location panel on the world map; null hides it. */
  setPlace(place: { name: string; kind: string; description: string; actions: PlaceAction[] } | null): void {
    const panel = must('place');
    if (!place) {
      panel.hidden = true;
      return;
    }
    must('place-name').textContent = place.name;
    must('place-kind').textContent = place.kind;
    must('place-desc').textContent = place.description;
    must('place-actions').replaceChildren(
      ...place.actions.map((a) => {
        const btn = el('button', '', a.label) as HTMLButtonElement;
        if (a.command) btn.addEventListener('click', () => this.bus.dispatch(a.command!));
        else btn.disabled = true;
        return btn;
      }),
    );
    panel.hidden = false;
  }

  /** Compact active-character card: name over the portrait, stats beside it. */
  setActive(card: ActiveCard | null): void {
    if (!card) {
      this.cardEl.replaceChildren(el('p', 'muted', 'Combat over.'), this.turnButtons);
      return;
    }
    const hpPct = Math.round((card.hp / card.maxHp) * 100);
    const hpFill = el('div', hpPct > 50 ? 'fill ok' : hpPct > 25 ? 'fill warn' : 'fill bad');
    hpFill.style.width = `${hpPct}%`;
    const stats = el(
      'dl',
      'stats',
      el('dt', '', 'HP'),
      el('dd', '', `${card.hp}/${card.maxHp}${card.tempHp ? ` +${card.tempHp}` : ''}`),
      el('div', 'bar', hpFill),
      el('dt', '', 'AC'),
      el('dd', '', String(card.ac)),
      el('dt', '', 'Moves'),
      el('dd', '', `${card.movesLeft}/${card.speed}`),
    );
    this.cardEl.replaceChildren(
      el('div', 'card-top', el('div', `name ${card.side}`, card.name), portrait(card.sprite, 64), stats),
      el(
        'div',
        'actions',
        this.economy(card),
        el(
          'div',
          card.actionUsed ? 'action used' : 'action',
          `⚔ ${card.attackName} +${card.attackBonus} · ${card.damage}`,
          el('small', '', card.actionUsed ? 'action used this turn — you can still move' : 'click an enemy · or a fallen ally'),
          ...this.weaponSwap(card),
        ),
        this.otherActions(card),
        this.turnButtons,
        ...(card.effects?.length || card.concentration
          ? [el('div', 'effects', [...(card.effects ?? []), card.concentration ? `concentrating: ${card.concentration}` : ''].filter(Boolean).join(' · '))]
          : []),
        ...(card.spells ? [this.spellAction(card)] : []),
        ...this.featureActions(card),
        this.potionAction(card),
      ),
    );
  }

  /** What's left this turn: Action · Bonus Action · Reaction (SRD 5.2). */
  private economy(card: ActiveCard): HTMLElement {
    const pip = (label: string, used: boolean, title: string) => {
      const s = el('span', used ? 'eco used' : 'eco', `${used ? '✗' : '●'} ${label}`);
      s.title = title;
      return s;
    };
    return el(
      'div',
      'economy',
      pip(
        card.attacks && card.attacks.of > 1 && card.attacks.made > 0 && !card.actionUsed ? `Attack ${card.attacks.made}/${card.attacks.of}` : 'Action',
        card.actionUsed,
        card.attacks && card.attacks.of > 1
          ? `One action per turn. Extra Attack: the Attack action is ${card.attacks.of} attacks — move between them`
          : 'One action per turn: Attack, Dash, Dodge, Disengage, Help, or a spell',
      ),
      pip('Bonus', card.bonusUsed, 'One Bonus Action per turn: a potion, some spells'),
      pip('Reaction', card.reactionUsed, 'One Reaction per round: an opportunity attack when an enemy leaves your reach'),
      ...(card.disengaged ? [el('span', 'eco note', 'Disengaged')] : []),
    );
  }

  /** Dash, Dodge, Disengage — the other actions (SRD 5.2). */
  private otherActions(card: ActiveCard): HTMLElement {
    // The hotkey letter is underlined, Gold Box style (keys in game/input/keyboard.ts)
    const mk = (label: string, action: 'dash' | 'dodge' | 'disengage', title: string, key: number) => {
      const b = el('button', '', label.slice(0, key), el('u', '', label[key]), label.slice(key + 1)) as HTMLButtonElement;
      b.title = `${title} (${label[key].toUpperCase()})`;
      // Rogue's Cunning Action: once the action is spent, Dash and Disengage still work as a Bonus Action
      const bonus = !!card.cunning && action !== 'dodge' && (card.actionUsed || (card.attacks?.made ?? 0) > 0) && !card.bonusUsed;
      b.disabled = (card.actionUsed || (card.attacks?.made ?? 0) > 0) && !bonus;
      if (bonus) b.title = `Bonus Action (Cunning Action): ${title.replace(/^Action: /, '')}`;
      b.addEventListener('click', () => this.bus.dispatch({ type: 'combatAction', action, ...(bonus ? { bonus } : {}) }));
      return b;
    };
    return el(
      'div',
      'other-actions',
      mk('Dash', 'dash', 'Action: move up to your Speed again this turn', 3),
      mk('Dodge', 'dodge', 'Action: attacks against you have disadvantage until your next turn (and advantage on Dexterity saves)', 1),
      mk('Disengage', 'disengage', 'Action: moving away from enemies won’t provoke opportunity attacks this turn', 6),
      ...(card.grappled
        ? [
            (() => {
              const b = el('button', 'break-free', `Break free (DC ${card.grappled.dc})`) as HTMLButtonElement;
              b.title = `Action: Strength (Athletics) or Dexterity (Acrobatics) against DC ${card.grappled.dc} to escape ${card.grappled.by}'s grapple`;
              b.disabled = card.actionUsed || (card.attacks?.made ?? 0) > 0;
              b.addEventListener('click', () => this.bus.dispatch({ type: 'combatAction', action: 'escape' }));
              return b;
            })(),
          ]
        : []),
    );
  }

  /** Other weapons to draw (from the pack): a free object interaction, once a turn. */
  private weaponSwap(card: ActiveCard): HTMLElement[] {
    if (!card.weapons?.length) return [];
    const row = el('div', 'potion-row weapon-row');
    for (const w of card.weapons) {
      const b = el('button', '', `⇄ ${w.name}`) as HTMLButtonElement;
      b.disabled = !!card.objectUsed || !w.available;
      b.title = card.objectUsed
        ? 'You have already handled an object this turn'
        : !w.available
          ? 'Someone else is already holding the spare'
          : `Draw it (free, once a turn): ${w.detail}`;
      b.addEventListener('click', () => this.bus.dispatch({ type: 'swapWeapon', ref: w.ref }));
      row.append(b);
    }
    return [row];
  }

  /** Class features: Second Wind, Action Surge, Lay On Hands (targets as buttons). */
  private featureActions(card: ActiveCard): HTMLElement[] {
    return (card.features ?? []).map((f) => {
      const box = el('div', f.reason ? 'action disabled' : 'action', `✚ ${f.name}${f.id === 'lay-on-hands' ? ` (pool ${f.left})` : ` ×${f.left}`}`);
      box.title = f.summary;
      if (f.reason) {
        box.append(el('small', '', f.reason));
        return box;
      }
      const row = el('div', 'potion-row');
      const targets = f.targets ?? [{ id: '', name: '', missing: 0 }];
      for (const t of targets) {
        const b = el('button', '', f.targets ? `Heal ${t.name}` : f.id === 'action-surge' ? 'Surge' : 'Use') as HTMLButtonElement;
        b.title = f.summary;
        b.addEventListener('click', () => this.bus.dispatch({ type: 'useFeature', feature: f.id, ...(t.id ? { targetId: t.id } : {}) }));
        row.append(b);
      }
      box.append(row);
      return box;
    });
  }

  private spellsOpen = true;

  /** Spell list: pick a spell (and slot level), then targets on the grid. */
  private spellAction(card: ActiveCard): HTMLElement {
    const pips = (card.slots ?? []).map((s) => `L${s.level} ${'●'.repeat(s.left)}${'○'.repeat(s.max - s.left)}`).join('  ');
    const head = el('button', 'spell-head', `✦ Spells ${this.spellsOpen ? '▾' : '▸'}`, el('span', 'slot-pips', pips)) as HTMLButtonElement;
    head.title = 'Show or hide your spells';
    const box = el('div', 'action spells', head);
    head.addEventListener('click', () => {
      this.spellsOpen = !this.spellsOpen;
      this.setActive(card);
    });
    if (card.aiming) {
      const a = card.aiming;
      const cancel = el('button', '', 'Cancel') as HTMLButtonElement;
      cancel.addEventListener('click', () => this.bus.dispatch({ type: 'cancel' }));
      const row = el('div', 'potion-row');
      if (a.canCastNow) {
        const now = el('button', '', 'Cast now') as HTMLButtonElement;
        now.addEventListener('click', () => this.bus.dispatch({ type: 'confirm' }));
        row.append(now);
      }
      row.append(cancel);
      box.append(el('div', 'aiming', `Casting ${a.name}`, el('small', '', a.hint)), row);
      return box;
    }
    if (!this.spellsOpen) return box;
    const list = el('div', 'spell-list');
    for (const s of card.spells ?? []) {
      const row = el('div', s.reason ? 'spell disabled' : 'spell');
      row.title = `${s.summary}${s.reason ? `\n\n${s.reason}` : ''}`;
      const name = el('button', 'spell-name', s.name, el('small', '', s.reason ?? s.detail)) as HTMLButtonElement;
      name.disabled = !!s.reason;
      name.addEventListener('click', () => this.bus.dispatch({ type: 'aimSpell', spellId: s.id, slot: s.levels[0] }));
      row.append(name);
      if (!s.reason && s.level > 0 && s.levels.length > 1) {
        // cast with a higher slot
        for (const lv of s.levels.slice(1)) {
          const up = el('button', 'upcast', `L${lv}`) as HTMLButtonElement;
          up.title = `Cast with a level ${lv} slot`;
          up.addEventListener('click', () => this.bus.dispatch({ type: 'aimSpell', spellId: s.id, slot: lv }));
          row.append(up);
        }
      }
      list.append(row);
    }
    box.append(list);
    return box;
  }

  /**
   * Gold Box-style side panel inside a location: party (name, AC, HP),
   * position and clock, and on-screen movement buttons (touch).
   */
  setExplore(panel: ExplorePanel): void {
    const btn = (label: string, title: string, command?: Command, key?: string) => {
      const b = el('button', '', ...(key ? hotkeyLabel(label, key) : [label])) as HTMLButtonElement;
      b.title = key ? `${title} (${key.toUpperCase()})` : title;
      if (command) b.addEventListener('click', () => this.bus.dispatch(command));
      else b.disabled = true;
      return b;
    };
    this.cardEl.replaceChildren(
      el('div', 'explore-title', panel.title),
      rosterList(panel.party, this.bus, panel.partyName),
      el('div', 'explore-where', el('span', '', panel.where), el('span', '', panel.clock), el('span', 'purse', panel.purse)),
      el(
        'div',
        'move-pad',
        btn('↶', 'Turn left (A / ←)', { type: 'turn', dir: 'left' }),
        btn('↑', 'Forward (W / ↑)', { type: 'step', dir: 'forward' }),
        btn('↷', 'Turn right (D / →)', { type: 'turn', dir: 'right' }),
        btn('⇠', 'Step left (Q)', { type: 'step', dir: 'left' }),
        btn('↓', 'Back (S / ↓)', { type: 'step', dir: 'back' }),
        btn('⇢', 'Step right (E)', { type: 'step', dir: 'right' }),
      ),
      el(
        'div',
        'explore-actions',
        btn('Search', 'coming later'),
        btn('Encamp', 'Make camp here (not in towns — use the inn)', { type: 'encamp' }, 'n'),
        btn('Leave', 'Back to the world map', { type: 'leaveLocation' }, 'l'),
      ),
    );
  }

  /** Camp / inn panel: party with HP and Hit Dice, purse, clock and the rest buttons. */
  setCamp(panel: CampPanel): void {
    this.cardEl.replaceChildren(
      el('div', 'explore-title', panel.title),
      el('div', 'muted small', panel.subtitle),
      rosterList(panel.party, this.bus, panel.partyName),
      el('div', 'explore-where', el('span', '', panel.clock), el('span', 'purse', panel.purse)),
      el(
        'div',
        'camp-actions',
        ...panel.actions.map((a) => {
          const b = el('button', '', a.label) as HTMLButtonElement;
          if (a.disabledReason) {
            b.disabled = true;
            b.title = a.disabledReason;
            return el('div', 'camp-action', b, el('small', 'muted', a.disabledReason));
          }
          b.addEventListener('click', () => this.bus.dispatch(a.command));
          return b;
        }),
      ),
    );
  }

  /** Potion of Healing buttons: drink, or give to an adjacent ally (Bonus Action). */
  private potionAction(card: ActiveCard): HTMLElement {
    const box = el('div', card.potions && card.potionTargets.length ? 'action' : 'action disabled', `⚗ Potion of Healing ×${card.potions}`);
    if (!card.potions) {
      box.append(el('small', '', 'none in the pack — buy them at a shop'));
      return box;
    }
    if (card.bonusUsed) {
      box.append(el('small', '', 'Bonus Action used this turn'));
      return box;
    }
    if (!card.potionTargets.length) {
      box.append(el('small', '', 'nobody hurt within reach'));
      return box;
    }
    const row = el('div', 'potion-row');
    for (const t of card.potionTargets) {
      const b = el('button', '', t.self ? 'Drink' : `Give ${t.name}`) as HTMLButtonElement;
      b.title = 'Bonus Action: 2d4 + 2 HP — you can still attack this turn';
      b.addEventListener('click', () => this.bus.dispatch({ type: 'usePotion', targetId: t.id }));
      row.append(b);
    }
    box.append(row);
    return box;
  }

  /** Party list for the world map. */
  setRoster(entries: readonly RosterEntry[], footer?: { purse: string; clock: string; encamp: Command }, partyName?: string): void {
    const extra: HTMLElement[] = [];
    if (footer) {
      const camp = el('button', '', ...hotkeyLabel('Encamp', 'n')) as HTMLButtonElement;
      camp.title = 'Make camp here — off the road, not on bridges or at towns (N)';
      camp.addEventListener('click', () => this.bus.dispatch(footer.encamp));
      extra.push(el('div', 'explore-where', el('span', '', footer.clock), el('span', 'purse', footer.purse)), el('div', 'explore-actions', camp));
    }
    this.cardEl.replaceChildren(
      rosterList(entries, this.bus, partyName),
      ...extra,
    );
  }

  private renderLine(text: string): HTMLElement {
    const cls = text.startsWith('▶')
      ? 'turn'
      : text.startsWith('⟲')
        ? 'rewind'
        : text.startsWith('—')
          ? 'round'
          : /Victory!/.test(text)
            ? 'win'
            : /fallen…|dies\.|slain|killed outright/.test(text)
              ? 'lose'
              : /unconscious|death save/.test(text)
                ? 'down'
                : /CRITS/.test(text)
                  ? 'crit'
                  : /stable|regains consciousness/.test(text)
                    ? 'saved'
                    : '';
    const p = el('p', cls);
    if (!this.namePattern) {
      p.textContent = text;
      return p;
    }
    for (const part of text.split(this.namePattern)) {
      const side = this.sideByName.get(part);
      p.append(side ? el('span', `name ${side}`, part) : document.createTextNode(part));
    }
    return p;
  }
}

/** Click a name: that character's sheet (stats, gear, spells). */
function nameButton(name: string, id: string, bus: CommandBus): HTMLElement {
  const b = el('button', 'name-link', name) as HTMLButtonElement;
  b.title = `${name}: character sheet`;
  b.addEventListener('click', () => bus.dispatch({ type: 'openCharacter', characterId: id }));
  return b;
}

/** The party as the world map shows it: portrait, name (class), HP and a bar — the same in every panel. */
/** A button label with its hotkey letter underlined (first match, any case); unchanged if the letter isn't in it. */
function hotkeyLabel(text: string, key: string): (Node | string)[] {
  const i = text.toLowerCase().indexOf(key.toLowerCase());
  return i < 0 ? [text] : [text.slice(0, i), el('u', '', text[i]), text.slice(i + 1)];
}

function rosterList(entries: readonly RosterEntry[], bus: CommandBus, partyName?: string): HTMLElement {
  const head = el('button', 'roster-head', ...hotkeyLabel(`${partyName || 'Party'} ▸`, 'p')) as HTMLButtonElement;
  head.title = 'The party: levels, spells, pack and each character’s sheet (P)';
  head.addEventListener('click', () => bus.dispatch({ type: 'openParty' }));
  return el(
    'div',
    'roster',
    head,
    ...entries.map((e) => {
      const pct = Math.max(0, Math.round((e.hp / e.maxHp) * 100));
      const fill = el('div', pct > 50 ? 'fill ok' : pct > 25 ? 'fill warn' : 'fill bad');
      fill.style.width = `${pct}%`;
      const hp = e.state === 'dead' ? 'dead' : e.state === 'out' ? `${e.hp}/${e.maxHp} · unconscious` : `${e.hp}/${e.maxHp}`;
      return el(
        'div',
        'roster-row',
        portrait(e.sprite, 32),
        el(
          'div',
          e.state === 'dead' ? 'muted' : '',
          nameButton(e.name, e.id, bus),
          `${e.cls ? ` (${e.cls})` : ''}  ${hp}`,
          el('div', 'bar', fill),
        ),
      );
    }),
  );
}

function portrait(s: SpriteCss, px: number): HTMLElement {
  const p = el('div', 'portrait');
  const scale = px / s.frameWidth;
  Object.assign(p.style, {
    backgroundImage: `url(${s.url})`,
    backgroundSize: `${s.sheetCols * px}px ${s.sheetRows * px}px`,
    backgroundPosition: `-${s.col * s.frameWidth * scale}px -${s.row * s.frameWidth * scale}px`,
  });
  return p;
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function must(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id} in index.html`);
  return e;
}
