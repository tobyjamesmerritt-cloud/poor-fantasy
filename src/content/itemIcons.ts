/** Pack dialog icons (assets.json `item-*` sprites) per item id. Checked by tests/itemIcons.test.ts. */
/** Icon sprite per valuable / quest item (DND-64); unlisted valuables show a gem, quest items a key. */
export const VALUABLE_ICON: Record<string, string> = {
  'copper-trinket': 'item-copper',
  'carved-bone-idol': 'item-idol',
  'silver-ring': 'item-silver',
  'small-garnet': 'item-garnet',
  'gold-locket': 'item-gold',
  moonstone: 'item-moonstone',
};
export const MISC_ICON: Record<string, string> = { 'spigot-parts': 'item-crate' };

/** Icon sprite (assets.json `item-*`) per weapon; anything unlisted shows a sword. */
export const WEAPON_ICON: Record<string, string> = {
  dagger: 'item-dagger',
  sickle: 'item-scimitar',
  scimitar: 'item-scimitar',
  greatsword: 'item-greatsword',
  club: 'item-club',
  quarterstaff: 'item-staff',
  mace: 'item-mace',
  morningstar: 'item-mace',
  flail: 'item-mace',
  handaxe: 'item-axe',
  battleaxe: 'item-axe',
  greataxe: 'item-greataxe',
  spear: 'item-spear',
  warhammer: 'item-hammer',
};
