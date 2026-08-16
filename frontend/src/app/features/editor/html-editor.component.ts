import { CommonModule } from '@angular/common';
import {
  Component, ElementRef, EventEmitter, HostListener, Input, NgZone,
  OnDestroy, OnInit, Output, ViewChild, computed, inject, signal
} from '@angular/core';
import { Observable, Subject, of, takeUntil } from 'rxjs';
import { DocumentsService } from '../../core/api/documents.service';
import { DocumentHistoryService, DocumentVersion } from '../../core/api/document-history.service';
import { ToastService } from '../../shared/services/toast.service';
import { VersionHistoryPanelComponent } from '../../shared/components/version-history-panel.component';
import { buildFrameDocument, spliceBodyHtml } from '../../shared/utils/html-document';

type EditorMode = 'visual' | 'code';

/** An open confirmation dialog. `leave` is the one a route guard is waiting on. */
interface ConfirmState {
  kind: 'revert' | 'close' | 'leave' | 'restore';
  title: string;
  message: string;
  hint?: string;
  confirmLabel: string;
  danger: boolean;
  version?: DocumentVersion;
}

/**
 * WYSIWYG editor for a whole `.html` file, deliberately without autosave.
 *
 * Editing happens inside the preview iframe itself (`contenteditable` on its
 * body), so the file's own CSS decides what the user sees. Scripts are off
 * while editing — a page that rewrites its own DOM would otherwise fight the
 * caret and land its generated markup in the saved file.
 *
 * Round-tripping markup through `contenteditable` is lossy by nature: the
 * browser reserialises whatever it parsed. That is why nothing is written until
 * the user presses Save (each save is one commit, so every state is reachable
 * again from the history drawer), why Revert throws the working copy away, and
 * why leaving with unsaved work has to be confirmed. The HTML tab is the escape
 * hatch: it edits the exact source, head and scripts included.
 */
@Component({
  selector: 'app-html-editor',
  standalone: true,
  imports: [CommonModule, VersionHistoryPanelComponent],
  template: `
    <div class="html-editor" [class.with-history]="showHistory()">
      <div class="html-editor-bar">
        <div class="mode-toggle">
          <button
            type="button"
            class="mode-btn"
            [class.active]="mode() === 'visual'"
            [disabled]="loading()"
            (click)="setMode('visual')"
          >Visual</button>
          <button
            type="button"
            class="mode-btn"
            [class.active]="mode() === 'code'"
            [disabled]="loading()"
            (click)="setMode('code')"
          >HTML</button>
        </div>

        @if (mode() === 'visual' && !viewingVersion()) {
          <span class="html-editor-hint" title="The page's own JavaScript is paused while you edit, so it cannot rewrite what you are typing into.">
            Scripts paused while editing
          </span>
        }

        <span class="html-editor-status">
          @if (saving()) {
            Saving…
          } @else if (dirty()) {
            Unsaved changes
          } @else if (justSaved()) {
            Saved
          }
        </span>

        <div class="html-editor-actions">
          <button type="button" class="html-editor-btn" (click)="toggleHistory()" title="Version history">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            History
          </button>
          <button
            type="button"
            class="html-editor-btn"
            [disabled]="!dirty() || saving()"
            (click)="askRevert()"
            title="Throw the unsaved changes away and go back to the last saved version"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
            </svg>
            Revert
          </button>
          <button
            type="button"
            class="html-editor-save"
            [disabled]="!dirty() || saving() || !!viewingVersion()"
            (click)="save()"
            title="Save this file as a new version"
          >
            @if (saving()) {
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            } @else {
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
              </svg>
            }
            Save
          </button>
          <button type="button" class="html-editor-btn" (click)="exit()" title="Close the editor">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            Close
          </button>
        </div>
      </div>

      @if (viewingVersion(); as version) {
        <div class="version-banner">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span>
            Viewing the version from
            <strong>{{ version.committedAt | date:'MMM d, y, HH:mm' }}</strong>
            @if (version.authorName) { by {{ version.authorName }} } — read-only.
          </span>
          <div class="version-banner-actions">
            <button type="button" class="version-btn" [disabled]="restoring()" (click)="askRestore(version)">
              @if (restoring()) {
                <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Restore this version
            </button>
            <button type="button" class="version-btn" (click)="backToCurrent()">Back to current</button>
          </div>
        </div>
      }

      <div class="html-editor-surface">
        @if (loading()) {
          <div class="html-editor-loading">
            <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if (mode() === 'visual') {
          <!-- allow-same-origin (and nothing else) on purpose: the parent needs
               contentDocument to make the body editable, while the page's own
               scripts stay off for the duration of the edit. -->
          <iframe
            #frame
            class="html-edit-frame"
            sandbox="allow-same-origin"
            (load)="onFrameLoad()"
          ></iframe>
        } @else {
          <textarea
            #code
            class="html-code"
            spellcheck="false"
            [readonly]="!!viewingVersion()"
            (input)="onCodeInput()"
            (keydown)="onCodeKeydown($event)"
          ></textarea>
        }
      </div>

      @if (showHistory()) {
        <app-version-history-panel
          [versions]="versions()"
          [loading]="historyLoading()"
          [activeSha]="viewingVersion()?.sha ?? null"
          [loadingSha]="versionLoadingSha()"
          [showDiff]="false"
          (view)="viewVersion($event)"
          (closed)="showHistory.set(false)"
        />
      }

      @if (confirmState(); as c) {
        <div class="modal-overlay" (click)="cancelConfirm()">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>{{ c.title }}</h2>
            </div>
            <div class="modal-body">
              <p>{{ c.message }}</p>
              @if (c.hint) {
                <p class="modal-hint">{{ c.hint }}</p>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" (click)="cancelConfirm()">Keep editing</button>
              <button
                type="button"
                class="btn"
                [class.btn-danger]="c.danger"
                [class.btn-primary]="!c.danger"
                (click)="applyConfirm()"
              >{{ c.confirmLabel }}</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      /* Takes the space the preview would have had, so the editing iframe can
         stretch instead of falling back to its 150px intrinsic height. */
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .html-editor {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--background-darker);

      /* The drawer is positioned over the editor, so the editor gives up the
         width instead — otherwise it covers the version banner's own Restore
         button, which is exactly what the drawer sends people to. */
      &.with-history {
        padding-right: 320px;
      }
    }

    .html-editor-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .mode-toggle {
      display: flex;
      flex-shrink: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    .mode-btn {
      padding: 5px 14px;
      border: none;
      background: var(--surface);
      color: var(--text-secondary);
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--surface-hover);
      }

      &.active {
        background: var(--primary);
        color: white;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    /* The buttons keep their size and the hint gives way, so a narrow editor
       (history drawer open) never squeezes an action off the bar. */
    .html-editor-hint {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.75rem;
      color: var(--text-muted);
      cursor: help;
    }

    .html-editor-status {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .html-editor-actions {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      gap: 8px;
    }

    .html-editor-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text-secondary);
      font-size: 0.8125rem;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--surface-hover);
        color: var(--text-primary);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .html-editor-save {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border: none;
      border-radius: 6px;
      background: var(--primary);
      color: white;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--primary-dark);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .version-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--primary) 10%, var(--surface));
      color: var(--text-primary);
      font-size: 0.8125rem;
    }

    .version-banner-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .version-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text-secondary);
      font-size: 0.75rem;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--surface-hover);
        color: var(--text-primary);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .html-editor-surface {
      flex: 1;
      display: flex;
      min-height: 0;
    }

    .html-editor-loading {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }

    .html-edit-frame {
      flex: 1;
      width: 100%;
      border: none;
      background: var(--surface);
    }

    .html-code {
      flex: 1;
      width: 100%;
      padding: 16px 20px;
      border: none;
      resize: none;
      outline: none;
      background: var(--surface);
      color: var(--text-primary);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
      line-height: 1.6;
      tab-size: 2;
      white-space: pre;
    }
  `]
})
export class HtmlEditorComponent implements OnInit, OnDestroy {
  /** Space the file lives in. */
  @Input({ required: true }) spaceId!: string;
  /** Repo-relative path of the `.html` file being edited. */
  @Input({ required: true }) path!: string;

  /** The user is done editing — the host goes back to the plain preview. */
  @Output() closed = new EventEmitter<void>();
  /** A new version was written, so the host can refresh what it shows. */
  @Output() saved = new EventEmitter<void>();

  private readonly documentsService = inject(DocumentsService);
  private readonly historyService = inject(DocumentHistoryService);
  private readonly toast = inject(ToastService);
  private readonly zone = inject(NgZone);
  private readonly destroy$ = new Subject<void>();

  loading = signal(true);
  saving = signal(false);
  restoring = signal(false);
  mode = signal<EditorMode>('visual');
  /** Unsaved edits exist — the only thing standing between them and being lost. */
  dirty = signal(false);
  justSaved = signal(false);
  confirmState = signal<ConfirmState | null>(null);

  showHistory = signal(false);
  versions = signal<DocumentVersion[]>([]);
  historyLoading = signal(false);
  versionLoadingSha = signal<string | null>(null);
  /** Historical version being previewed, or null while the working copy is shown. */
  viewingVersion = signal<DocumentVersion | null>(null);

  /** Working copy of the whole file. In visual mode the iframe holds the newer
   *  body; this is re-synced from it whenever the full source is needed. */
  private working = signal('');
  /** Source of the version being previewed (read-only). */
  private versionSource = signal('');
  /** Last content the server acknowledged — what Revert goes back to. */
  private savedSource = '';
  /** Title of the Document row, preserved across saves. */
  private docTitle = '';

  private frameEl: HTMLIFrameElement | null = null;
  private codeEl: HTMLTextAreaElement | null = null;
  private editedDoc: Document | null = null;
  /** A route guard waiting for the user to answer the leave dialog. */
  private leaveAnswer: Subject<boolean> | null = null;

  fileName = computed(() => this.path?.split('/').pop() ?? this.path);

  @ViewChild('frame')
  set frameRef(ref: ElementRef<HTMLIFrameElement> | undefined) {
    this.frameEl = ref?.nativeElement ?? null;
    if (this.frameEl) this.renderFrame();
  }

  @ViewChild('code')
  set codeRef(ref: ElementRef<HTMLTextAreaElement> | undefined) {
    this.codeEl = ref?.nativeElement ?? null;
    if (this.codeEl) this.codeEl.value = this.displaySource();
  }

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.detachFrame();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Unsaved edits live in the browser only — no autosave writes them out — so
   * closing or reloading the tab has to go through the browser's own warning.
   */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private load(): void {
    this.loading.set(true);
    this.documentsService.getDocument(this.spaceId, this.path)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (doc) => {
          this.docTitle = doc.title || '';
          this.savedSource = doc.content;
          this.working.set(doc.content);
          this.dirty.set(false);
          this.loading.set(false);
          this.refreshSurface();
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('Could not open the file', `${this.fileName()} could not be loaded for editing.`);
          this.closed.emit();
        }
      });
  }

  // --- Editing surface ---

  /** What the surface shows: a historical version, or the working copy. */
  private displaySource(): string {
    return this.viewingVersion() ? this.versionSource() : this.working();
  }

  /** Re-render whichever surface is mounted, after the source changed underneath it. */
  private refreshSurface(): void {
    if (this.mode() === 'visual') {
      this.renderFrame();
    } else if (this.codeEl) {
      this.codeEl.value = this.displaySource();
    }
  }

  private renderFrame(): void {
    if (!this.frameEl) return;
    this.detachFrame();
    this.frameEl.srcdoc = buildFrameDocument(this.displaySource(), this.baseHref());
  }

  /** Directory the file sits in, as the API serves it — the iframe's `<base>`. */
  private baseHref(): string {
    const dir = this.path.substring(0, this.path.lastIndexOf('/') + 1);
    return `/api/spaces/${this.spaceId}/files/${dir}`;
  }

  onFrameLoad(): void {
    const doc = this.frameEl?.contentDocument;
    if (!doc?.body) return;
    const editable = !this.viewingVersion();
    doc.body.contentEditable = editable ? 'true' : 'false';
    if (!editable) return;
    doc.addEventListener('input', this.onFrameInput);
    this.editedDoc = doc;
  }

  /**
   * The iframe has its own window, so zone.js never patched its listeners —
   * without re-entering the zone the dirty flag would change without anything
   * re-rendering the toolbar.
   */
  private onFrameInput = (): void => {
    this.zone.run(() => this.markDirty());
  };

  private detachFrame(): void {
    this.editedDoc?.removeEventListener('input', this.onFrameInput);
    this.editedDoc = null;
  }

  onCodeInput(): void {
    if (this.viewingVersion()) return;
    this.markDirty();
  }

  /** Tab indents instead of leaving the textarea — this is a code surface. */
  onCodeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.codeEl) return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = this.codeEl;
    this.codeEl.value = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd);
    this.codeEl.selectionStart = this.codeEl.selectionEnd = selectionStart + 2;
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty.set(true);
    this.justSaved.set(false);
  }

  /** The whole file as it stands right now, including unsaved edits. */
  private currentSource(): string {
    if (this.viewingVersion()) return this.versionSource();
    if (this.mode() === 'code') return this.codeEl?.value ?? this.working();
    const body = this.frameEl?.contentDocument?.body;
    return body ? spliceBodyHtml(this.working(), body.innerHTML) : this.working();
  }

  setMode(mode: EditorMode): void {
    if (mode === this.mode()) return;
    // Carry the edits of the surface being left over into the working copy,
    // otherwise switching tabs would silently drop them.
    if (!this.viewingVersion()) this.working.set(this.currentSource());
    this.mode.set(mode);
  }

  // --- Saving ---

  save(): void {
    if (this.saving() || this.viewingVersion()) return;
    const content = this.currentSource();

    this.saving.set(true);
    this.documentsService.updateDocument(this.spaceId, this.path, {
      title: this.docTitle || undefined,
      content,
      autoCommit: true,
      commitMessage: `Update ${this.fileName()}`
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.savedSource = content;
          this.working.set(content);
          this.dirty.set(false);
          this.justSaved.set(true);
          this.saved.emit();
          if (this.showHistory()) this.loadHistory();
          this.toast.success('Saved', `${this.fileName()} was saved as a new version.`);
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(
            'Could not save',
            'Your changes are still in the editor but could not be stored. Please try again.'
          );
        }
      });
  }

  // --- Reverting, closing, leaving ---

  askRevert(): void {
    if (!this.dirty()) return;
    this.confirmState.set({
      kind: 'revert',
      title: 'Discard your changes?',
      message: `Everything edited since the last save goes away and ${this.fileName()} goes back to its last saved version.`,
      hint: 'Saved versions are not affected — you can always come back to them from the history.',
      confirmLabel: 'Discard changes',
      danger: true
    });
  }

  exit(): void {
    if (!this.dirty()) {
      this.closed.emit();
      return;
    }
    this.confirmState.set({
      kind: 'close',
      title: 'Close without saving?',
      message: `${this.fileName()} has changes that were never saved. Closing the editor throws them away.`,
      confirmLabel: 'Close without saving',
      danger: true
    });
  }

  /**
   * Route-guard hook: leaving the page drops the working copy, so ask first.
   * Resolves true once the user has decided it is fine to go.
   */
  confirmLeave(): Observable<boolean> {
    if (!this.dirty()) return of(true);
    this.leaveAnswer?.next(false);
    const answer = new Subject<boolean>();
    this.leaveAnswer = answer;
    this.confirmState.set({
      kind: 'leave',
      title: 'Leave without saving?',
      message: `${this.fileName()} has changes that were never saved. Leaving this page throws them away.`,
      confirmLabel: 'Leave without saving',
      danger: true
    });
    return answer.asObservable();
  }

  cancelConfirm(): void {
    const state = this.confirmState();
    this.confirmState.set(null);
    if (state?.kind === 'leave') this.answerLeave(false);
  }

  applyConfirm(): void {
    const state = this.confirmState();
    this.confirmState.set(null);
    if (!state) return;

    switch (state.kind) {
      case 'revert':
        this.revert();
        break;
      case 'close':
        this.dirty.set(false);
        this.closed.emit();
        break;
      case 'leave':
        this.dirty.set(false);
        this.answerLeave(true);
        break;
      case 'restore':
        if (state.version) this.restore(state.version);
        break;
    }
  }

  private answerLeave(allowed: boolean): void {
    this.leaveAnswer?.next(allowed);
    this.leaveAnswer?.complete();
    this.leaveAnswer = null;
  }

  private revert(): void {
    this.working.set(this.savedSource);
    this.dirty.set(false);
    this.justSaved.set(false);
    this.refreshSurface();
  }

  // --- Version history ---

  toggleHistory(): void {
    const open = !this.showHistory();
    this.showHistory.set(open);
    if (open) this.loadHistory();
  }

  private loadHistory(): void {
    this.historyLoading.set(true);
    this.historyService.getHistory(this.spaceId, this.path)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (versions) => {
          this.versions.set(versions);
          this.historyLoading.set(false);
        },
        error: () => {
          this.historyLoading.set(false);
          this.toast.error('History unavailable', 'Could not load the version history for this file.');
        }
      });
  }

  /**
   * Preview an older version read-only. The working copy is kept in memory, so
   * looking at history never costs the user their unsaved edits.
   */
  viewVersion(version: DocumentVersion): void {
    if (this.versionLoadingSha()) return;
    if (version.sha === this.versions()[0]?.sha) {
      this.backToCurrent();
      return;
    }
    if (this.viewingVersion()?.sha === version.sha) return;

    // Leaving the editing surface: keep whatever is in it before swapping in
    // the historical content.
    if (!this.viewingVersion()) this.working.set(this.currentSource());

    this.versionLoadingSha.set(version.sha);
    this.historyService.getVersionContent(this.spaceId, this.path, version.sha)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.versionLoadingSha.set(null);
          this.versionSource.set(res.content);
          this.viewingVersion.set(version);
          this.refreshSurface();
        },
        error: () => {
          this.versionLoadingSha.set(null);
          this.toast.error('Version unavailable', 'Could not load this version. Please try again.');
        }
      });
  }

  backToCurrent(): void {
    if (!this.viewingVersion()) return;
    this.viewingVersion.set(null);
    this.versionSource.set('');
    this.refreshSurface();
  }

  askRestore(version: DocumentVersion): void {
    this.confirmState.set({
      kind: 'restore',
      title: 'Restore this version?',
      message: `${this.fileName()} goes back to the version you are viewing, written as a new version on top of the history.`,
      hint: this.dirty()
        ? 'Your unsaved changes are discarded by the restore.'
        : 'Nothing is lost — the version you are on now stays in the history.',
      confirmLabel: 'Restore this version',
      danger: false,
      version
    });
  }

  private restore(version: DocumentVersion): void {
    if (this.restoring()) return;
    this.restoring.set(true);
    this.historyService.restoreVersion(this.spaceId, this.path, version.sha)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.restoring.set(false);
          this.viewingVersion.set(null);
          this.versionSource.set('');
          this.dirty.set(false);
          this.load();
          this.loadHistory();
          this.saved.emit();
          this.toast.success(
            'Version restored',
            'The file was restored — the state you came from stays available in the history.'
          );
        },
        error: () => {
          this.restoring.set(false);
          this.toast.error('Restore failed', 'Could not restore this version. Please try again.');
        }
      });
  }
}
