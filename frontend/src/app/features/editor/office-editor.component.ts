import { AfterViewInit, Component, EventEmitter, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { ToastService } from '../../shared/services/toast.service';

interface DocEditor {
  destroyEditor(): void;
}

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (placeholderId: string, config: object) => DocEditor };
  }
}

let docsApi: Promise<void> | null = null;

/** The document server's editor script, loaded once per page. */
function loadDocsApi(base: string): Promise<void> {
  if (window.DocsAPI) return Promise.resolve();
  docsApi ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}/web-apps/apps/api/documents/api.js`;
    script.onload = () => resolve();
    script.onerror = () => {
      docsApi = null;
      script.remove();
      reject(new Error('editor script unavailable'));
    };
    document.head.appendChild(script);
  });
  return docsApi;
}

/**
 * Below this width the document server would open its mobile editor, which the
 * free Community edition only offers for viewing; Word editing is not offered there.
 */
export const OFFICE_PHONE_QUERY = '(max-width: 768px)';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let instances = 0;

/**
 * A Word document in the office document server's editor. Everyone editing the
 * same file shares one session there; each save becomes a commit in the space.
 * Done saves right away and waits for that save to land before it emits
 * [closed], so the document shown afterwards already has the edits.
 */
@Component({
  selector: 'app-office-editor',
  standalone: true,
  template: `
    <div class="office-bar">
      <span class="office-name">{{ fileName() }}</span>
      <span class="office-status">
        @switch (state()) {
          @case ('opening') { Opening… }
          @case ('editing') { Ctrl+S saves a version · Done saves and closes }
          @case ('saving') { Saving… }
        }
      </span>
      <button type="button" class="office-done" [disabled]="state() === 'saving'" (click)="done()">
        @if (state() === 'saving') {
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        }
        Done
      </button>
    </div>
    @if (error(); as message) {
      <div class="office-error">
        <span translate="no" class="material-icons">error_outline</span>
        <p>{{ message }}</p>
        <button type="button" class="office-back" (click)="closed.emit(false)">Back to the document</button>
      </div>
    }
    <div class="office-frame" [class.hidden]="!!error() || state() === 'saving'">
      <div [id]="placeholderId"></div>
    </div>
  `,
  styles: [`
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .office-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .office-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .office-status {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .office-done {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      padding: 6px 14px;
      border: none;
      border-radius: 6px;
      background: var(--primary);
      color: white;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;

      &:hover:not(:disabled) { background: var(--primary-dark); }
      &:disabled { opacity: 0.6; cursor: wait; }
    }

    .office-frame {
      flex: 1;
      min-height: 0;
      background: var(--background);

      &.hidden { display: none; }
    }

    .office-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin: 64px auto;
      max-width: 420px;
      padding: 0 16px;
      text-align: center;
      color: var(--text-secondary);

      .material-icons { font-size: 40px; color: var(--error); }
      p { margin: 0; font-size: 0.9rem; }
    }

    .office-back {
      padding: 6px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text-primary);
      font-size: 0.8125rem;
      cursor: pointer;

      &:hover { background: var(--surface-hover); }
    }

    @media (max-width: 768px) {
      .office-status { display: none; }
      .office-name { margin-right: auto; }
    }
  `]
})
export class OfficeEditorComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) spaceId!: string;
  @Input({ required: true }) path!: string;
  /** True when the file was saved (or nothing needed saving) and should be shown afresh. */
  @Output() closed = new EventEmitter<boolean>();

  private http = inject(HttpClient);
  private caps = inject(CapabilitiesService);
  private toast = inject(ToastService);

  readonly placeholderId = `office-editor-${++instances}`;
  state = signal<'opening' | 'editing' | 'saving'>('opening');
  error = signal<string | null>(null);
  private editor: DocEditor | null = null;
  private destroyed = false;

  fileName(): string {
    return this.path.split('/').pop() ?? this.path;
  }

  async ngAfterViewInit(): Promise<void> {
    const base = this.caps.officeUrl();
    if (!base) {
      this.error.set('Editing Word documents is not set up on this installation.');
      return;
    }
    try {
      const [config] = await Promise.all([
        firstValueFrom(this.http.get<Record<string, unknown>>(`/api/spaces/${this.spaceId}/office/config`, {
          params: {
            path: this.path,
            dark: document.documentElement.getAttribute('data-theme') === 'dark'
          }
        })),
        loadDocsApi(base)
      ]);
      if (this.destroyed || !window.DocsAPI) return;
      this.editor = new window.DocsAPI.DocEditor(this.placeholderId, {
        ...config,
        width: '100%',
        height: '100%',
        events: {
          onDocumentReady: () => this.state.set('editing'),
          onError: (event: { data?: { errorDescription?: string } }) =>
            this.error.set(event?.data?.errorDescription || 'The office editor ran into an error.')
        }
      });
    } catch {
      if (!this.destroyed) {
        this.error.set('The office editor could not be opened. It may be unreachable right now; try again in a moment.');
      }
    }
  }

  /**
   * Save now, wait until the save has arrived, then leave the session. The
   * editor stays connected (only hidden) while saving: the document server skips
   * a save asked for after its last editor has gone. If the save cannot be asked
   * for, leaving still saves once the last editor is gone, so then that is what
   * is waited for.
   */
  async done(): Promise<void> {
    if (this.state() === 'saving') return;
    if (this.error() || !this.editor) {
      this.closed.emit(false);
      return;
    }
    this.state.set('saving');
    const params = { path: this.path };
    let requested: boolean | null = null;
    try {
      requested = (await firstValueFrom(
        this.http.post<{ saving: boolean }>(`/api/spaces/${this.spaceId}/office/save`, null, { params })
      )).saving;
    } catch {
      requested = null;
    }

    let pending = requested === true;
    if (pending) pending = await this.waitFor(state => state.saving);
    this.destroyEditor();
    if (requested === null) pending = await this.waitFor(state => state.open);

    if (pending && !this.destroyed) {
      this.toast.info('Still saving', 'Your changes are kept by the office editor and will appear here once it has saved them.');
    }
    if (!this.destroyed) this.closed.emit(true);
  }

  /** Polls the session until [busy] turns false; true when it was still busy at the deadline. */
  private async waitFor(busy: (state: { open: boolean; saving: boolean }) => boolean): Promise<boolean> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !this.destroyed) {
      await sleep(1000);
      try {
        const state = await firstValueFrom(this.http.get<{ open: boolean; saving: boolean }>(
          `/api/spaces/${this.spaceId}/office/session`, { params: { path: this.path } }
        ));
        if (!busy(state)) return false;
      } catch {
        // keep asking until the deadline
      }
    }
    return true;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroyEditor();
  }

  private destroyEditor(): void {
    try {
      this.editor?.destroyEditor();
    } catch {
      // already gone
    }
    this.editor = null;
  }
}
