import { signal } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { LiveDocument } from './live-document';
import { LiveMessage } from './live-socket.service';

/** What the file holds, as the room records it (see the backend's LiveRoom.base). */
export interface CollabBase {
  /** The Markdown body without the title heading. */
  body?: string;
  /** The editor's serialization of that state, the baseline of the minimal-diff save. */
  raw?: string;
  /** The whole file. */
  content?: string;
  hash?: string;
  title?: string;
}

export interface CollabReady {
  /** This tab fills the shared document from the file, then calls [CollabSession.seeded]. */
  seed: boolean;
  /** The document object changed: the editor has to be (re)bound to [CollabSession.doc]. */
  rebind: boolean;
  /** A copy this tab held could not be merged and was dropped (the file moved on meanwhile). */
  droppedCopy?: boolean;
}

/** Origin of changes that came from the room, so they are not sent back to it. */
const REMOTE = 'live-remote';
const SAVE_TIMEOUT_MS = 30_000;

/**
 * The shared Yjs copy of a Markdown document while this tab edits it. Speaks the
 * room protocol of the backend's LiveHub: who seeds the copy from the file, the
 * update relay, cursors (awareness), compaction, and saves.
 *
 * The editor is bound to [doc] once [ready$] fires; until then the room's state
 * is still on its way and typing would fork it.
 */
export class CollabSession {
  doc = new Y.Doc();
  awareness = new Awareness(this.doc);

  /** The shared copy is in place and may be edited. */
  readonly isReady = signal(false);
  /** This tab autosaves for everyone in the room. */
  readonly leader = signal(false);
  /** Remote-backed space: saved by the room but not committed yet. */
  readonly pendingCommit = signal(false);

  readonly ready$ = new Subject<CollabReady>();
  /** Every save of the room, this tab's own included, in the order they were written. */
  readonly saved$ = new Subject<LiveMessage>();
  /** The leader took an outside change in; this is the file now. */
  readonly base$ = new Subject<CollabBase>();
  /** The file was written outside the room (an agent, an AI edit, a restore). */
  readonly external$ = new Subject<{ content: string; hash: string }>();
  readonly leaderChange$ = new Subject<boolean>();

  private lineage: string | null = null;
  private pendingSaves = new Map<string, { resolve: (m: LiveMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly subscriptions = new Subscription();
  private detachDoc: () => void = () => {};

  constructor(
    private readonly live: LiveDocument,
    /** Hash of the file as this tab last knew it. */
    private readonly knownHash: () => string | null,
    /** The record of the file a seeding tab hands the room. */
    private readonly currentBase: () => CollabBase
  ) {
    this.attachDoc();
    const on = (type: string, handle: (m: LiveMessage) => void) =>
      this.subscriptions.add(live.on(type).subscribe(handle));
    on('welcome', m => this.welcome(m));
    on('lineage', m => this.lineageArrived(m));
    on('seed', () => this.seedNow(null));
    on('update', m => this.applyRemote(m['data']));
    on('awareness', m => {
      try {
        applyAwarenessUpdate(this.awareness, fromBase64(m['data']), REMOTE);
      } catch {
        // A malformed cursor update costs a cursor, never the document.
      }
    });
    on('leader', () => this.setLeader(true));
    on('compact', m => this.compact(m['upTo']));
    on('saved', m => this.saved(m));
    on('saveFailed', m => this.settleSave(m['req'], null, saveError(m['message'] || 'The save failed.', m['status'] ?? 500)));
    on('base', m => m['base'] && this.base$.next(m['base']));
    on('external', m => this.external$.next({ content: m['content'], hash: m['hash'] }));
    live.setMode('edit');
  }

  /** The seeding tab has filled [doc] from the file: hand the room its first state. */
  seeded(): void {
    this.lineage = randomId();
    this.sendInit();
  }

  save(payload: { title: string; content: string; body: string; raw: string; commit: boolean }): Promise<LiveMessage> {
    const req = randomId();
    if (!this.live.send({ t: 'save', req, ...payload })) {
      return Promise.reject(saveError('Not connected to the server.', 0));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.settleSave(req, null, saveError('The save did not complete in time.', 0)),
        SAVE_TIMEOUT_MS
      );
      this.pendingSaves.set(req, { resolve, reject, timer });
    });
  }

  /** Tell the room what the file holds after the leader merged an outside change in. */
  publishBase(base: CollabBase): void {
    this.live.send({ t: 'base', base });
  }

  /** Leave editing: retire this tab's cursor and stop listening. */
  destroy(): void {
    this.awareness.setLocalState(null);
    this.subscriptions.unsubscribe();
    for (const [req] of this.pendingSaves) this.settleSave(req, null, new Error('Editing ended.'));
    this.detachDoc();
    this.awareness.destroy();
    this.doc.destroy();
    this.ready$.complete();
  }

  // --- Room protocol ---------------------------------------------------------

  private welcome(m: LiveMessage): void {
    this.setLeader(!!m['leader']);
    this.pendingCommit.set(!!m['pendingCommit']);
    const lineage: string | null = m['lineage'] ?? null;
    const updates: string[] = m['updates'] ?? [];

    if (lineage === null) {
      if (m['seeder']) this.seedNow(m['fileHash'] ?? null);
      // Otherwise another tab is seeding; its state arrives as 'lineage'.
      if (m['base']) this.base$.next(m['base']);
      return;
    }

    this.join(lineage, updates);
    if (m['base']) this.base$.next(m['base']);
  }

  /** Another tab has (re)filled the room while this one waited. */
  private lineageArrived(m: LiveMessage): void {
    this.join(m['lineage'], m['updates'] ?? []);
    if (m['base']) this.base$.next(m['base']);
  }

  /** Take on the room's document [lineage] with its [updates]. */
  private join(lineage: string, updates: string[]): void {
    if (this.lineage === lineage) {
      // The same document this tab already holds (back after a drop, or the room
      // refilled from another tab's copy after a restart): catch up, then hand the
      // room whatever was typed meanwhile (Yjs drops what it already has).
      updates.forEach(u => this.applyRemote(u));
      this.live.send({ t: 'update', lineage, data: toBase64(Y.encodeStateAsUpdate(this.doc)) });
      this.markReady({ seed: false, rebind: !this.isReady() });
      return;
    }
    // A copy of another document cannot be merged into this one.
    const droppedCopy = this.lineage !== null;
    if (droppedCopy) this.replaceDoc();
    this.lineage = lineage;
    updates.forEach(u => this.applyRemote(u));
    this.markReady({ seed: false, rebind: droppedCopy || !this.isReady(), droppedCopy });
  }

  /**
   * This tab fills the room. A copy it still holds from before (the room was gone
   * after a restart or everyone left) is kept only while the file is unchanged;
   * otherwise it starts over from the file.
   */
  private seedNow(fileHash: string | null): void {
    if (this.lineage !== null && fileHash !== null && fileHash === this.knownHash()) {
      this.sendInit();
      this.markReady({ seed: false, rebind: false });
      return;
    }
    const droppedCopy = this.lineage !== null;
    if (droppedCopy || this.isReady()) this.replaceDoc();
    this.lineage = null;
    this.markReady({ seed: true, rebind: true, droppedCopy });
  }

  private sendInit(): void {
    this.live.send({
      t: 'init',
      lineage: this.lineage,
      data: toBase64(Y.encodeStateAsUpdate(this.doc)),
      base: this.currentBase()
    });
  }

  private compact(upTo: number): void {
    if (!this.lineage) return;
    this.live.send({ t: 'compacted', lineage: this.lineage, upTo, data: toBase64(Y.encodeStateAsUpdate(this.doc)) });
  }

  private saved(m: LiveMessage): void {
    this.pendingCommit.set(!!m['pendingCommit']);
    this.saved$.next(m);
    this.settleSave(m['req'], m, null);
  }

  private settleSave(req: string, message: LiveMessage | null, error: Error | null): void {
    const pending = this.pendingSaves.get(req);
    if (!pending) return;
    this.pendingSaves.delete(req);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(message!);
  }

  private setLeader(leader: boolean): void {
    if (this.leader() === leader) return;
    this.leader.set(leader);
    this.leaderChange$.next(leader);
  }

  private markReady(ready: CollabReady): void {
    this.isReady.set(true);
    this.ready$.next(ready);
  }

  private applyRemote(data: string): void {
    try {
      Y.applyUpdate(this.doc, fromBase64(data), REMOTE);
    } catch {
      // A broken update from the room must not take the editor down.
    }
  }

  // --- The Yjs document ------------------------------------------------------

  private attachDoc(): void {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || !this.lineage) return;
      this.live.send({ t: 'update', lineage: this.lineage, data: toBase64(update) });
    };
    const onAwareness = (_changes: unknown, origin: unknown) => {
      if (origin === REMOTE) return;
      this.live.send({ t: 'awareness', data: toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
    };
    this.doc.on('update', onUpdate);
    this.awareness.on('update', onAwareness);
    this.detachDoc = () => {
      this.doc.off('update', onUpdate);
      this.awareness.off('update', onAwareness);
    };
  }

  /** A fresh document (and cursor state) in place of one that cannot be merged. */
  private replaceDoc(): void {
    this.awareness.setLocalState(null);
    this.detachDoc();
    this.awareness.destroy();
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.attachDoc();
  }
}

/** A failed save with the HTTP status it corresponds to (0 = no connection). */
export type LiveSaveError = Error & { status: number };

function saveError(message: string, status: number): LiveSaveError {
  return Object.assign(new Error(message), { status });
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
