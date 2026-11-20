import { Signal, computed, signal } from '@angular/core';
import { Observable, Subscription, filter } from 'rxjs';
import { LiveMessage, LiveMode, LivePeer, LiveSocketService } from './live-socket.service';

const SECTION_THROTTLE_MS = 600;

/**
 * This tab's place in one document on the live hub: announces whether it reads
 * or edits and under which heading, and knows who else is there. Re-announces
 * itself after every reconnect. One per open document; [close] when leaving it.
 */
export class LiveDocument {
  readonly peers = signal<LivePeer[]>([]);
  /** Everyone here but this tab (the user's other tabs do count). */
  readonly others: Signal<LivePeer[]>;

  private mode: LiveMode;
  private section: string | null = null;
  private sectionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subscriptions = new Subscription();
  private readonly release: () => void;

  constructor(
    private readonly socket: LiveSocketService,
    readonly spaceId: string,
    readonly path: string,
    mode: LiveMode
  ) {
    this.mode = mode;
    this.release = socket.acquire();
    this.others = computed(() => this.peers().filter(p => p.sid !== socket.sid()));
    this.subscriptions.add(socket.ready$.subscribe(() => this.announce()));
    this.subscriptions.add(
      socket.on('peers')
        .pipe(filter(m => m['spaceId'] === spaceId && m['path'] === path))
        .subscribe(m => this.peers.set(m['peers'] ?? []))
    );
    if (socket.connected()) this.announce();
  }

  get currentMode(): LiveMode {
    return this.mode;
  }

  /** Messages for the document this tab is in. */
  on(type: string): Observable<LiveMessage> {
    return this.socket.on(type);
  }

  send(message: LiveMessage): boolean {
    return this.socket.send(message);
  }

  setMode(mode: LiveMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.socket.send({ t: 'mode', mode });
  }

  /** Where in the document this tab is; sent at most every few hundred ms. */
  setSection(section: string | null): void {
    if (section === this.section) return;
    this.section = section;
    if (this.sectionTimer) return;
    this.sectionTimer = setTimeout(() => {
      this.sectionTimer = null;
      this.socket.send({ t: 'where', section: this.section });
    }, SECTION_THROTTLE_MS);
  }

  close(): void {
    if (this.sectionTimer) clearTimeout(this.sectionTimer);
    this.socket.send({ t: 'close' });
    this.subscriptions.unsubscribe();
    this.peers.set([]);
    this.release();
  }

  private announce(): void {
    this.socket.send({ t: 'open', spaceId: this.spaceId, path: this.path, mode: this.mode });
    if (this.section) this.socket.send({ t: 'where', section: this.section });
  }
}
