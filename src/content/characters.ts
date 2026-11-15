/**
 * Character content: SRD 5.2 classes, species, backgrounds and gear, the
 * quick-start party, and the bridge from character sheets to the stats that
 * combat and resting use. Validated at load.
 */
import type { CharacterSheet } from '../engine/state';
import {
  type CharacterData,
  deriveStats,
  type DerivedStats,
  startingCopper,
  validateSheet,
} from '../rules/character';
import type { MemberStats } from '../rules/party';
import { assets } from './assets';
import backgroundsRaw from './backgrounds.json';
import classesRaw from './classes.json';
import gearRaw from './gear.json';
import partyRaw from './party.json';
import speciesRaw from './species.json';

const strip = <T>(raw: unknown): T => {
  const { _note: _ignored, ...rest } = raw as Record<string, unknown>;
  return rest as T;
};

export { MAX_PARTY } from '../rules/roster';

export const characterData: CharacterData = (() => {
  const gear = strip<Pick<CharacterData, 'armor' | 'shield' | 'weapons' | 'consumables'>>(gearRaw);
  const data: CharacterData = {
    classes: strip(classesRaw),
    species: strip(speciesRaw),
    backgrounds: strip(backgroundsRaw),
    armor: gear.armor,
    shield: gear.shield,
    weapons: gear.weapons,
    consumables: gear.consumables,
  };
  const errors: string[] = [];
  for (const [id, c] of Object.entries(data.classes)) {
    if (c.kit.armor && !data.armor[c.kit.armor]) errors.push(`class ${id}: unknown armor "${c.kit.armor}"`);
    if (!data.weapons[c.kit.weapon]) errors.push(`class ${id}: unknown weapon "${c.kit.weapon}"`);
  }
  if (errors.length) throw new Error('Invalid character data:\n- ' + errors.join('\n- '));
  return data;
})();

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
}

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
    medicine: d.medicine,
    hitDie: d.hitDie,
    conMod: d.conMod,
  };
}

export const membersOf = (roster: readonly CharacterSheet[]): PartyMemberDef[] => roster.map(memberOf);

export const statsOf = (roster: readonly CharacterSheet[]): MemberStats[] =>
  membersOf(roster).map((m, i) => ({ id: m.id, name: m.name, hp: m.hp, hitDie: m.hitDie, conMod: m.conMod, level: roster[i].level }));

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
