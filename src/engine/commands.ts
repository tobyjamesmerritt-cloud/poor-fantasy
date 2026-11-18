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
  | { type: 'combatAction'; action: 'dash' | 'dodge' | 'disengage'; bonus?: boolean } // combat: SRD 5.2 actions besides Attack (bonus: Cunning Action)
  | { type: 'swapWeapon'; ref: string } // combat: draw another weapon (free object interaction)
  | { type: 'useFeature'; feature: 'second-wind' | 'action-surge' | 'lay-on-hands'; targetId?: string } // combat: class features
  | { type: 'flee' } // leave the battle from a map-edge square
  | { type: 'usePotion'; targetId: string } // Potion of Healing: drink or give (Bonus Action)
  | { type: 'undo' } // rewind one player action (debug now; patron-god mechanic later, DND-27)
  | { type: 'fight'; encounter: string; origin?: string; confirmed?: boolean } // start an encounter (origin = map location id; confirmed = past the wounded warning)
  | { type: 'wander'; dialog: string; difficulty: 'low' | 'moderate' | 'high'; share: number } // a random encounter found the party on the world map
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
  | { type: 'partyScreen'; levelUp?: string } // open the party roster (menu, inn); levelUp = straight to that character's level-up panel
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
  | { type: 'templeRaise'; characterId: string }
  | {
      type: 'levelUp';
      characterId: string;
      hp: 'roll' | 'average';
      asi?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
      spells?: { cantrips: string[]; spellbook: string[]; prepared: string[] };
    } // after a fight: back to where it started (location or world map)
  | { type: 'leavePlace' } // close the location panel on the map
  | { type: 'confirm' }
  | { type: 'aimSpell'; spellId: string; slot: number } // combat: pick targets on the grid next (cantrips: slot 0)
  | { type: 'openSpells'; characterId?: string } // spells dialog (camp, party screen); characterId = just that caster
  | { type: 'openParty' } // the party at a glance (group view)
  | { type: 'openCharacter'; characterId: string } // one character's sheet
  | { type: 'openPack'; characterId?: string } // the party pack (anywhere outside a fight), opened on one character
  | { type: 'setPartyName'; name: string }
  | { type: 'useItem'; ref: string; targetId?: string } // drink a potion / ale from the pack
  | { type: 'hook'; index: number } // a quest hook's button (index into quests.json hooks)
  | { type: 'atSite'; site: string } // the party reached (or bumped into) a world-map site
  | { type: 'talkChoice'; index: number; characterId?: string } // a conversation choice (skill checks: who tries)
  | { type: 'talkClose' }
  | { type: 'castOutside'; casterId: string; spellId: string; slot: number; targetIds: string[] }
  | { type: 'prepareSpells'; characterId: string; prepared: string[] }
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
