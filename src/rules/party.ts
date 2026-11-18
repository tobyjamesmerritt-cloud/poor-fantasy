/**
 * The party between fights: HP, Hit Point Dice and deaths carry over.
 * Pure TypeScript; the fixed stats come from content/party.json.
 */
import type { PartyMemberState } from '../engine/state';
import type { Rng } from '../engine/rng';
import type { CombatState, RetreatRule } from './combat';
import { type CasterStats, spellsAfterCombat } from './spells';
import { usesSpent } from './features';

/** The fixed stats the rules need about a character. */
export interface MemberStats {
  id: string;
  name: string;
  hp: number; // Hit Point maximum
  hitDie: number; // die size, e.g. 10 for d10
  conMod: number;
  level?: number; // default 1; = number of Hit Point Dice
  caster?: CasterStats['caster']; // spellcasters
  noArmor?: boolean; // wears no armour (Mage Armor)
}

export const levelOf = (m: MemberStats): number => m.level ?? 1;

export function freshParty(stats: readonly MemberStats[]): PartyMemberState[] {
  return stats.map((m) => ({ id: m.id, hp: m.hp, hitDice: levelOf(m), dead: false, wakesAt: null }));
}

/** Can act: alive and at least 1 HP. */
export const isConscious = (p: PartyMemberState): boolean => !p.dead && p.hp > 0;

/**
 * Let time pass to `now`. Unconscious, stable characters regain 1 HP once
 * their 1d4 hours are up (SRD 5.2 "Death Saving Throws" → Stable).
 * Returns the names of anyone who woke.
 */
export function passTime(party: PartyMemberState[], stats: readonly MemberStats[], now: number): string[] {
  const woke: string[] = [];
  for (const p of party) {
    if (!p.dead && p.hp <= 0 && p.wakesAt !== null && now >= p.wakesAt) {
      p.hp = 1;
      p.wakesAt = null;
      woke.push(nameOf(stats, p.id));
    }
  }
  return woke;
}

/**
 * Copy the fight's results back onto the party.
 * - Fled from battle: characters left on the field are lost (Hard; on Normal
 *   only the dead can be left behind; on Casual everyone escapes).
 * - Anyone still unconscious is tended after the fight: stable, and wakes with
 *   1 HP after 1d4 hours.
 */
export function afterCombat(
  party: PartyMemberState[],
  stats: readonly MemberStats[],
  combat: CombatState,
  now: number,
  rng: Rng,
): string[] {
  const notes: string[] = [];
  for (const p of party) {
    const u = combat.units.find((x) => x.id === p.id);
    if (!u) continue; // not in this fight (already dead)
    const name = nameOf(stats, p.id);
    if (combat.outcome === 'fled' && !u.fled && !u.dead) {
      p.dead = true;
      p.hp = 0;
      p.wakesAt = null;
      notes.push(`${name} was left behind and is lost.`);
      continue;
    }
    p.hp = Math.max(0, u.hp);
    p.dead = u.dead;
    spellsAfterCombat(p, u, now);
    const spent = usesSpent(u.features?.uses, u.uses);
    if (spent) p.featureUses = spent;
    else delete p.featureUses;
    if (p.dead) {
      p.wakesAt = null;
      if (combat.outcome !== 'defeat') notes.push(`${name} is dead.`);
    } else if (p.hp <= 0) {
      const hours = rng.int(1, 4);
      p.wakesAt = now + hours * 60;
      notes.push(`${name} is unconscious but stable — they will come round in ${hours} hour${hours > 1 ? 's' : ''}.`);
    }
  }
  return notes;
}

/**
 * The whole party fell. Hard: the adventure is over. Normal / Casual (house
 * rule): passing pilgrims carry the survivors back to town — every living
 * character wakes with 1 HP, and half the purse is gone.
 */
export function afterDefeat(
  party: PartyMemberState[],
  coins: number,
  rule: RetreatRule,
): { gameOver: boolean; coins: number; notes: string[] } {
  if (rule === 'hard' || party.every((p) => p.dead)) {
    for (const p of party) Object.assign(p, { dead: true, hp: 0, wakesAt: null });
    return { gameOver: true, coins, notes: ['The party has perished. Their tale ends here.'] };
  }
  for (const p of party) if (!p.dead) Object.assign(p, { hp: Math.max(1, p.hp), wakesAt: null });
  return {
    gameOver: false,
    coins: Math.floor(coins / 2),
    notes: ['Passing pilgrims find the fallen party and carry them back toward Millbrook. Half your coin is gone.'],
  };
}

/** Combat rounds are 6 seconds; round up to whole minutes for the clock. */
export const combatMinutes = (rounds: number): number => Math.max(1, Math.ceil((rounds * 6) / 60));

/** "60 gp", "4 gp 5 sp", "7 cp" */
export function formatCoins(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  const parts = [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 cp';
}

export function nameOf(stats: readonly MemberStats[], id: string): string {
  return stats.find((s) => s.id === id)?.name ?? id;
}
