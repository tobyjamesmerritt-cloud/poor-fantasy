/**
 * Player intent as commands, never raw keys. Keyboard, mouse, touch and
 * on-screen buttons all translate into these, so mobile support needs no
 * gameplay changes.
 */
export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type Command =
  | { type: 'move'; dir: Direction }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'attack'; targetId: string }
  | { type: 'endTurn' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'menu'; option: string }
  | { type: 'debug'; text: string };

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
