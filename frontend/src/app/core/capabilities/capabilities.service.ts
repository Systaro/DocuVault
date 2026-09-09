import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface AiCapabilities {
  enabled: boolean;
  chat: boolean;
  inbox: boolean;
}

export interface Capabilities {
  ai: AiCapabilities;
  /** A server-side HTML-to-PDF renderer is configured for this install. */
  pdfRenderer: boolean;
}

const FALLBACK: Capabilities = {
  ai: { enabled: false, chat: false, inbox: false },
  pdfRenderer: false
};

@Injectable({ providedIn: 'root' })
export class CapabilitiesService {
  private http = inject(HttpClient);
  private state = signal<Capabilities>(FALLBACK);

  capabilities = this.state.asReadonly();
  aiEnabled = computed(() => this.state().ai.enabled);
  aiChat = computed(() => this.state().ai.chat);
  aiInbox = computed(() => this.state().ai.inbox);
  pdfRenderer = computed(() => this.state().pdfRenderer);

  /**
   * Fetch capabilities once on app start. Safe to call multiple times; later
   * calls just refresh the cached state. Returns immediately on network error
   * (capabilities stay at the conservative default — everything AI off).
   */
  async load(): Promise<void> {
    try {
      const caps = await firstValueFrom(this.http.get<Capabilities>('/api/capabilities'));
      if (caps?.ai) {
        this.state.set({ ...caps, pdfRenderer: caps.pdfRenderer ?? false });
      }
    } catch {
      // keep defaults; UI hides AI by default
    }
  }
}
