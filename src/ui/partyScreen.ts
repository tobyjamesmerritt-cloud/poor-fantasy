/**
 * Party screen (HTML): create characters (SRD 5.2: class, species,
 * background, ability scores), rename / re-portrait, reorder and remove.
 * Changes are sent as Commands; main.ts validates and updates the game state.
 *
 * New game: everything about a character can be chosen and changed.
 * During an adventure: existing characters keep their class and abilities
 * (only name and portrait change); new recruits are created in full.
 */
import type { Command, CommandBus } from '../engine/commands';
import type { Ability, AbilityScores, CharacterSheet, GameState, PartyMemberState } from '../engine/state';
import {
  characterData,
  checkSheet,
  className,
  derive,
  MAX_PARTY,
  PORTRAITS,
} from '../content/characters';
import {
  ABILITIES,
  ABILITY_NAMES,
  abilityMod,
  IMPLEMENTED,
  POINT_BUY_BUDGET,
  pointBuyCost,
  signed,
  STANDARD_ARRAY,
} from '../rules/character';
import type { SpriteCss } from './hud';

type Method = 'roll' | 'array' | 'points';

interface Draft {
  sheet: CharacterSheet;
  isNew: boolean;
  method: Method;
  pool: number[]; // roll / array values; scores are a permutation of these
  incMode: 'split' | 'spread'; // +2/+1 or +1/+1/+1
  plus2: Ability;
  plus1: Ability;
}

export interface PartyScreenDeps {
  bus: CommandBus;
  rollScores: () => number[]; // 4d6 drop lowest ×6 through the game Rng (shown highest first)
  spriteCss: (key: string) => SpriteCss | null;
}

export class PartyScreen {
  private root: HTMLElement;
  private game!: GameState;
  private newGame = false;
  private draft: Draft | null = null;

  constructor(private deps: PartyScreenDeps) {
    const el = document.getElementById('party-screen');
    if (!el) throw new Error('Missing #party-screen in index.html');
    this.root = el;
  }

  show(game: GameState, newGame: boolean): void {
    this.game = game;
    this.newGame = newGame;
    if (this.draft && !this.draft.isNew && !this.findSheet(this.draft.sheet.id)) this.draft = null;
    this.render();
  }

  /** Re-render after main.ts changed the roster (keeps an open editor unless it was saved). */
  refresh(saved?: string): void {
    if (saved && this.draft?.sheet.id === saved) this.draft = null;
    this.render();
  }

  private findSheet(id: string): CharacterSheet | undefined {
    return this.game.roster.find((s) => s.id === id) ?? this.game.bench.find((b) => b.sheet.id === id)?.sheet;
  }

  private send(cmd: Command): void {
    this.deps.bus.dispatch(cmd);
  }

  // -------------------------------------------------------------------------

  private render(): void {
    const roster = this.game.roster;
    const bench = this.game.bench;
    const full = roster.length >= MAX_PARTY;
    const left = div(
      'ps-roster',
      h('h2', '', this.newGame ? 'Create your party' : 'The party'),
      h(
        'p',
        'muted small',
        `The party: up to ${MAX_PARTY}, in marching order (the first ones stand in front). Make as many characters as you like — the rest wait in the pool below.`,
      ),
      h('h3', '', `Party (${roster.length}/${MAX_PARTY})`),
      ...roster.map((s, i) => this.partyRow(s, i)),
      roster.length ? null : h('p', 'muted', 'Nobody yet.'),
      h('h3', '', `Character pool (${bench.length})`),
      ...bench.map((b) => this.benchRow(b.sheet, b.state, full)),
      bench.length ? null : h('p', 'muted small', 'Empty. Characters you bench or create beyond six wait here.'),
      div(
        'ps-buttons',
        button('＋ New character', () => this.startNew()),
        this.newGame
          ? button('Use ready-made party', () => {
              const msg = roster.length ? 'Fill the party with the six ready-made characters? Current members move to the pool.' : '';
              if (!msg || confirm(msg)) this.send({ type: 'readyMadeParty' });
            })
          : null,
        button(
          this.newGame ? 'Begin the adventure ▶' : 'Done',
          () => this.send({ type: 'closePartyScreen' }),
          roster.some((s) => !this.game.party.find((p) => p.id === s.id)?.dead) ? undefined : 'You need at least one living character in the party.',
          'primary',
        ),
      ),
    );
    const right = this.draft ? this.editor(this.draft) : this.help();
    this.root.replaceChildren(left, right);
  }

  private summary(s: CharacterSheet, now: PartyMemberState | null): HTMLElement {
    const d = derive(s);
    const status = now?.dead ? ' · dead' : now && now.hp <= 0 ? ' · unconscious' : '';
    return div(
      'ps-who',
      h('div', 'name party', s.name),
      h('div', 'small', `${characterData.species[s.speciesId].name} ${className(s)} · ${characterData.backgrounds[s.backgroundId].name}`),
      h('div', 'small muted', `HP ${now ? now.hp : d.hp}/${d.hp} · AC ${d.ac} · ${d.attackName} ${signed(d.attackBonus)}${status}`),
    );
  }

  private partyRow(s: CharacterSheet, i: number): HTMLElement {
    const now = this.game.party.find((p) => p.id === s.id) ?? null;
    return div(
      `ps-row${this.draft?.sheet.id === s.id ? ' editing' : ''}`,
      this.portrait(s.sprite, 48),
      this.summary(s, now),
      div(
        'ps-row-buttons',
        button('↑', () => this.send({ type: 'moveCharacter', id: s.id, by: -1 }), i === 0 ? 'Already first' : undefined),
        button('↓', () => this.send({ type: 'moveCharacter', id: s.id, by: 1 }), i === this.game.roster.length - 1 ? 'Already last' : undefined),
        button('Edit', () => this.startEdit(s)),
        button('Bench', () => this.send({ type: 'benchCharacter', id: s.id })),
      ),
    );
  }

  private benchRow(s: CharacterSheet, state: PartyMemberState | null, full: boolean): HTMLElement {
    return div(
      `ps-row bench${this.draft?.sheet.id === s.id ? ' editing' : ''}`,
      this.portrait(s.sprite, 48),
      this.summary(s, state),
      div(
        'ps-row-buttons',
        button('Join', () => this.send({ type: 'joinParty', id: s.id }), full ? 'The party is full (6) — bench someone first.' : undefined),
        button('Edit', () => this.startEdit(s)),
        button('Delete', () => {
          if (confirm(`Delete ${s.name} for good?`)) this.send({ type: 'deleteCharacter', id: s.id });
        }),
      ),
    );
  }

  private help(): HTMLElement {
    return div(
      'ps-editor',
      h('h2', '', 'Making a character'),
      h('p', '', 'Follow the current D&D steps (SRD 5.2): choose a class, a species and a background, then generate ability scores.'),
      h('ul', '', ...[
        'Make as many characters as you like; up to six adventure together. Bench and Join swap them in and out.',
        'Class sets Hit Points, armour and weapon. Fighter, Paladin, Rogue, Cleric, Ranger and Wizard for now — the other six SRD classes come later.',
        'Species sets speed and special traits.',
        'Background raises three abilities (+2/+1 or +1/+1/+1) and gives an Origin feat.',
        'Ability scores: roll 4d6 and drop the lowest (re-roll as often as you like), the standard array, or point buy.',
        'Traits and feats marked ✓ already work in the game; the rest are recorded for later.',
      ].map((t) => h('li', '', t))),
    );
  }

  // -------------------------------------------------------------------------
  // Editor
  // -------------------------------------------------------------------------

  private startNew(): void {
    const used = new Set([...this.game.roster.map((s) => s.id), ...this.game.bench.map((b) => b.sheet.id)]);
    let n = 1;
    while (used.has(`c${n}`)) n++;
    const scores = byValue(this.deps.rollScores());
    this.draft = {
      sheet: {
        id: `c${n}`,
        name: '',
        sprite: PORTRAITS[(this.game.roster.length + 6) % PORTRAITS.length],
        classId: 'fighter',
        speciesId: 'human',
        backgroundId: 'soldier',
        scores: suggest('fighter', scores),
        increases: {},
        level: 1,
      },
      isNew: true,
      method: 'roll',
      pool: scores,
      incMode: 'split',
      plus2: 'str',
      plus1: 'con',
    };
    this.applyIncreases(this.draft);
    this.render();
  }

  private startEdit(s: CharacterSheet): void {
    const inc = Object.entries(s.increases).filter(([, v]) => v);
    const spread = inc.length === 3;
    const plus2 = (inc.find(([, v]) => v === 2)?.[0] ?? inc[0]?.[0] ?? 'str') as Ability;
    const plus1 = (inc.find(([, v]) => v === 1)?.[0] ?? 'con') as Ability;
    this.draft = {
      sheet: structuredClone(s),
      isNew: false,
      method: 'roll',
      pool: byValue(ABILITIES.map((a) => s.scores[a])),
      incMode: spread ? 'spread' : 'split',
      plus2,
      plus1,
    };
    this.render();
  }

  /** Can this draft's class, abilities etc. still change? */
  private locked(d: Draft): boolean {
    return !d.isNew && !this.newGame;
  }

  private editor(d: Draft): HTMLElement {
    const s = d.sheet;
    const locked = this.locked(d);
    const data = characterData;
    const errors = checkSheet(s);
    const derived = errors.some((e) => /Unknown|playable/.test(e)) ? null : derive(s);
    const bg = data.backgrounds[s.backgroundId];
    const species = data.species[s.speciesId];
    const update = (fn: () => void) => () => {
      fn();
      this.render();
    };

    const nameInput = h('input', 'ps-name') as HTMLInputElement;
    nameInput.value = s.name;
    nameInput.maxLength = 24;
    nameInput.placeholder = 'Name';
    nameInput.addEventListener('input', () => {
      s.name = nameInput.value;
    });
    nameInput.addEventListener('change', () => this.render());

    const portraits = div(
      'ps-portraits',
      ...PORTRAITS.map((key) => {
        const b = this.portrait(key, 40);
        b.classList.add('pick');
        if (key === s.sprite) b.classList.add('chosen');
        b.addEventListener('click', update(() => (s.sprite = key)));
        return b;
      }),
    );

    const classSelect = select(
      Object.entries(data.classes).map(([id, c]) => ({
        value: id,
        label: c.playable ? `${c.name} (d${c.hitDie})` : `${c.name} — coming later`,
        disabled: !c.playable,
      })),
      s.classId,
      (v) => {
        s.classId = v;
        if (d.method !== 'points') s.scores = suggest(v, d.pool);
        this.render();
      },
      locked,
    );
    const speciesSelect = select(
      Object.entries(data.species).map(([id, sp]) => ({ value: id, label: `${sp.name} (${sp.speed} ft)` })),
      s.speciesId,
      (v) => {
        s.speciesId = v;
        this.render();
      },
      locked,
    );
    const bgSelect = select(
      Object.entries(data.backgrounds).map(([id, b]) => ({ value: id, label: b.name })),
      s.backgroundId,
      (v) => {
        s.backgroundId = v;
        const abil = data.backgrounds[v].abilities;
        d.plus2 = abil[0];
        d.plus1 = abil[1];
        this.applyIncreases(d);
        this.render();
      },
      locked,
    );

    const trait = (t: string) => h('li', IMPLEMENTED.includes(t) ? 'ok' : 'muted', `${IMPLEMENTED.includes(t) ? '✓ ' : ''}${t}`);

    // background increases
    const incControls = div(
      'ps-inc',
      radio('inc', 'split', d.incMode === 'split', '+2 / +1', update(() => {
        d.incMode = 'split';
        this.applyIncreases(d);
      }), locked),
      radio('inc', 'spread', d.incMode === 'spread', `+1 to ${bg.abilities.map((a) => a.toUpperCase()).join(', ')}`, update(() => {
        d.incMode = 'spread';
        this.applyIncreases(d);
      }), locked),
      d.incMode === 'split'
        ? div(
            'ps-inc-picks',
            h('span', '', '+2'),
            select(bg.abilities.map((a) => ({ value: a, label: ABILITY_NAMES[a] })), d.plus2, (v) => {
              d.plus2 = v as Ability;
              if (d.plus1 === d.plus2) d.plus1 = bg.abilities.find((a) => a !== d.plus2)!;
              this.applyIncreases(d);
              this.render();
            }, locked),
            h('span', '', '+1'),
            select(bg.abilities.filter((a) => a !== d.plus2).map((a) => ({ value: a, label: ABILITY_NAMES[a] })), d.plus1, (v) => {
              d.plus1 = v as Ability;
              this.applyIncreases(d);
              this.render();
            }, locked),
          )
        : null,
    );

    return div(
      'ps-editor',
      h('h2', '', d.isNew ? 'New character' : `Edit ${s.name || 'character'}`),
      locked ? h('p', 'muted small', 'Class, species, background and abilities are fixed once the adventure has begun.') : null,
      field('Name', nameInput),
      field('Portrait', portraits),
      div(
        'ps-grid',
        field('Class (Hit Die)', classSelect),
        field('Species (Speed: 5 ft = 1 square)', speciesSelect),
        field('Background', bgSelect),
      ),
      div(
        'ps-grid',
        div('', h('div', 'small muted', `${species.name}: ${species.size}, ${species.speed} ft`), h('ul', 'ps-traits', ...species.traits.map(trait))),
        div(
          '',
          h('div', 'small muted', `${bg.name}: ${bg.skills.join(', ')}`),
          h('ul', 'ps-traits', trait(bg.feat)),
          incControls,
        ),
      ),
      this.abilityBlock(d, locked),
      derived
        ? div(
            'ps-summary',
            h(
              'div',
              '',
              `HP ${derived.hp} · AC ${derived.ac} · Speed ${derived.speed * 5} ft · Initiative ${signed(derived.initBonus)} · ` +
                `${derived.attackName} ${signed(derived.attackBonus)} (${derived.damage.join(' + ')})`,
            ),
            ...derived.notes.map((n) => h('div', 'warn small', n)),
          )
        : null,
      errors.length ? h('ul', 'ps-errors', ...errors.map((e) => h('li', '', e))) : null,
      div(
        'ps-buttons',
        button(d.isNew ? 'Add to party' : 'Save', () => this.send({ type: 'saveCharacter', sheet: structuredClone(s) }), errors[0], 'primary'),
        button('Cancel', () => {
          this.draft = null;
          this.render();
        }),
      ),
    );
  }

  private abilityBlock(d: Draft, locked: boolean): HTMLElement {
    const s = d.sheet;
    const final = (a: Ability) => s.scores[a] + (s.increases[a] ?? 0);
    const tabs = div(
      'ps-tabs',
      ...(['roll', 'array', 'points'] as Method[]).map((m) =>
        button(
          { roll: 'Roll 4d6', array: 'Standard array', points: 'Point buy' }[m],
          () => {
            d.method = m;
            if (m === 'roll') d.pool = byValue(this.deps.rollScores());
            if (m === 'array') d.pool = [...STANDARD_ARRAY];
            s.scores = m === 'points' ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } : suggest(s.classId, d.pool);
            this.render();
          },
          locked ? 'Fixed' : undefined,
          d.method === m ? 'active' : '',
        ),
      ),
      d.method === 'roll' && !locked
        ? button('🎲 Re-roll', () => {
            d.pool = byValue(this.deps.rollScores());
            s.scores = suggest(s.classId, d.pool);
            this.render();
          })
        : null,
    );
    const spent = d.method === 'points' ? pointBuyCost(s.scores) : null;
    const rows = ABILITIES.map((a) => {
      let control: HTMLElement;
      if (d.method === 'points' && !locked) {
        control = div(
          'ps-pb',
          button('−', () => {
            s.scores[a] -= 1;
            this.render();
          }, s.scores[a] <= 8 ? 'Minimum 8' : undefined),
          h('span', 'num', String(s.scores[a])),
          button('+', () => {
            s.scores[a] += 1;
            this.render();
          }, s.scores[a] >= 15 || (pointBuyCost({ ...s.scores, [a]: s.scores[a] + 1 }) ?? 99) > POINT_BUY_BUDGET ? 'No points left' : undefined),
        );
      } else {
        // pick a value from the pool; picking one that another ability holds swaps them
        const holder = (i: number) => ABILITIES.find((b) => indexIn(d.pool, s.scores, b) === i);
        control = select(
          d.pool.map((v, i) => {
            const who = holder(i);
            return { value: String(i), label: who && who !== a ? `${v}  (swap with ${who.toUpperCase()})` : String(v) };
          }),
          String(indexIn(d.pool, s.scores, a)),
          (v) => {
            const i = Number(v);
            const other = ABILITIES.find((b) => b !== a && indexIn(d.pool, s.scores, b) === i);
            const mine = s.scores[a];
            s.scores[a] = d.pool[i];
            if (other) s.scores[other] = mine;
            this.render();
          },
          locked,
        );
      }
      const inc = s.increases[a] ?? 0;
      const primary = characterData.classes[s.classId]?.primary.includes(a);
      return h(
        'tr',
        primary ? 'primary' : '',
        h('td', '', ABILITY_NAMES[a] + (primary ? ' ★' : '')),
        h('td', '', control),
        h('td', 'num muted', inc ? `+${inc}` : ''),
        h('td', 'num', String(final(a))),
        h('td', 'num', signed(abilityMod(final(a)))),
      );
    });
    return div(
      'ps-abilities',
      h('h3', '', 'Ability scores'),
      tabs,
      d.method === 'points'
        ? h('div', 'small', `Points spent: ${spent ?? '?'} / ${POINT_BUY_BUDGET}`)
        : h(
            'div',
            'small',
            `Your six values: ${d.pool.join(', ')}. Each ability takes one; picking a value another ability has swaps the two.`,
          ),
      h('table', 'ps-scores', h('tr', '', h('th', '', ''), h('th', '', 'Base'), h('th', 'num', 'Bg'), h('th', 'num', 'Score'), h('th', 'num', 'Mod')), ...rows),
      h('div', 'small muted', '★ = the class’s primary ability. Scores are suggested for the class; change any of them.'),
    );
  }

  private applyIncreases(d: Draft): void {
    const bg = characterData.backgrounds[d.sheet.backgroundId];
    if (!bg.abilities.includes(d.plus2)) d.plus2 = bg.abilities[0];
    if (!bg.abilities.includes(d.plus1) || d.plus1 === d.plus2) d.plus1 = bg.abilities.find((a) => a !== d.plus2)!;
    d.sheet.increases =
      d.incMode === 'spread'
        ? Object.fromEntries(bg.abilities.map((a) => [a, 1]))
        : { [d.plus2]: 2, [d.plus1]: 1 };
  }

  private portrait(key: string, px: number): HTMLElement {
    const p = div('portrait');
    p.style.width = p.style.height = `${px}px`;
    const s = this.deps.spriteCss(key);
    if (!s) return p;
    const scale = px / s.frameWidth;
    Object.assign(p.style, {
      backgroundImage: `url(${s.url})`,
      backgroundSize: `${s.sheetCols * px}px ${s.sheetRows * px}px`,
      backgroundPosition: `-${s.col * s.frameWidth * scale}px -${s.row * s.frameWidth * scale}px`,
    });
    return p;
  }
}

const byValue = (pool: readonly number[]): number[] => [...pool].sort((x, y) => y - x);

/** Put the biggest values into the class's primary abilities, then Con, then the rest. */
function suggest(classId: string, pool: readonly number[]): AbilityScores {
  const primary = characterData.classes[classId]?.primary ?? ['str'];
  const order: Ability[] = [...primary, 'con', 'dex', 'wis', 'str', 'int', 'cha'].filter(
    (a, i, arr) => arr.indexOf(a) === i,
  ) as Ability[];
  const sorted = [...pool].sort((a, b) => b - a);
  const out = {} as AbilityScores;
  order.forEach((a, i) => (out[a] = sorted[i]));
  return out;
}

/** Which pool slot an ability's score came from (first unused match). */
function indexIn(pool: readonly number[], scores: AbilityScores, a: Ability): number {
  const used = new Set<number>();
  for (const b of ABILITIES) {
    const i = pool.findIndex((v, k) => v === scores[b] && !used.has(k));
    used.add(i);
    if (b === a) return i;
  }
  return -1;
}

// --- tiny DOM helpers (text via textContent only) ---------------------------

function h(tag: string, cls: string, ...children: (Node | string | null)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c !== null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
const div = (cls: string, ...children: (Node | string | null)[]) => h('div', cls, ...children);

function button(label: string, onClick: () => void, disabledReason?: string, cls = ''): HTMLButtonElement {
  const b = h('button', cls, label) as HTMLButtonElement;
  if (disabledReason) {
    b.disabled = true;
    b.title = disabledReason;
  } else b.addEventListener('click', onClick);
  return b;
}

function select(
  options: { value: string; label: string; disabled?: boolean }[],
  value: string,
  onChange: (v: string) => void,
  disabled = false,
): HTMLSelectElement {
  const s = h('select', '') as HTMLSelectElement;
  for (const o of options) {
    const opt = h('option', '', o.label) as HTMLOptionElement;
    opt.value = o.value;
    opt.disabled = !!o.disabled;
    s.append(opt);
  }
  s.value = value;
  s.disabled = disabled;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function radio(name: string, value: string, checked: boolean, label: string, onPick: () => void, disabled: boolean): HTMLElement {
  const input = h('input', '') as HTMLInputElement;
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', onPick);
  return h('label', 'ps-radio', input, label);
}

const field = (label: string, control: HTMLElement) => h('label', 'ps-field', h('span', 'small muted', label), control);
