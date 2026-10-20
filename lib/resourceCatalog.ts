import type { TrackerData } from '../src/types';
import { VALORANT_WEAPON_NAMES } from './valorantCatalog';

export type ResourceKind = 'map' | 'agent' | 'weapon';

export interface CatalogEntry {
  kind: ResourceKind;
  key: string;
  name: string;
  active: boolean;
  configured: boolean;
  observed: boolean;
  assetPath: string;
}

const key = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('en');
const display = (value: unknown) => String(value ?? '').trim();
const assetName = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');

function observations(data: TrackerData, kind: ResourceKind): unknown[] {
  if (kind === 'map') return [
    ...(data.matches || []).map(row => row.map),
    ...(data.strats || []).map(row => row.map),
    ...(data.lineups || []).map(row => row.map),
  ];
  if (kind === 'agent') return [
    ...(data.playerStats || []).map(row => row.agent),
    ...(data.rounds || []).flatMap((round: any) => (round.screenshotEvidence?.players || []).map((row: any) => row.agent)),
  ];
  return (data.rounds || []).flatMap((round: any) => (round.screenshotEvidence?.players || []).flatMap((row: any) => [
    row.equippedWeapon,
    ...(row.weapons || []).map((item: any) => item.weapon || item),
  ]));
}

/**
 * Builds the one runtime catalog used by selectors, empty-state rows, analytics
 * and media. Configured names win casing conflicts. Disabled resources remain
 * addressable for historical evidence but are never returned as active.
 */
export function buildResourceCatalog(data: TrackerData, kind: ResourceKind): CatalogEntry[] {
  const configured = kind === 'map' ? data.settings.maps || []
    : kind === 'agent' ? data.settings.agents || []
      : data.settings.weapons?.length ? data.settings.weapons : [...VALORANT_WEAPON_NAMES];
  const inactive = kind === 'map' ? data.settings.inactiveMaps || []
    : kind === 'agent' ? data.settings.inactiveAgents || []
      : data.settings.inactiveWeapons || [];
  const observed = observations(data, kind);
  const configuredKeys = new Set(configured.map(key).filter(Boolean));
  const inactiveKeys = new Set(inactive.map(key).filter(Boolean));
  const observedKeys = new Set(observed.map(key).filter(Boolean));
  const names = new Map<string, string>();
  [...configured, ...inactive, ...observed].forEach(value => {
    const normalized = key(value);
    if (normalized && !names.has(normalized)) names.set(normalized, display(value));
  });

  return [...names].map(([normalized, name]) => ({
    kind,
    key: normalized,
    name,
    active: configuredKeys.has(normalized) && !inactiveKeys.has(normalized),
    configured: configuredKeys.has(normalized) || inactiveKeys.has(normalized),
    observed: observedKeys.has(normalized),
    assetPath: resourceAssetPath(kind, name),
  })).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'en'));
}

export function activeResourceNames(data: TrackerData, kind: ResourceKind): string[] {
  return buildResourceCatalog(data, kind).filter(entry => entry.active).map(entry => entry.name);
}

export function canonicalResourceName(data: TrackerData, kind: ResourceKind, value: unknown): string | null {
  const normalized = key(value);
  return buildResourceCatalog(data, kind).find(entry => entry.key === normalized)?.name || null;
}

export function resourceAssetPath(kind: ResourceKind, name: string): string {
  const folder = kind === 'map' ? 'maps' : kind === 'agent' ? 'agents' : 'weapons';
  const filename = kind === 'agent' && key(name) === 'kay/o' ? 'KAY_O' : assetName(name);
  return `/${folder}/${encodeURIComponent(filename)}.png`;
}
