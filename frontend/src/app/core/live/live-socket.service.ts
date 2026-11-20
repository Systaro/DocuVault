import { Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NativeTokenStore } from '../auth/native-token.store';
import { PlatformService } from '../platform/platform.service';
import { environment } from '../../../environments/environment';

/** A message on the live socket; `t` names its type. */
export interface LiveMessage {
  t: string;
  [field: string]: any;
}

export type LiveMode = 'view' | 'edit';

/** Somebody in the same document, as the server sees them. */
export interface LivePeer {
  sid: string;
  userId: string;
  name: string;
  mode: LiveMode;
  /** The heading they are reading or writing under. */
  section: string | null;
  /** Their Yjs client id, to find their cursor; null for readers. */
  clientId: number | null;
  leader: boolean;
}

export interface PresenceUser {
  userId: string;
  name: string;
}

/** Who is online in a space and who is in which of its documents. */
export interface SpacePresence {
  spaceId: string;
  online: PresenceUser[];
  docs: { path: string; users: (PresenceUser & { mode: LiveMode })[] }[];
}

const PING_MS = 25_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000];

/**
 * The tab's one connection to the live hub (`/api/live`): presence in a space and
 * the documents opened for reading or editing together.
 *
 * It connects while anything holds it and the user is signed in, and keeps
 * reconnecting after a drop; [ready$] fires each time the server has accepted
 * the user again, which is when holders re-announce where they are.
 */
@Injectable({ providedIn: 'root' })
export class LiveSocketService {
  private readonly zone = inject(NgZone);
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);
  private readonly tokenStore = inject(NativeTokenStore);

  /** Signed in on an open socket. */
  readonly connected = signal(false);
  /** This tab's connection id, to tell itself apart from the user's other tabs. */
  readonly sid = signal<string | null>(null);
  /** False once the socket has failed before it ever opened: no live features here. */
  readonly available = signal(true);

  readonly presence = signal<SpacePresence | null>(null);
  /** Presence of the watched space, null while none is watched. */
  readonly watchedPresence = computed(() => {
    const p = this.presence();
    return p && p.spaceId === this.watchedSpace() ? p : null;
  });

  private readonly messages = new Subject<LiveMessage>();
  private readonly readySubject = new Subject<void>();
  readonly ready$ = this.readySubject.asObservable();

  private socket: WebSocket | null = null;
  private holds = 0;
  private attempt = 0;
  private everOpened = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly watchedSpace = signal<string | null>(null);

  constructor() {
    // Signing out closes the socket; signing in (again) opens it for whoever holds it.
    effect(() => {
      const signedIn = this.auth.isAuthenticated();
      if (signedIn) this.ensureOpen();
      else this.shutdown();
    }, { allowSignalWrites: true });
  }

  /** Keep the socket open until the returned release is called. */
  acquire(): () => void {
    this.holds++;
    this.ensureOpen();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds = Math.max(0, this.holds - 1);
      if (this.holds === 0) this.shutdown();
    };
  }

  /** Messages of one type, delivered inside the Angular zone. */
  on(type: string): Observable<LiveMessage> {
    return this.messages.pipe(filter(m => m.t === type));
  }

  /** Sends when signed in on an open socket; returns whether it went out. */
  send(message: LiveMessage): boolean {
    if (!this.connected() || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Follow who is online in [spaceId]; null stops. */
  watchSpace(spaceId: string | null): void {
    if (this.watchedSpace() === spaceId) return;
    this.watchedSpace.set(spaceId);
    if (!spaceId) this.presence.set(null);
    this.send({ t: 'space', spaceId });
  }

  private ensureOpen(): void {
    if (this.holds === 0 || !this.auth.isAuthenticated() || this.socket) return;
    const url = this.socketUrl();
    if (!url) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.available.set(false);
      return;
    }
    this.socket = socket;
    socket.onopen = () => this.zone.run(() => {
      this.everOpened = true;
      this.available.set(true);
      this.attempt = 0;
      if (this.platform.isNative()) {
        socket.send(JSON.stringify({ t: 'auth', token: this.tokenStore.get() }));
      }
    });
    socket.onmessage = event => this.zone.run(() => this.receive(event.data));
    socket.onclose = () => this.zone.run(() => this.dropped(socket));
    socket.onerror = () => {
      // onclose follows and handles it.
    };
  }

  private receive(raw: unknown): void {
    let message: LiveMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (message.t) {
      case 'hello':
        this.sid.set(message['sid']);
        this.connected.set(true);
        this.startPing();
        if (this.watchedSpace()) this.send({ t: 'space', spaceId: this.watchedSpace() });
        this.readySubject.next();
        break;
      case 'presence':
        this.presence.set(message as unknown as SpacePresence);
        break;
    }
    this.messages.next(message);
  }

  private dropped(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.connected.set(false);
    this.sid.set(null);
    this.stopPing();
    // Never got through at all (a proxy without WebSocket support, say): the
    // editor falls back to saving on its own.
    if (!this.everOpened) this.available.set(false);
    if (this.holds > 0 && this.auth.isAuthenticated()) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureOpen();
    }, delay);
  }

  private shutdown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    this.connected.set(false);
    this.sid.set(null);
    this.presence.set(null);
    socket?.close();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private socketUrl(): string | null {
    if (this.platform.isNative()) {
      if (!environment.apiUrl) return null;
      return environment.apiUrl.replace(/^http/, 'ws') + '/api/live';
    }
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}/api/live`;
  }
}
