/**
 * Bounded undo stack of deep-copied snapshots. Because game state is plain
 * JSON data and the Rng's position is a single number, restoring a snapshot
 * reproduces the exact moment, including what the dice will roll next.
 * Basis for the debug rewind now and the "patron god rewinds time" mechanic later.
 */
export class History<T> {
  private stack: T[] = [];

  constructor(private readonly capacity = 200) {}

  push(snapshot: T): void {
    this.stack.push(structuredClone(snapshot));
    if (this.stack.length > this.capacity) this.stack.shift();
  }

  /** Most recent snapshot (removed from the stack), or undefined if empty. */
  pop(): T | undefined {
    return this.stack.pop();
  }

  get size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
  }
}
