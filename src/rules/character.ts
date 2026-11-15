/**
 * Character creation and derived stats (SRD 5.2 "Creating a Character",
 * "Character Origins", "Equipment"). Pure TypeScript: class / species /
 * background / gear data is passed in (content/characters.ts loads it).
 *
 * Built so the other SRD classes, species traits and feats can be added as
 * data + small rule functions later: every class/species/background carries
 * its full SRD facts even where the game doesn't use them yet.
 */
import type { Rng } from '../engine/rng';
import type { Ability, AbilityScores, CharacterSheet, Gear } from '../engine/state';

export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

// ---------------------------------------------------------------------------
// Data shapes (content JSON)
// ---------------------------------------------------------------------------

export interface ClassDef {
  name: string;
  hitDie: number; // d10 = 10
  primary: Ability[]; // SRD "Primary Ability"
  saves: Ability[]; // saving throw proficiencies (not used yet)
  armorTraining: string[]; // light | medium | heavy | shields
  kit: { armor: string | null; shield: boolean; weapon: string; gp: number }; // starting equipment option A (combat-relevant part)
  weaponTraining: ('simple' | 'martial' | 'martial-finesse-light')[];
  playable: boolean; // false = data only, not offered yet
  features?: string[]; // level-1 features by name (not in effect yet unless noted in rules)
  featuresByLevel?: Record<string, string[]>; // level → feature names gained
}

export interface SpeciesDef {
  name: string;
  speed: number; // feet
  size: 'Small' | 'Medium' | 'Small or Medium';
  traits: string[]; // names; effects not applied yet
}

export interface BackgroundDef {
  name: string;
  abilities: [Ability, Ability, Ability]; // may be increased
  feat: string; // Origin feat
  skills: string[];
  gp: number; // equipment option A coins
}

export interface ArmorDef {
  name: string;
  category: 'light' | 'medium' | 'heavy';
  cost: number; // copper
  base: number;
  dexMax: number | null; // null = full Dex modifier; 0 = none
  strength?: number; // heavy armor: Speed −10 ft if Strength is lower
}

export interface WeaponDef {
  name: string;
  category: 'simple' | 'martial';
  cost: number; // copper
  damage: string; // e.g. "1d8"
  finesse?: boolean;
  light?: boolean;
}

export interface ConsumableDef {
  name: string;
  heal: string; // dice, e.g. "2d4+2"
  cost: number;
}

export interface CharacterData {
  classes: Record<string, ClassDef>;
  species: Record<string, SpeciesDef>;
  backgrounds: Record<string, BackgroundDef>;
  armor: Record<string, ArmorDef>;
  shield: { name: string; cost: number };
  weapons: Record<string, WeaponDef>;
  consumables: Record<string, ConsumableDef>;
}

/** What a character has equipped: their own choice, or the class kit until they change it. */
export function equipped(sheet: CharacterSheet, data: CharacterData): Gear {
  const kit = data.classes[sheet.classId].kit;
  return sheet.gear ?? { armor: kit.armor, shield: kit.shield, weapon: kit.weapon };
}

/** SRD 5.2 armor training (light / medium / heavy / shields). */
export function trainedWithArmor(cls: ClassDef, armor: ArmorDef | 'shield'): boolean {
  return cls.armorTraining.includes(armor === 'shield' ? 'shields' : armor.category);
}

/** SRD 5.2 weapon proficiency: Simple, Martial, or (Rogue) Martial with Finesse or Light. */
export function trainedWithWeapon(cls: ClassDef, w: WeaponDef): boolean {
  if (w.category === 'simple') return cls.weaponTraining.includes('simple');
  return cls.weaponTraining.includes('martial') || (cls.weaponTraining.includes('martial-finesse-light') && !!(w.finesse || w.light));
}

// ---------------------------------------------------------------------------
// Ability scores
// ---------------------------------------------------------------------------

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);
export const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** SRD 5.2 "Standard Array". */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** SRD 5.2 "Point Cost": scores 8–15, 27 points. */
export const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function pointBuyCost(scores: AbilityScores): number | null {
  let total = 0;
  for (const a of ABILITIES) {
    const c = POINT_COST[scores[a]];
    if (c === undefined) return null; // outside 8–15
    total += c;
  }
  return total;
}

/** SRD 5.2 "Random Generation": roll four d6, drop the lowest, six times. */
export function roll4d6DropLowest(rng: Rng): number[] {
  return Array.from({ length: 6 }, () => {
    const dice = [rng.int(1, 6), rng.int(1, 6), rng.int(1, 6), rng.int(1, 6)].sort((a, b) => b - a);
    return dice[0] + dice[1] + dice[2];
  });
}

/** Background increases: +2 and +1 to two listed abilities, or +1 to all three; nothing above 20. */
export function checkIncreases(bg: BackgroundDef, inc: Partial<AbilityScores>): string | null {
  const entries = Object.entries(inc).filter(([, v]) => v);
  for (const [a] of entries) {
    if (!bg.abilities.includes(a as Ability)) return `${bg.name} can't raise ${ABILITY_NAMES[a as Ability]}.`;
  }
  const values = entries.map(([, v]) => v).sort();
  const ok = (values.length === 2 && values[0] === 1 && values[1] === 2) || (values.length === 3 && values.every((v) => v === 1));
  return ok ? null : 'Choose +2 and +1, or +1 to all three.';
}

/** Scores after background increases and any Ability Score Improvements (none above 20). */
export function finalScores(sheet: Pick<CharacterSheet, 'scores' | 'increases' | 'asi'>): AbilityScores {
  const out = { ...sheet.scores };
  for (const a of ABILITIES) out[a] = Math.min(20, out[a] + (sheet.increases[a] ?? 0) + (sheet.asi?.[a] ?? 0));
  return out;
}

/** Highest level the game supports so far. */
export const MAX_LEVEL = 5;

/** SRD 5.2 Proficiency Bonus by level: +2 at 1–4, +3 at 5–8, … */
export const proficiencyBonus = (level: number): number => 2 + Math.floor((level - 1) / 4);

/** SRD 5.2: the fixed Hit Point increase per level instead of rolling (die / 2 + 1). */
export const averageHitDie = (die: number): number => die / 2 + 1;

// ---------------------------------------------------------------------------
// Validation and derived stats
// ---------------------------------------------------------------------------

export function validateSheet(sheet: CharacterSheet, data: CharacterData): string[] {
  const errors: string[] = [];
  if (!sheet.name.trim()) errors.push('Give the character a name.');
  if (sheet.name.length > 24) errors.push('Names can be at most 24 characters.');
  const cls = data.classes[sheet.classId];
  if (!cls) errors.push(`Unknown class "${sheet.classId}".`);
  else if (!cls.playable) errors.push(`${cls.name} isn't playable yet.`);
  if (!data.species[sheet.speciesId]) errors.push(`Unknown species "${sheet.speciesId}".`);
  const bg = data.backgrounds[sheet.backgroundId];
  if (!bg) errors.push(`Unknown background "${sheet.backgroundId}".`);
  for (const a of ABILITIES) {
    const v = sheet.scores[a];
    if (!Number.isInteger(v) || v < 3 || v > 18) errors.push(`${ABILITY_NAMES[a]} must be 3–18 before increases.`);
  }
  if (bg) {
    const why = checkIncreases(bg, sheet.increases);
    if (why) errors.push(why);
  }
  if (!Number.isInteger(sheet.level) || sheet.level < 1 || sheet.level > MAX_LEVEL) errors.push(`Level must be 1–${MAX_LEVEL}.`);
  if (cls && (sheet.hpGains?.length ?? 0) !== sheet.level - 1) errors.push('Hit point increases don’t match the level.');
  if (cls && sheet.hpGains?.some((g) => !Number.isInteger(g) || g < 1 || g > cls.hitDie)) errors.push('A hit point increase is out of range.');
  const asiTotal = Object.values(sheet.asi ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  if (asiTotal > (sheet.level >= 4 ? 2 : 0)) errors.push('Too many Ability Score Improvements for this level.');
  return errors;
}

/** Everything combat and resting need, derived from the sheet (level 1). */
export interface DerivedStats {
  hp: number;
  ac: number;
  speed: number; // squares (5 ft)
  initBonus: number;
  attackName: string;
  attackBonus: number;
  damage: string[];
  medicine: number;
  hitDie: number;
  conMod: number;
  scores: AbilityScores;
  notes: string[]; // e.g. "Chain Mail: Speed −10 ft (Strength 13 needed)"
}

export const PROFICIENCY_BONUS_L1 = 2;

/** Species traits and feats that already change the numbers (the rest are listed but not in effect yet). */
export const IMPLEMENTED: readonly string[] = ['Alert', 'Dwarven Toughness', 'Ability Score Improvement'];

export function deriveStats(sheet: CharacterSheet, data: CharacterData): DerivedStats {
  const cls = data.classes[sheet.classId];
  const species = data.species[sheet.speciesId];
  const bg = data.backgrounds[sheet.backgroundId];
  const s = finalScores(sheet);
  const mod = (a: Ability) => abilityMod(s[a]);
  const notes: string[] = [];

  // Hit Points at level 1: Hit Point Die maximum + Con modifier (minimum 1).
  // Hit Points: level 1 = Hit Die max + Con; each later level = the recorded die result + Con (min 1).
  let hp = Math.max(1, cls.hitDie + mod('con'));
  for (const g of sheet.hpGains ?? []) hp += Math.max(1, g + mod('con'));
  if (species.traits.includes('Dwarven Toughness')) hp += sheet.level; // +1 HP per level

  // Armor Class: armor base + Dex (capped by armor), +2 shield; unarmored 10 + Dex.
  const gear = equipped(sheet, data);
  const armor = gear.armor ? data.armor[gear.armor] : null;
  let ac = 10 + mod('dex');
  if (armor) ac = armor.base + (armor.dexMax === null ? mod('dex') : Math.min(armor.dexMax, mod('dex')));
  if (gear.shield && trainedWithArmor(cls, 'shield')) ac += 2; // SRD 5.2: shield AC only with training

  // Speed: species; heavy armor without the Strength it needs costs 10 ft.
  let speedFt = species.speed;
  if (armor?.strength && s.str < armor.strength) {
    speedFt -= 10;
    notes.push(`${armor.name}: Speed −10 ft (needs Strength ${armor.strength}).`);
  }

  // Weapon attack: Strength, or Dexterity for a Finesse weapon if better; proficient with class kit.
  const weapon = data.weapons[gear.weapon];
  const useDex = !!weapon.finesse && mod('dex') > mod('str');
  const atkMod = useDex ? mod('dex') : mod('str');
  const proficient = trainedWithWeapon(cls, weapon);
  const pb = proficiencyBonus(sheet.level);
  if (!proficient) notes.push(`${weapon.name}: not trained — no proficiency bonus to hit.`);
  const damage = [`${weapon.damage}${atkMod ? signed(atkMod) : ''}`];

  // Initiative: Dex modifier; the Alert origin feat adds the Proficiency Bonus.
  let initBonus = mod('dex');
  if (bg.feat === 'Alert') initBonus += proficiencyBonus(sheet.level);

  return {
    hp,
    ac,
    speed: Math.floor(speedFt / 5),
    initBonus,
    attackName: weapon.name,
    attackBonus: atkMod + (proficient ? pb : 0),
    damage,
    medicine: mod('wis'),
    hitDie: cls.hitDie,
    conMod: mod('con'),
    scores: s,
    notes,
  };
}

/** Coins a new character brings: class + background equipment option A (SRD 5.2). */
export function startingCopper(sheet: CharacterSheet, data: CharacterData): number {
  return (data.classes[sheet.classId].kit.gp + data.backgrounds[sheet.backgroundId].gp) * 100;
}
