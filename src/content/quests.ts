/**
 * Quest content loader: src/content/quests.json, validated at load against
 * encounters, locations and items. Also the helpers the quest engine needs
 * from content (item names, random loot, a character's check bonus).
 */
import type { Rng } from '../engine/rng';
import type { Ability, CharacterSheet } from '../engine/state';
import { proficiencyBonus } from '../rules/character';
import { itemInfo, lootKindOk, rollLoot } from '../rules/items';
import { type ActionContext, type CheckRoller, type QuestData, validateQuests } from '../rules/quests';
import { characterData, derive } from './characters';
import { encounters, locationContent } from './encounters';
import raw from './quests.json';

const strip = <T>(r: unknown): T => {
  const { _note: _ignored, ...rest } = r as Record<string, unknown>;
  return rest as T;
};

export const questData: QuestData = strip<QuestData>(raw);

const errors = validateQuests(questData, {
  encounters: Object.keys(encounters),
  locations: Object.keys(locationContent),
  isItem: (ref) => (ref.startsWith('random:') ? lootKindOk(ref.slice(7), characterData) : !!itemInfo(ref, characterData)),
});
for (const h of questData.hooks) {
  const [loc] = h.at.split('/');
  if (!h.at.startsWith('site:') && !locationContent[loc]) errors.push(`hook "${h.at}": unknown location "${loc}"`);
}
if (errors.length) throw new Error('Invalid quests.json:\n- ' + errors.join('\n- '));

export const itemName = (ref: string): string => itemInfo(ref, characterData)?.name ?? ref;

export const questContext = (rng: Rng): ActionContext => ({
  rng,
  data: questData,
  loot: (kind, r) => rollLoot(kind, r, characterData),
  itemName,
});

/** A character's bonus for an ability check: modifier, + Proficiency Bonus if their background gives the skill (SRD 5.2). */
export function checkRoller(sheet: CharacterSheet, ability: Ability, skill?: string): CheckRoller & { proficient: boolean } {
  const d = derive(sheet);
  const proficient = !!skill && characterData.backgrounds[sheet.backgroundId].skills.includes(skill);
  return { name: sheet.name, bonus: Math.floor((d.scores[ability] - 10) / 2) + (proficient ? proficiencyBonus(sheet.level) : 0), proficient };
}
