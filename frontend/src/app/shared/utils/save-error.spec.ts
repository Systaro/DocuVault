import { HttpErrorResponse } from '@angular/common/http';
import { describeSaveError, NOTHING_TO_SAVE } from './save-error';

/**
 * The point of this mapping is that the reader can tell whether the failure is
 * theirs to fix and whether a retry is worth anything. A single "could not be
 * stored, please try again" for every status fails both: an empty-document
 * rejection got read as a permissions problem, because that is what a storage
 * error sounds like when Save keeps refusing.
 */
describe('describeSaveError', () => {
  const httpError = (status: number, body?: unknown) =>
    new HttpErrorResponse({ status, error: body });

  it('names the empty document rather than blaming storage', () => {
    const result = describeSaveError(
      httpError(400, { status: 400, message: 'Validation failed', errors: ['content: Content is required'] })
    );
    expect(result).toEqual(NOTHING_TO_SAVE);
    expect(result.message).not.toContain('try again');
  });

  it('says it is a rights problem only when the server said so', () => {
    expect(describeSaveError(httpError(403)).title).toBe('No edit rights in this space');
    expect(describeSaveError(httpError(400, {})).title).not.toContain('rights');
    expect(describeSaveError(httpError(500)).title).not.toContain('rights');
  });

  it('passes on the merge request that unblocks a conflicted space', () => {
    const result = describeSaveError(
      httpError(409, { errorCode: 'SPACE_IN_CONFLICT', conflictMrUrl: 'https://git.example/mr/7' })
    );
    expect(result.message).toContain('https://git.example/mr/7');
  });

  it('distinguishes an expired session from a server fault', () => {
    expect(describeSaveError(httpError(401)).title).toContain('session');
    expect(describeSaveError(httpError(503)).message).toContain('503');
  });

  it('treats a dead connection as a connection problem, not a rejection', () => {
    expect(describeSaveError(httpError(0)).title).toBe('No connection to the server');
  });

  it('keeps a generic message for anything that is not an HTTP failure', () => {
    expect(describeSaveError(new Error('boom')).title).toBe('Could not save');
  });

  it('always says the work is still in the editor', () => {
    for (const status of [0, 400, 401, 403, 404, 409, 413, 500]) {
      const { message } = describeSaveError(httpError(status, {}));
      const survives = message.includes('still in the editor') || message === NOTHING_TO_SAVE.message;
      expect(survives).toBe(true);
    }
  });
});
