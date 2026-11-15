/**
 * Resting and camping (SRD 5.2 "Short Rest", "Long Rest", "Lodging").
 *
 * Short Rest: 1 hour. Spend Hit Point Dice: roll the die + Constitution
 *   modifier, regain that many HP (minimum 1). Interrupted: no benefit.
 * Long Rest: 8 hours. Regain all HP and all spent Hit Point Dice. You need at
 *   least 1 HP to benefit, and must wait 16 hours after finishing one before
 *   starting another. Interrupted after at least 1 hour: Short Rest benefits.
 * Inn: a Modest room costs 5 sp per person per night; no ambushes in town.
 * Camping outside is free but risky (house rule: chance of an ambush per rest,
 *   by terrain; a Short Rest carries a quarter of the Long Rest risk).
 */
import type { PartyMemberState } from '../engine/state';
import type { Rng } from '../engine/rng';
import { levelOf, type MemberStats, nameOf, passTime } from './party';

export type RestKind = 'short' | 'long';
export type SiteKind = 'forest' | 'meadow' | 'rocks' | 'riverside' | 'cave' | 'ruins' | 'inn';

export interface CampSite {
  kind: SiteKind;
  name: string; // "Forest camp", "The Leaky Bucket"
  risk: number; // chance of an ambush during a Long Rest, 0–1 (0 at inns)
  ambush?: string; // encounter id used if the camp is attacked
}

export const REST_MINUTES: Record<RestKind, number> = { short: 60, long: 8 * 60 };
export const LONG_REST_GAP = 16 * 60;
export const LODGING_CP = 50; // SRD 5.2 Inn Stay per Day, Modest: 5 SP

export const isInn = (site: CampSite): boolean => site.kind === 'inn';

/** Ambush risk for outdoor camps, per Long Rest (house rule). */
export const SITE_RISK: Record<Exclude<SiteKind, 'inn'>, number> = {
  meadow: 0.2,
  riverside: 0.2,
  forest: 0.25,
  rocks: 0.25,
  cave: 0.35,
  ruins: 0.35,
};

export function innCost(party: readonly PartyMemberState[]): number {
  return party.filter((p) => !p.dead).length * LODGING_CP;
}

export interface RestInput {
  party: PartyMemberState[];
  stats: readonly MemberStats[];
  now: number;
  lastLongRest: number | null;
  coins: number;
  site: CampSite;
}

export function canRest(kind: RestKind, r: RestInput): { ok: true } | { ok: false; reason: string } {
  if (!r.party.some((p) => !p.dead && p.hp > 0)) return { ok: false, reason: 'Nobody is awake to keep watch.' };
  if (kind === 'long' && r.lastLongRest !== null && r.now < r.lastLongRest + LONG_REST_GAP) {
    const wait = r.lastLongRest + LONG_REST_GAP - r.now;
    return { ok: false, reason: `Too soon for another long rest — wait ${Math.ceil(wait / 60)} more hours.` };
  }
  if (kind === 'long' && isInn(r.site) && r.coins < innCost(r.party)) {
    return { ok: false, reason: 'You cannot afford rooms for the night.' };
  }
  return { ok: true };
}

export interface RestResult {
  minutes: number; // time that passed
  coinsSpent: number;
  completed: boolean;
  ambushAt: number | null; // minutes into the rest when the camp was attacked
  lastLongRest: number | null;
  log: string[];
}

/** Rest in place, mutating the party. Roll for an ambush first, then apply what the rest achieved. */
export function rest(kind: RestKind, r: RestInput, rng: Rng): RestResult {
  const duration = REST_MINUTES[kind];
  const log: string[] = [];
  const coinsSpent = kind === 'long' && isInn(r.site) ? innCost(r.party) : 0;
  if (coinsSpent) log.push(`You pay for rooms at ${r.site.name}.`);

  let ambushAt: number | null = null;
  if (!isInn(r.site) && r.site.risk > 0) {
    const chance = kind === 'long' ? r.site.risk : r.site.risk / 4;
    if (rng.int(1, 100) <= Math.round(chance * 100)) ambushAt = rng.int(1, duration - 1);
  }
  const elapsed = ambushAt ?? duration;
  const eligible = new Set(r.party.filter((p) => !p.dead && p.hp > 0).map((p) => p.id)); // need 1 HP to start
  const woke = passTime(r.party, r.stats, r.now + elapsed);
  for (const name of woke) log.push(`${name} comes round (1 HP).`);

  const benefit: RestKind | null = ambushAt === null ? kind : kind === 'long' && elapsed >= 60 ? 'short' : null;
  if (benefit === 'long') {
    for (const p of r.party) {
      if (!eligible.has(p.id)) continue;
      const s = statsOf(r.stats, p.id);
      p.hp = s.hp;
      p.hitDice = levelOf(s);
    }
    log.push('The party wakes refreshed: hit points and Hit Dice restored.');
  } else if (benefit === 'short') {
    for (const p of r.party) {
      if (!eligible.has(p.id)) continue;
      spendHitDice(p, statsOf(r.stats, p.id), rng, log);
    }
    if (kind === 'long') log.push('The rest was cut short, but the first hour still did some good.');
  }

  if (ambushAt !== null) {
    const h = Math.floor(ambushAt / 60);
    const m = ambushAt % 60;
    log.push(`Ambush! The camp is attacked ${h ? `${h} h ` : ''}${m} min into the rest.`);
  }
  return {
    minutes: elapsed,
    coinsSpent,
    completed: ambushAt === null,
    ambushAt,
    lastLongRest: benefit === 'long' ? r.now + duration : r.lastLongRest,
    log,
  };
}

/** Spend Hit Point Dice one at a time while hurt (SRD 5.2: die + Con modifier, minimum 1). */
export function spendHitDice(p: PartyMemberState, s: MemberStats, rng: Rng, log: string[]): void {
  while (p.hitDice > 0 && p.hp < s.hp) {
    const roll = rng.int(1, s.hitDie);
    const gain = Math.max(1, roll + s.conMod);
    const before = p.hp;
    p.hp = Math.min(s.hp, p.hp + gain);
    p.hitDice -= 1;
    log.push(`${s.name} spends a Hit Die (d${s.hitDie} ${roll}${signed(s.conMod)}): ${before} → ${p.hp} HP.`);
  }
}

function statsOf(stats: readonly MemberStats[], id: string): MemberStats {
  const s = stats.find((x) => x.id === id);
  if (!s) throw new Error(`No stats for ${nameOf(stats, id)}`);
  return s;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
