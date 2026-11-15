/**
 * Temple services (house rules; prices from content/services.json).
 * Healing restores every wounded living character to full HP (and wakes the
 * unconscious). Raising the dead returns a character with 1 HP.
 */
import type { PartyMemberState } from '../engine/state';
import type { MemberStats } from './party';

export interface TemplePrices {
  healPerCharacter: number;
  raiseDead: number;
}

const maxHp = (stats: readonly MemberStats[], id: string) => stats.find((s) => s.id === id)?.hp ?? 0;

export function wounded(party: readonly PartyMemberState[], stats: readonly MemberStats[]): PartyMemberState[] {
  return party.filter((p) => !p.dead && p.hp < maxHp(stats, p.id));
}

export const healCost = (party: readonly PartyMemberState[], stats: readonly MemberStats[], prices: TemplePrices): number =>
  wounded(party, stats).length * prices.healPerCharacter;

export function templeHeal(
  purse: { coins: number },
  party: PartyMemberState[],
  stats: readonly MemberStats[],
  prices: TemplePrices,
): string | null {
  const cost = healCost(party, stats, prices);
  if (!cost) return 'Nobody needs healing.';
  if (purse.coins < cost) return 'You can’t afford the healing.';
  purse.coins -= cost;
  for (const p of wounded(party, stats)) Object.assign(p, { hp: maxHp(stats, p.id), wakesAt: null });
  return null;
}

export function templeRaise(purse: { coins: number }, p: PartyMemberState, prices: TemplePrices): string | null {
  if (!p.dead) return 'They are not dead.';
  if (purse.coins < prices.raiseDead) return 'You can’t afford the offering.';
  purse.coins -= prices.raiseDead;
  Object.assign(p, { dead: false, hp: 1, wakesAt: null });
  return null;
}
