import { Injectable, effect, signal } from '@angular/core';

/**
 * Per-user display preferences for the space browser. Currently exposes the
 * "pretty names" toggle that strips file extensions, replaces _/- with spaces,
 * and lowercases names for display only — raw paths in Git stay untouched.
 *
 * Persisted to localStorage so the choice survives reloads.
 */
@Injectable({ providedIn: 'root' })
export class DisplayPrefsService {
  private readonly storageKey = 'docuvault.prettyNames';

  /** True = show prettified display names. False = show raw filenames. */
  prettyNames = signal<boolean>(true);

  constructor() {
    this.prettyNames.set(this.load());
    effect(() => {
      try {
        localStorage.setItem(this.storageKey, String(this.prettyNames()));
      } catch {
        // Storage may be disabled (private mode) — non-fatal.
      }
    });
  }

  toggle(): void {
    this.prettyNames.update((v) => !v);
  }

  /**
   * Render a raw file/folder name as a friendlier label. For files the
   * extension is dropped. For both: underscores and dashes become spaces and
   * the whole string is lowercased. Returns the input unchanged when the
   * toggle is off.
   */
  prettify(name: string, isFolder = false): string {
    if (!name) return '';
    if (!this.prettyNames()) return name;
    let out = isFolder ? name : name.replace(/\.[^.]+$/, '');
    out = out.replace(/[_-]+/g, ' ').toLowerCase().trim();
    return out || name;
  }

  private load(): boolean {
    try {
      const v = localStorage.getItem(this.storageKey);
      if (v === null) return true;
      return v === 'true';
    } catch {
      return true;
    }
  }
}
