import { Injectable, effect, signal } from '@angular/core';

/** How the folder listing renders its entries. */
export type FolderViewMode = 'list' | 'tiles';

/** Reading zoom levels, the steps a browser offers too. */
export const READING_ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/**
 * Per-user display preferences for the space browser: the "pretty names" toggle
 * that strips file extensions and replaces _/- with spaces for display only
 * (original casing and the raw paths in Git stay untouched), and the folder
 * listing's list/tile view mode.
 *
 * Persisted to localStorage so the choices survive reloads.
 */
@Injectable({ providedIn: 'root' })
export class DisplayPrefsService {
  private readonly storageKey = 'docuvault.prettyNames';
  private readonly viewModeKey = 'docuvault.folderViewMode';
  private readonly readingZoomKey = 'docuvault.readingZoom';

  /** True = show prettified display names. False = show raw filenames. */
  prettyNames = signal<boolean>(true);

  /** Folder listing layout — a dense table, or thumbnail tiles. */
  viewMode = signal<FolderViewMode>('list');

  /** Text size of documents in read mode, 1 = as designed. */
  readingZoom = signal<number>(1);

  constructor() {
    this.prettyNames.set(this.load());
    this.viewMode.set(this.loadViewMode());
    this.readingZoom.set(this.loadReadingZoom());
    effect(() => {
      try {
        localStorage.setItem(this.storageKey, String(this.prettyNames()));
        localStorage.setItem(this.viewModeKey, this.viewMode());
        localStorage.setItem(this.readingZoomKey, String(this.readingZoom()));
      } catch {
        // Storage may be disabled (private mode) — non-fatal.
      }
    });
  }

  zoomReadingIn(): void {
    const z = this.readingZoom();
    this.readingZoom.set(READING_ZOOM_STEPS.find(step => step > z + 0.001) ?? z);
  }

  zoomReadingOut(): void {
    const z = this.readingZoom();
    this.readingZoom.set([...READING_ZOOM_STEPS].reverse().find(step => step < z - 0.001) ?? z);
  }

  resetReadingZoom(): void {
    this.readingZoom.set(1);
  }

  private loadReadingZoom(): number {
    try {
      const z = Number(localStorage.getItem(this.readingZoomKey));
      return READING_ZOOM_STEPS.includes(z) ? z : 1;
    } catch {
      return 1;
    }
  }

  toggle(): void {
    this.prettyNames.update((v) => !v);
  }

  setViewMode(mode: FolderViewMode): void {
    this.viewMode.set(mode);
  }

  private loadViewMode(): FolderViewMode {
    try {
      return localStorage.getItem(this.viewModeKey) === 'tiles' ? 'tiles' : 'list';
    } catch {
      return 'list';
    }
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
