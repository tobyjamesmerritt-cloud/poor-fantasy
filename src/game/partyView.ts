/** Party rows for the HTML panels, from the persistent party state. */
import type * as Phaser from 'phaser';
import type { GameState } from '../engine/state';
import { className, membersOf } from '../content/characters';
import type { PartyRow, RosterEntry } from '../ui/hud';
import { spriteCss } from './spriteCss';

export function partyRows(game: GameState): PartyRow[] {
  return membersOf(game.roster).map((p) => {
    const s = game.party.find((x) => x.id === p.id);
    const hp = s?.hp ?? p.hp;
    return {
      name: p.name,
      ac: p.ac,
      hp,
      maxHp: p.hp,
      hitDice: `${s?.hitDice ?? 1}d${p.hitDie}`,
      state: s?.dead ? 'dead' : hp <= 0 ? 'out' : 'ok',
    };
  });
}

export function rosterEntries(textures: Phaser.Textures.TextureManager, game: GameState): RosterEntry[] {
  const rows = partyRows(game);
  return game.roster.map((p, i) => ({ ...rows[i], sprite: spriteCss(textures, p.sprite), cls: className(p) }));
}
