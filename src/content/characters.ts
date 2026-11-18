/**
 * Character content: SRD 5.2 classes, species, backgrounds and gear, the
 * quick-start party, and the bridge from character sheets to the stats that
 * combat and resting use. Validated at load.
 */
import { parseDice } from '../engine/dice';
import type { Ability, CharacterSheet } from '../engine/state';
import {
  type CharacterData,
  deriveStats,
  type DerivedStats,
  equipped,
  proficiencyBonus,
  startingCopper,
  validateSheet,
} from '../rules/character';
import type { CasterInfo } from '../rules/combat';
import type { MemberStats } from '../rules/party';
import { casterInfo, type SpellDef, spellChoices, type Spells } from '../rules/spells';
import { assets } from './assets';
import backgroundsRaw from './backgrounds.json';
import classesRaw from './classes.json';
import gearRaw from './gear.json';
import partyRaw from './party.json';
import speciesRaw from './species.json';
import spellsRaw from './spells.json';
import { type CombatFeatures, combatFeatures } from '../rules/features';
import type { WeaponOption } from '../rules/combat';

const strip = <T>(raw: unknown): T => {
  const { _note: _ignored, ...rest } = raw as Record<string, unknown>;
  return rest as T;
};

export { MAX_PARTY } from '../rules/roster';

export const characterData: CharacterData = (() => {
  const gear = strip<Pick<CharacterData, 'armor' | 'shield' | 'weapons' | 'consumables' | 'misc'>>(gearRaw);
  const data: CharacterData = {
    classes: strip(classesRaw),
    species: strip(speciesRaw),
    backgrounds: strip(backgroundsRaw),
    armor: gear.armor,
    shield: gear.shield,
    weapons: gear.weapons,
    consumables: gear.consumables,
    misc: gear.misc,
    spells: strip<Spells>(spellsRaw),
  };
  const errors: string[] = [];
  for (const [id, c] of Object.entries(data.classes)) {
    if (c.kit.armor && !data.armor[c.kit.armor]) errors.push(`class ${id}: unknown armor "${c.kit.armor}"`);
    if (!data.weapons[c.kit.weapon]) errors.push(`class ${id}: unknown weapon "${c.kit.weapon}"`);
    const sc = c.spellcasting;
    if (sc) {
      const rec = [...sc.recommended.cantrips, ...sc.recommended.prepared, ...(sc.recommended.spellbook ?? [])];
      for (const s of rec) if (!data.spells[s]?.classes.includes(id)) errors.push(`class ${id}: recommended spell "${s}" isn't a ${c.name} spell`);
      for (const k of ['cantrips', 'prepared', 'slots'] as const) if (sc[k].length < 5) errors.push(`class ${id}: spellcasting.${k} needs levels 1-5`);
    }
  }
  // always-prepared and free spells (Paladin's Smite, Favored Enemy) must exist and be on the class list
  for (const [cid, cls] of Object.entries(data.classes)) {
    const sc = cls.spellcasting;
    for (const ref of [...(sc?.always ?? []).map((a) => a.spell), ...(sc?.free ?? []).map((f) => f.spell)]) {
      if (!data.spells[ref]?.classes.includes(cid)) errors.push(`class "${cid}": spell "${ref}" is not a ${cid} spell in spells.json`);
    }
  }
  for (const [id, s] of Object.entries(data.spells)) errors.push(...checkSpell(id, s, data));
  if (errors.length) throw new Error('Invalid character data:\n- ' + errors.join('\n- '));
  return data;
})();

function checkSpell(id: string, s: SpellDef, data: CharacterData): string[] {
  const errors: string[] = [];
  const where = `spell "${id}"`;
  if (!Number.isInteger(s.level) || s.level < 0 || s.level > 9) errors.push(`${where}: bad level`);
  for (const c of s.classes) if (!data.classes[c]) errors.push(`${where}: unknown class "${c}"`);
  const e = s.effect as unknown as Record<string, unknown>;
  const after = e.after as Record<string, unknown> | undefined;
  const dice = [e.damage, e.dice, e.upcast, (e.burst as Record<string, unknown> | undefined)?.damage, after?.dice, after?.upcast].filter(
    (d): d is string => typeof d === 'string',
  );
  for (const d of dice) {
    try {
      parseDice(d);
    } catch {
      errors.push(`${where}: bad dice "${d}"`);
    }
  }
  const kinds = ['attack', 'save', 'missiles', 'heal', 'buff', 'stabilize', 'teleport', 'ward', 'temp-hp', 'mark', 'smite'];
  if (!kinds.includes(s.effect.kind)) errors.push(`${where}: unknown effect "${s.effect.kind}"`);
  return errors;
}

/** Portraits the party screen offers (sprite keys in assets.json). */
export const PORTRAITS: readonly string[] = Object.keys(assets.sprites).filter((k) => k.startsWith('hero') || ['fighter', 'paladin', 'rogue', 'cleric', 'ranger', 'wizard'].includes(k));

/** A party member as combat uses it (fixed stats for one fight). */
export interface PartyMemberDef {
  id: string;
  name: string;
  sprite: string;
  hp: number; // maximum
  ac: number;
  speed: number;
  initBonus: number;
  attackName: string;
  attackBonus: number;
  damage: string[];
  medicine: number;
  hitDie: number;
  conMod: number;
  saves: Record<Ability, number>;
  unarmoredAc?: number;
  caster?: CasterInfo; // slots are full here; buildUnits applies what has been spent
  features?: CombatFeatures; // class features that work in combat (rules/features.ts)
  finesse: boolean; // weapon in hand has Finesse
  damageType: string;
  species: string;
  weaponRef: string; // gear ref of the weapon in hand
  weapons?: WeaponOption[]; // what they can switch to in a fight (membersForFight)
}

/** The caster block for a sheet (undefined for classes without Spellcasting). */
export function casterOf(sheet: CharacterSheet): CasterInfo | undefined {
  const sc = characterData.classes[sheet.classId]?.spellcasting;
  if (!sc) return undefined;
  const d = derive(sheet);
  const info = casterInfo(sheet, sc, characterData.spells, d.scores[sc.ability], proficiencyBonus(sheet.level));
  // Life Domain, Disciple of Life (SRD 5.2): healing spells cast with a slot heal 2 + the slot's level more
  return d.features.includes('Cleric Subclass (Life Domain)') ? { ...info, discipleOfLife: true } : info;
}

/** Cantrips, spellbook and prepared spells, with the class's recommended picks filling any gaps. */
export const choicesOf = (sheet: CharacterSheet) => {
  const sc = characterData.classes[sheet.classId]?.spellcasting;
  return sc ? spellChoices(sheet, sc, characterData.spells) : null;
};

export const spells: Spells = characterData.spells;

export function checkSheet(sheet: CharacterSheet): string[] {
  const errors = validateSheet(sheet, characterData);
  if (!assets.sprites[sheet.sprite]) errors.push(`Unknown portrait "${sheet.sprite}".`);
  return errors;
}

export const derive = (sheet: CharacterSheet): DerivedStats => deriveStats(sheet, characterData);

export function memberOf(sheet: CharacterSheet): PartyMemberDef {
  const d = derive(sheet);
  return {
    id: sheet.id,
    name: sheet.name,
    sprite: sheet.sprite,
    hp: d.hp,
    ac: d.ac,
    speed: d.speed,
    initBonus: d.initBonus,
    attackName: d.attackName,
    attackBonus: d.attackBonus,
    damage: d.damage,
    finesse: d.finesse,
    damageType: d.damageType,
    species: sheet.speciesId,
    weaponRef: `weapon:${equipped(sheet, characterData).weapon}`,
    medicine: d.medicine,
    hitDie: d.hitDie,
    conMod: d.conMod,
    saves: d.saves,
    ...(d.unarmoredAc !== undefined ? { unarmoredAc: d.unarmoredAc } : {}),
    ...(casterOf(sheet) ? { caster: casterOf(sheet) } : {}),
    ...(() => {
      const f = combatFeatures(sheet.classId, sheet.level, d.features, d.finesse);
      return Object.keys(f).length ? { features: f } : {};
    })(),
  };
}

export const membersOf = (roster: readonly CharacterSheet[]): PartyMemberDef[] => roster.map(memberOf);

/**
 * Members for a fight, each with the weapons they could switch to: the one in
 * hand plus every weapon in the party pack (DND-24), with that weapon's numbers.
 */
export function membersForFight(roster: readonly CharacterSheet[], inventory: Record<string, number>): PartyMemberDef[] {
  const spare = Object.keys(inventory).filter((ref) => ref.startsWith('weapon:') && inventory[ref] > 0);
  return roster.map((sheet) => {
    const m = memberOf(sheet);
    const option = (ref: string, fromPack: boolean): WeaponOption => {
      const d = derive({ ...sheet, gear: { ...equipped(sheet, characterData), weapon: ref.slice(7) } });
      return { ref, name: d.attackName, attackBonus: d.attackBonus, damage: d.damage, finesse: d.finesse, damageType: d.damageType, fromPack };
    };
    const weapons = [option(m.weaponRef, false), ...spare.filter((r) => r !== m.weaponRef).map((r) => option(r, true))];
    return weapons.length > 1 ? { ...m, weapons } : m;
  });
}

export const statsOf = (roster: readonly CharacterSheet[]): MemberStats[] =>
  membersOf(roster).map((m, i) => {
    const sc = characterData.classes[roster[i].classId]?.spellcasting;
    return {
      id: m.id,
      name: m.name,
      hp: m.hp,
      hitDie: m.hitDie,
      conMod: m.conMod,
      level: roster[i].level,
      noArmor: !equipped(roster[i], characterData).armor,
      ...(m.caster && sc
        ? {
            caster: {
              classId: m.caster.classId,
              mod: m.caster.mod,
              maxSlots: m.caster.maxSlots,
              arcaneRecovery: !!sc.arcaneRecovery,
              prepared: m.caster.prepared,
              ...(m.caster.discipleOfLife ? { discipleOfLife: true } : {}),
            },
          }
        : {}),
    };
  });

export const startingCoins = (roster: readonly CharacterSheet[]): number =>
  roster.reduce((sum, s) => sum + startingCopper(s, characterData), 0);

export const className = (sheet: CharacterSheet): string => characterData.classes[sheet.classId]?.name ?? sheet.classId;

/** The quick-start party. */
export const pregens: readonly CharacterSheet[] = (() => {
  const sheets = (partyRaw as unknown as { members: CharacterSheet[] }).members;
  for (const s of sheets) {
    const errors = checkSheet(s);
    if (errors.length) throw new Error(`party.json "${s.name}":\n- ` + errors.join('\n- '));
  }
  return sheets;
})();
