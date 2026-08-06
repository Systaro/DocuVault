/** Up to two uppercase initials for an avatar chip, '?' when the name is missing. */
export function getInitials(name: string | undefined | null): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

/**
 * Stable avatar tint for a user, so the same person keeps the same colour
 * across renders and sessions. Hue is derived from the id, not assigned by
 * position — the strip must not reshuffle colours when membership changes.
 */
export function avatarHue(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
