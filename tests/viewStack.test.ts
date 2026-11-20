import { describe, expect, it } from 'vitest';
import { ViewStack } from '../src/ui/viewStack';

describe('popup view stack (one frame, never stacked)', () => {
  it('is closed until a view is set', () => {
    const s = new ViewStack<string>();
    expect(s.top).toBeNull();
    expect(s.depth).toBe(0);
  });

  it('a view pushed over the base replaces it on screen, and Back restores the base', () => {
    const s = new ViewStack<string>();
    s.setBase('hall');
    s.push('talk');
    expect(s.top).toBe('talk');
    s.pop();
    expect(s.top).toBe('hall');
  });

  it('never goes deeper than two: pushing again replaces the view over the base', () => {
    const s = new ViewStack<string>();
    s.setBase('hall');
    s.push('talk');
    s.push('check');
    expect(s.depth).toBe(2);
    s.pop();
    expect(s.top).toBe('hall');
  });

  it('clearing the base while a view is over it leaves that view showing; Back then closes', () => {
    const s = new ViewStack<string>();
    s.setBase('hall');
    s.push('talk');
    s.setBase(null);
    expect(s.top).toBe('talk');
    s.pop();
    expect(s.top).toBeNull();
  });

  it('a conversation with no base closes on Back', () => {
    const s = new ViewStack<string>();
    s.push('talk');
    s.pop();
    expect(s.top).toBeNull();
  });
});
