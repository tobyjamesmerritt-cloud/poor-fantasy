import { describe, expect, it } from 'vitest';
import { assets } from '../src/content/assets';
import gear from '../src/content/gear.json';
import { MISC_ICON, VALUABLE_ICON, WEAPON_ICON } from '../src/content/itemIcons';

describe('item icons (DND-64)', () => {
  it('every mapped icon exists in assets.json', () => {
    for (const icon of [...Object.values(VALUABLE_ICON), ...Object.values(MISC_ICON), ...Object.values(WEAPON_ICON)])
      expect(assets.sprites[icon], icon).toBeDefined();
    for (const icon of ['item-gem', 'item-key', 'item-potion', 'item-potion-greater', 'item-drink', 'item-sword']) expect(assets.sprites[icon], icon).toBeDefined();
  });
  it('every valuable and quest item has its own icon', () => {
    for (const id of Object.keys(gear.valuables)) expect(VALUABLE_ICON[id], id).toBeDefined();
    for (const id of Object.keys(gear.misc)) expect(MISC_ICON[id], id).toBeDefined();
  });
});
