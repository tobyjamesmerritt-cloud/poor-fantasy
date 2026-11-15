/**
 * Player intent as commands, never raw keys. Keyboard, mouse, touch and
 * on-screen buttons all translate into these, so mobile support needs no
 * gameplay changes.
 */
import type { CharacterSheet } from './state';

export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type Command =
  | { type: 'move'; dir: Direction }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'turn'; dir: 'left' | 'right' | 'around' } // inside a location
  | { type: 'step'; dir: 'forward' | 'back' | 'left' | 'right' } // inside a location, keeps facing
  | { type: 'attack'; targetId: string }
  | { type: 'endTurn' }
  | { type: 'flee' } // leave the battle from a map-edge square
  | { type: 'usePotion'; targetId: string } // Potion of Healing: drink or give (Bonus Action)
  | { type: 'undo' } // rewind one player action (debug now; patron-god mechanic later, DND-27)
  | { type: 'fight'; encounter: string; origin?: string } // start an encounter (origin = map location id)
  | { type: 'newFight' } // rerun the current encounter with fresh dice
  | { type: 'restart' } // restart the current fight with the same dice
  | { type: 'worldMap' } // go to the world map
  | { type: 'enter'; location: string } // walk into a town or dungeon from the world map
  | { type: 'leaveLocation' } // back out to the world map
  | { type: 'endFight' }
  | { type: 'encamp' } // try to make camp where the party stands
  | { type: 'camp'; site: CampSiteRef } // open the camp screen (validated by the scene that sends it)
  | { type: 'rest'; kind: 'short' | 'long' }
  | { type: 'breakCamp' }
  | { type: 'partyScreen' } // open the party roster (menu, inn)
  | { type: 'newGame' } // start over: empty party screen
  | { type: 'readyMadeParty' } // fill the party with the pregenerated six (current members go to the bench)
  | { type: 'saveCharacter'; sheet: CharacterSheet } // create or update (validated by main.ts)
  | { type: 'benchCharacter'; id: string } // party → bench (keeps condition)
  | { type: 'joinParty'; id: string } // bench → party
  | { type: 'deleteCharacter'; id: string } // bench → gone
  | { type: 'moveCharacter'; id: string; by: -1 | 1 }
  | { type: 'closePartyScreen' } // begin the adventure / back to the game
  | { type: 'openShop'; name: string }
  | { type: 'closeShop' }
  | { type: 'shopBuy'; ref: string } // item ref, see rules/items.ts
  | { type: 'shopSell'; ref: string }
  | { type: 'equipItem'; characterId: string; ref: string }
  | { type: 'unequipItem'; characterId: string; slot: 'armor' | 'shield' }
  | { type: 'templeHeal' }
  | { type: 'templeRaise'; characterId: string } // after a fight: back to where it started (location or world map)
  | { type: 'leavePlace' } // close the location panel on the map
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'menu'; option: string }
  | { type: 'debug'; text: string };

/** A place to rest (see rules/rest.ts CampSite). Declared here so engine stays independent of rules. */
export interface CampSiteRef {
  kind: 'forest' | 'meadow' | 'rocks' | 'riverside' | 'cave' | 'ruins' | 'inn';
  name: string;
  risk: number;
  ambush?: string;
}

export type CommandHandler = (cmd: Command) => void;

/** Minimal synchronous bus; scenes subscribe while active and unsubscribe on shutdown. */
export class CommandBus {
  private handlers = new Set<CommandHandler>();

  subscribe(handler: CommandHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispatch(cmd: Command): void {
    for (const h of [...this.handlers]) h(cmd);
  }
}

export const DIRECTION_VECTORS: Readonly<Record<Direction, readonly [number, number]>> = {
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [-1, -1],
};

/** Direction for a one-square delta, or undefined if not adjacent. */
export function directionFromDelta(dx: number, dy: number): Direction | undefined {
  return (Object.keys(DIRECTION_VECTORS) as Direction[]).find(
    (d) => DIRECTION_VECTORS[d][0] === dx && DIRECTION_VECTORS[d][1] === dy,
  );
}
