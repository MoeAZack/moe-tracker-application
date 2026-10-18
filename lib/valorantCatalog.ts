/** Closed vocabulary used by OCR validation and analytics presentation. Keep
 * this shared so an OCR artifact can never appear as a real weapon category. */
export const VALORANT_WEAPON_NAMES = ['Classic', 'Shorty', 'Frenzy', 'Ghost', 'Sheriff', 'Bandit', 'Stinger', 'Spectre', 'Bucky', 'Judge', 'Bulldog', 'Guardian', 'Phantom', 'Vandal', 'Marshal', 'Outlaw', 'Operator', 'Ares', 'Odin', 'Melee'] as const;

const weaponByKey = new Map(VALORANT_WEAPON_NAMES.map(name => [name.toLocaleLowerCase('en'), name]));

export function canonicalValorantWeapon(value: unknown): string | null {
  return weaponByKey.get(String(value || '').trim().toLocaleLowerCase('en')) || null;
}
