import { HttpErrorResponse } from '@angular/common/http';

/** Toast copy for a save that did not go through. */
export interface SaveErrorMessage {
  title: string;
  message: string;
}

/**
 * Backend error body as {@link com.docuvault.config.ErrorResponse} sends it.
 * Only the fields the editors act on are typed here.
 */
interface ApiErrorBody {
  message?: string;
  errors?: string[];
  errorCode?: string;
  conflictMrUrl?: string;
}

const STILL_IN_EDITOR = 'Your changes are still in the editor.';

/**
 * An empty document is refused by the backend's @NotBlank on content. The
 * editors check for it before sending, so this is the one failure reported
 * without a request ever going out — and the one the backend also maps a 400 to,
 * for anything that slips past the client check.
 */
export const NOTHING_TO_SAVE: SaveErrorMessage = {
  title: 'Nothing to save yet',
  message: 'A document needs at least a title or a line of text before it can be stored.'
};

/**
 * Turns a failed save into copy that says what actually happened.
 *
 * The editors used to report every failure as "could not be stored, please try
 * again" regardless of status. That is wrong advice for most of them: a 400 and
 * a 403 never succeed on a retry, so the person keeps pressing Save, keeps
 * seeing a storage error, and concludes their account is broken. That is exactly
 * how an empty-document rejection got reported as a permissions problem.
 *
 * Each branch answers the only question the reader has: is this mine to fix, and
 * is trying again worth anything?
 */
export function describeSaveError(error: unknown): SaveErrorMessage {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      title: 'Could not save',
      message: `${STILL_IN_EDITOR} Please try again.`
    };
  }

  const body: ApiErrorBody = (error.error ?? {}) as ApiErrorBody;

  // Status 0 is the browser refusing to report anything about the request —
  // offline, DNS, a dropped VPN, a proxy that closed the connection.
  if (error.status === 0) {
    return {
      title: 'No connection to the server',
      message: `${STILL_IN_EDITOR} Check your connection, then save again.`
    };
  }

  if (error.status === 400) {
    if (body.errors?.some(e => e.startsWith('content:'))) {
      return NOTHING_TO_SAVE;
    }
    return {
      title: 'The document was rejected',
      message: `${body.message || 'The server did not accept this content.'} ${STILL_IN_EDITOR}`
    };
  }

  if (error.status === 401) {
    return {
      title: 'Your session has expired',
      message: `${STILL_IN_EDITOR} Sign in again in a second tab, then save — nothing is lost.`
    };
  }

  if (error.status === 403) {
    return {
      title: 'No edit rights in this space',
      message: `Your account may only read here, so the save was refused. ${STILL_IN_EDITOR} Ask a space admin for Edit access.`
    };
  }

  if (error.status === 404) {
    return {
      title: 'This document no longer exists',
      message: `It was moved or deleted while you were editing. ${STILL_IN_EDITOR} Copy them out before you leave the page.`
    };
  }

  if (error.status === 409) {
    const mr = body.conflictMrUrl ? ` Resolve the open merge request first: ${body.conflictMrUrl}` : '';
    return {
      title: 'This space is in conflict',
      message: `Saving is blocked until the space is back in sync. ${STILL_IN_EDITOR}${mr}`
    };
  }

  if (error.status === 413) {
    return {
      title: 'The document is too large',
      message: `The server refused it for its size. ${STILL_IN_EDITOR} Splitting it into two pages usually helps.`
    };
  }

  return {
    title: 'Could not save',
    message: `The server could not store it (error ${error.status}). ${STILL_IN_EDITOR} Please try again in a moment.`
  };
}
