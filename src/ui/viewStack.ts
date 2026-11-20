/**
 * What the popup frame shows: a base view (e.g. a building's panel) and at most
 * one view over it (e.g. a conversation). Never deeper — popups are not stacked
 * (UI principles, CLAUDE.md). Pure, so it is unit-tested without a DOM.
 */
export class ViewStack<T> {
  private base: T | null = null;
  private over: T | null = null;

  /** Replace the base view (null clears it). A view over it stays. */
  setBase(view: T | null): void {
    this.base = view;
  }

  /** Swap a view in over the base. Replaces any view already over it. */
  push(view: T): void {
    this.over = view;
  }

  /** Back: drop the view over the base; the base shows again. */
  pop(): void {
    this.over = null;
  }

  /** The view to draw, or null when the frame is closed. */
  get top(): T | null {
    return this.over ?? this.base;
  }

  get depth(): number {
    return (this.base ? 1 : 0) + (this.over ? 1 : 0);
  }
}
