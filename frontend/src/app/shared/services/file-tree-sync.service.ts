import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

/**
 * Announces that a space's files changed — a folder created, files uploaded,
 * something renamed, moved or deleted.
 *
 * The sidebar tree and the folder overview each hold their own copy of the
 * tree, and before this they only reloaded after their *own* actions. So
 * creating a folder in the overview left the sidebar stale until a navigation
 * happened to reload it, and renaming in the sidebar left the overview stale
 * the same way. Every mutation now reports here and both views listen, so the
 * two panes cannot drift apart regardless of which one performed the change.
 */
@Injectable({ providedIn: 'root' })
export class FileTreeSyncService {
  private readonly changed = new Subject<string>();

  /** Tell every view showing this space to reload its file tree. */
  notify(spaceId: string): void {
    this.changed.next(spaceId);
  }

  /** Emits whenever the given space's files changed. */
  changesFor(spaceId: () => string | null | undefined) {
    return this.changed.asObservable().pipe(
      filter(id => !!spaceId() && id === spaceId()),
      map(id => id)
    );
  }
}
