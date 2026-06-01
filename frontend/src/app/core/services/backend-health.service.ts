import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PlatformService } from '../platform/platform.service';
import { environment } from '../../../environments/environment';

/**
 * Tracks whether the DocuVault backend is reachable.
 *
 * The HTTP interceptor feeds this service: a network error (status 0) or a
 * gateway error (502/503/504, emitted by nginx-proxy when the backend
 * container is down or restarting) flips us into the "down" state, while any
 * successful response clears it. While down we additionally poll the health
 * endpoint so an idle client (e.g. someone sitting on the login screen) still
 * recovers once the server comes back — without that, the banner would only
 * clear on the user's next manual action.
 */
@Injectable({ providedIn: 'root' })
export class BackendHealthService {
  private http = inject(HttpClient);
  private platform = inject(PlatformService);

  /** True when the backend is believed to be unreachable / in maintenance. */
  readonly isDown = signal(false);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** A response made it back from the server, so it is reachable. */
  reportReachable(): void {
    if (this.isDown()) {
      this.isDown.set(false);
    }
    this.stopPolling();
  }

  /** The server could not be reached (network error or gateway error). */
  reportUnreachable(): void {
    if (!this.isDown()) {
      this.isDown.set(true);
    }
    this.startPolling();
  }

  private healthUrl(): string {
    const path = '/api/actuator/health';
    if (this.platform.isNative() && environment.apiUrl) {
      return environment.apiUrl + path;
    }
    return path;
  }

  private startPolling(): void {
    if (this.pollTimer !== null) {
      return;
    }
    this.pollTimer = setInterval(() => this.checkHealth(), 10000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private checkHealth(): void {
    // The recovery probe runs through the interceptor too, so reachability is
    // reported there as well; subscribing keeps the request alive.
    this.http.get(this.healthUrl(), { observe: 'response' }).subscribe({
      next: () => this.reportReachable(),
      error: () => {
        /* still down — keep polling */
      }
    });
  }
}
