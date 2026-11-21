/**
 * Debug flag editor model (the About dialog's "Quest flags"): which flags and
 * quest stages exist, grouped under the quest they belong to (flag prefix =
 * quest id, e.g. `troll:moved` under quest `troll`), plus pure toggles.
 * Pure: the UI only draws it. Test cheat — it changes progress directly.
 */
import type { QuestData } from './quests';

type Flags = Record<string, unknown>;

export interface FlagRow {
  key: string;
  label: string; // the key without its group prefix
  on: boolean;
}

export interface FlagGroup {
  id: string;
  title: string;
  quest?: { id: string; stage: string; stages: string[] }; // stage choices, 'none' first
  flags: FlagRow[];
}

/** Every flag name quests.json sets, clears or tests. */
export function knownFlags(data: QuestData): string[] {
  const found = new Set<string>();
  for (const m of JSON.stringify(data).matchAll(/"(?:set|unset|flag)":"([^"]+)"/g)) found.add(m[1]);
  return [...found];
}

const prefixOf = (key: string): string => (key.includes(':') ? key.slice(0, key.indexOf(':')) : 'misc');

export function flagGroups(data: QuestData, flags: Flags): FlagGroup[] {
  const keys = new Set([...knownFlags(data), ...Object.keys(flags)].filter((k) => !k.startsWith('quest:')));
  const byPrefix = new Map<string, string[]>();
  for (const k of [...keys].sort()) byPrefix.set(prefixOf(k), [...(byPrefix.get(prefixOf(k)) ?? []), k]);
  const row = (k: string): FlagRow => ({ key: k, label: k.includes(':') ? k.slice(k.indexOf(':') + 1) : k, on: !!flags[k] });

  const out: FlagGroup[] = [];
  for (const [id, q] of Object.entries(data.quests)) {
    out.push({
      id,
      title: q.name,
      quest: { id, stage: typeof flags[`quest:${id}`] === 'string' ? (flags[`quest:${id}`] as string) : 'none', stages: ['none', ...Object.keys(q.stages)] },
      flags: (byPrefix.get(id) ?? []).map(row),
    });
    byPrefix.delete(id);
  }
  for (const [id, ks] of [...byPrefix].sort(([a], [b]) => a.localeCompare(b))) out.push({ id, title: `${id}:`, flags: ks.map(row) });
  return out;
}

/** Flip a flag on/off (on = true, off = deleted). Returns the new state. */
export function toggleFlag(flags: Flags, key: string): boolean {
  if (flags[key]) {
    delete flags[key];
    return false;
  }
  flags[key] = true;
  return true;
}

/** Jump a quest to a stage ('none' = not started). Writes only the stage flag, no rewards. */
export function setQuestStage(flags: Flags, quest: string, stage: string): void {
  if (stage === 'none') delete flags[`quest:${quest}`];
  else flags[`quest:${quest}`] = stage;
}
