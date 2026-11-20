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

/** The avatar chip's background: the user's tint as a soft diagonal gradient. */
export function avatarGradient(userId: string): string {
  const hue = avatarHue(userId);
  return `linear-gradient(135deg, hsl(${hue} 52% 52%), hsl(${(hue + 28) % 360} 52% 42%))`;
}

/**
 * A person's colour in live editing — their cursor, selection and avatar ring —
 * from the same hue as their avatar, so the cursor and the chip match.
 */
export function presenceColor(userId: string, alpha = 1): string {
  const hue = avatarHue(userId);
  return alpha >= 1 ? `hsl(${hue} 55% 42%)` : `hsl(${hue} 55% 42% / ${alpha})`;
}
