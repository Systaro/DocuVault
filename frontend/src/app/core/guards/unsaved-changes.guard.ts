import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';

/** A routed component that may hold work the browser is the only copy of. */
export interface HasUnsavedChanges {
  /** True (or an observable resolving to true) once it is safe to navigate away. */
  confirmLeave(): boolean | Observable<boolean>;
}

/**
 * Holds a navigation back while a component still has unsaved work, so the user
 * gets asked instead of losing it. `beforeunload` only covers closing or
 * reloading the tab — moving to another document inside the app never leaves
 * the page and would otherwise discard the edits without a word.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  typeof component?.confirmLeave === 'function' ? component.confirmLeave() : true;
