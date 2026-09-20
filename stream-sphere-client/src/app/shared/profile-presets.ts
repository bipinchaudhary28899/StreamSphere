/**
 * Built-in avatars and banners, served from src/assets/profile/.
 *
 * The ids must match AVATAR_PRESETS / BANNER_PRESETS in the backend's
 * services/profile.service.ts, which rejects anything else. /assets is cached
 * as immutable for a year, so to change a preset's art add it under a new id.
 */
export interface ProfilePreset {
  id: string;
  label: string;
  url: string;
}

const avatar = (id: string, label: string): ProfilePreset =>
  ({ id, label, url: `/assets/profile/avatars/${id}.svg` });
const banner = (id: string, label: string): ProfilePreset =>
  ({ id, label, url: `/assets/profile/banners/${id}.svg` });

export const AVATAR_PRESETS: readonly ProfilePreset[] = [
  avatar('pulse', 'Pulse'),
  avatar('ember', 'Ember'),
  avatar('orbit', 'Orbit'),
  avatar('lagoon', 'Lagoon'),
  avatar('nebula', 'Nebula'),
  avatar('prism', 'Prism'),
  avatar('bloom', 'Bloom'),
  avatar('midnight', 'Midnight'),
];

export const BANNER_PRESETS: readonly ProfilePreset[] = [
  banner('aurora', 'Aurora'),
  banner('sunset', 'Sunset'),
  banner('ocean', 'Ocean'),
  banner('synthwave', 'Synthwave'),
  banner('candy', 'Candy'),
  banner('confetti', 'Confetti'),
  banner('noir', 'Noir'),
  banner('studio', 'Studio'),
];

/** The preset a stored image URL points at, if any */
export function presetIdFromUrl(url: string | null | undefined): string | null {
  const match = /\/assets\/profile\/(?:avatars|banners)\/([a-z0-9-]+)\.svg$/.exec(url || '');
  return match ? match[1] : null;
}
