import { Injectable, effect, signal } from '@angular/core';

/**
 * Per-user display preferences for the space browser. Currently exposes the
 * "pretty names" toggle that strips file extensions and replaces _/- with
 * spaces for display only — original casing and the raw paths in Git stay
 * untouched.
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
   * extension is dropped. For both: underscores and dashes become spaces.
   * Original casing is preserved (so `iOS_App` stays `iOS App`).
   * Returns the input unchanged when the toggle is off.
   */
  prettify(name: string, isFolder = false): string {
    if (!name) return '';
    if (!this.prettyNames()) return name;
    let out = isFolder ? name : name.replace(/\.[^.]+$/, '');
    out = out.replace(/[_-]+/g, ' ').trim();
    if (isFolder) out = this.capitalizeWords(out);
    return out || name;
  }

  /**
   * Title-cases folder labels — `developer docs` reads as `Developer Docs`.
   * Only words that start lowercase are touched, so deliberate casing survives:
   * `iOS App` and `REST API` keep their shape instead of being flattened
   * to `Ios App` / `Rest Api`. A letter followed straight by a digit is
   * left alone too, so a `v1.3.0` folder does not become `V1.3.0`.
   */
  private capitalizeWords(value: string): string {
    return value.replace(/(^|\s)([a-z](?![0-9])[a-z0-9]*)/g,
      (_m, lead: string, word: string) => lead + word.charAt(0).toUpperCase() + word.slice(1));
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
