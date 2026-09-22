import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Space } from '../../core/api/spaces.service';
import { ATTACHMENT_ACCEPT, Attachment, AttachmentsService } from '../../core/api/attachments.service';
import { VoiceInputButtonComponent } from '../../shared/components/voice-input-button.component';
import { AttachmentTrayComponent } from '../../shared/components/attachment-tray.component';
import { SpaceAvatarComponent } from '../../shared/components/space-avatar.component';
import { AttachmentQueue } from '../../shared/services/attachment-queue';
import { ToastService } from '../../shared/services/toast.service';
import { SpacePickerComponent } from './space-picker.component';

export interface AskSubmission {
  message: string;
  spaceId: string;
  documentPath: string | null;
  attachments?: Attachment[];
}

const LAST_SPACE_KEY = 'docuvault.ask.lastSpace';

/** The space a new question goes to when nothing else says: the one used last time. */
export function rememberedSpaceId(): string | null {
  try {
    return localStorage.getItem(LAST_SPACE_KEY);
  } catch {
    return null;
  }
}

function rememberSpace(spaceId: string): void {
  try {
    localStorage.setItem(LAST_SPACE_KEY, spaceId);
  } catch {
    // Private mode or blocked storage: the picker just won't remember.
  }
}

/**
 * The ask box, on one line: the space (with its logo), the question, files,
 * voice and send. Photos, scans, PDFs and text files can be attached with the
 * paperclip, dropped onto the box or pasted. A conversation that already
 * exists shows its space instead of the picker, since its space cannot change.
 */
@Component({
  selector: 'app-ask-composer',
  standalone: true,
  imports: [FormsModule, VoiceInputButtonComponent, AttachmentTrayComponent, SpaceAvatarComponent, SpacePickerComponent],
  template: `
    <form
      class="ask-composer"
      [class.busy]="busy()"
      [class.dragging]="dragging()"
      (ngSubmit)="send()"
      (dragenter)="onDragOver($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <div class="glow" aria-hidden="true"></div>
      <div class="shell">
        @if (queue.items().length) {
          <app-attachment-tray class="tray" [items]="queue.items()" (removed)="queue.remove($event)" />
        }
        <div class="line">
          @if (fixedSpaceName(); as name) {
            <span class="fixed-space" [title]="'This conversation is about ' + name">
              @if (fixedSpace(); as space) {
                <app-space-avatar [space]="space" size="sm" />
              } @else {
                <span translate="no" class="material-icons">workspaces</span>
              }
              <span class="fixed-name">{{ name }}</span>
            </span>
          } @else {
            <app-space-picker [spaces]="spaces()" [value]="selectedSpaceId()" (changed)="selectSpace($event)" />
          }
          @if (documentPath(); as doc) {
            <span class="doc-chip" [title]="'Answers focus on ' + doc">
              <span translate="no" class="material-icons">description</span>
              <span class="chip-text">{{ doc }}</span>
              @if (!fixedSpaceName()) {
                <button type="button" class="chip-remove" (click)="clearDocument.emit()" title="Ask about the whole space instead">
                  <span translate="no" class="material-icons">close</span>
                </button>
              }
            </span>
          }
          <textarea
            #field
            name="message"
            rows="1"
            [placeholder]="placeholder()"
            [(ngModel)]="text"
            (input)="autoGrow()"
            (keydown)="onKeydown($event)"
            (paste)="onPaste($event)"
            [disabled]="busy()"
            aria-label="Your question"
          ></textarea>
          <div class="actions">
            <button type="button" class="icon-action" (click)="picker.click()" [disabled]="busy()" title="Attach photos, scans, PDFs or text files" aria-label="Attach files">
              <span translate="no" class="material-icons">attach_file</span>
            </button>
            <app-voice-input-button (transcribed)="appendSpoken($event)" />
            <button type="submit" class="send-btn" [disabled]="!canSend()" [title]="queue.uploading() ? 'Waiting for the files to upload' : 'Send (Enter)'" aria-label="Send">
              <span translate="no" class="material-icons">{{ busy() ? 'hourglass_top' : 'arrow_upward' }}</span>
            </button>
          </div>
        </div>
      </div>
      @if (dragging()) {
        <div class="drop-hint" aria-hidden="true">
          <span translate="no" class="material-icons">upload_file</span>Drop photos, scans or files to ask about them
        </div>
      }
      <input #picker type="file" class="file-input" multiple [accept]="accept" (change)="onPicked($event)" tabindex="-1" aria-hidden="true" />
    </form>
  `,
  styles: [`
    @property --glow-angle {
      syntax: '<angle>';
      initial-value: 0deg;
      inherits: true;
    }

    :host { display: block; }

    .ask-composer {
      --glow-colors: #6fb3b8, #38bdf8, #8b5cf6, #ec4899, #f59e0b, #6fb3b8;
      position: relative;
      isolation: isolate;
      animation: glow-spin 7s linear infinite;
    }

    /* The halo: the same colours, blurred, behind the box. It brightens when the box wants attention. */
    .glow {
      position: absolute;
      inset: 2px;
      z-index: -1;
      border-radius: 24px;
      background: conic-gradient(from var(--glow-angle), var(--glow-colors));
      filter: blur(16px);
      opacity: 0.4;
      transition: opacity 0.35s ease, inset 0.35s ease;
    }

    .ask-composer:hover .glow { opacity: 0.52; }
    .ask-composer:focus-within .glow { opacity: 0.68; inset: -2px; }
    .ask-composer.dragging .glow { opacity: 0.95; inset: -6px; }
    .ask-composer.dragging { animation-duration: 2s; }
    .ask-composer.busy { animation-duration: 2.4s; }
    .ask-composer.busy .glow { animation: glow-breathe 1.6s ease-in-out infinite; }

    /* The box: a hairline of moving colour around a calm surface. */
    .shell {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 7px 7px 7px 8px;
      border: 1.5px solid transparent;
      border-radius: 22px;
      background:
        linear-gradient(var(--surface), var(--surface)) padding-box,
        conic-gradient(from var(--glow-angle), var(--glow-colors)) border-box;
    }

    .tray { padding: 3px 2px 0; }

    .line {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      min-width: 0;
      container-type: inline-size;
    }

    .fixed-space {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex-shrink: 0;
      max-width: 220px;
      height: 34px;
      padding: 0 12px 0 5px;
      border-radius: var(--radius-full);
      background: var(--background-darker);
      color: var(--text-secondary);
      font-size: 13.5px;
      font-weight: 600;

      .material-icons { font-size: 18px; margin-left: 4px; }
    }

    .fixed-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .doc-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 1;
      min-width: 0;
      max-width: 220px;
      height: 34px;
      padding: 0 10px;
      border-radius: var(--radius-full);
      background: var(--primary-light);
      color: var(--text-primary);
      font-size: 13px;

      .material-icons { font-size: 16px; }
    }

    .chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .chip-remove {
      display: inline-flex;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      cursor: pointer;

      .material-icons { font-size: 15px; }
    }

    textarea {
      flex: 1;
      min-width: 120px;
      min-height: 34px;
      max-height: 220px;
      padding: 7px 4px;
      border: 0;
      outline: none;
      resize: none;
      background: transparent;
      color: var(--text-primary);
      font: inherit;
      font-size: 15px;
      line-height: 1.35;

      &::placeholder {
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .icon-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;

      .material-icons { font-size: 20px; transform: rotate(45deg); }
      &:hover:not(:disabled) { background: var(--background-darker); color: var(--primary-dark); }
      &:disabled { opacity: 0.5; cursor: default; }
    }

    .send-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      margin-left: 2px;
      border: 0;
      border-radius: var(--radius-full);
      background: linear-gradient(135deg, var(--primary-dark), #7c5cf0 70%, #d946ef);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 4px 14px color-mix(in srgb, #8b5cf6 35%, transparent);
      transition: transform var(--transition-fast), opacity var(--transition-fast), box-shadow var(--transition-fast);

      .material-icons { font-size: 20px; }
      &:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px color-mix(in srgb, #8b5cf6 45%, transparent); }
      &:disabled { opacity: 0.35; cursor: default; box-shadow: none; }
    }

    .drop-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border-radius: 22px;
      background: color-mix(in srgb, var(--surface) 86%, transparent);
      backdrop-filter: blur(2px);
      color: var(--primary-dark);
      font-size: 14px;
      font-weight: 600;
      pointer-events: none;

      .material-icons { font-size: 22px; }
    }

    .file-input { display: none; }

    @container (max-width: 520px) {
      .fixed-name { display: none; }
      .fixed-space { padding-right: 5px; }
      .doc-chip { max-width: 110px; }
    }

    @keyframes glow-spin { to { --glow-angle: 360deg; } }
    @keyframes glow-breathe { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }

    @media (prefers-reduced-motion: reduce) {
      .ask-composer, .ask-composer.busy .glow { animation: none; }
    }
  `]
})
export class AskComposerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('field') field?: ElementRef<HTMLTextAreaElement>;

  private attachmentsService = inject(AttachmentsService);
  private toast = inject(ToastService);

  spaces = input<Space[]>([]);
  /** Set for an existing conversation: its space is shown, not chosen. */
  fixedSpaceName = input<string | null>(null);
  fixedSpaceId = input<string | null>(null);
  initialSpaceId = input<string | null>(null);
  documentPath = input<string | null>(null);
  busy = input(false);
  autofocus = input(false);
  placeholder = input('Ask anything, or drop photos, scans and PDFs');

  submitted = output<AskSubmission>();
  clearDocument = output<void>();

  readonly accept = ATTACHMENT_ACCEPT;
  readonly queue = new AttachmentQueue(this.attachmentsService, this.toast);

  text = '';
  selectedSpaceId = signal<string | null>(null);
  dragging = signal(false);

  fixedSpace = computed(() => this.spaces().find(s => s.id === this.fixedSpaceId()) ?? null);

  constructor() {
    // Pick a sensible space once the list arrives: the one asked for, else the last used, else the first repository.
    effect(() => {
      const spaces = this.spaces();
      if (this.fixedSpaceName()) return;
      const current = this.selectedSpaceId();
      // A space handed in by the page (from the editor, the space menu) counts before the list has loaded,
      // or a question typed quickly would have nowhere to go.
      if (!spaces.length) {
        if (!current && this.initialSpaceId()) this.selectedSpaceId.set(this.initialSpaceId());
        return;
      }
      if (current && spaces.some(s => s.id === current)) return;
      const wanted = [this.initialSpaceId(), rememberedSpaceId()].find(id => id && spaces.some(s => s.id === id));
      this.selectedSpaceId.set(wanted ?? spaces.find(s => s.type === 'REPOSITORY')?.id ?? spaces[0].id);
    }, { allowSignalWrites: true });
  }

  ngAfterViewInit(): void {
    if (this.autofocus()) setTimeout(() => this.focus());
  }

  ngOnDestroy(): void {
    this.queue.destroy();
  }

  focus(): void {
    this.field?.nativeElement.focus();
  }

  selectSpace(spaceId: string): void {
    this.selectedSpaceId.set(spaceId);
    rememberSpace(spaceId);
    this.focus();
  }

  canSend(): boolean {
    const hasContent = this.text.trim().length > 0 || this.queue.ready().length > 0;
    return !this.busy() && !this.queue.uploading() && hasContent && (!!this.fixedSpaceName() || !!this.selectedSpaceId());
  }

  send(): void {
    if (!this.canSend()) return;
    const spaceId = this.selectedSpaceId() ?? '';
    if (spaceId) rememberSpace(spaceId);
    this.submitted.emit({
      message: this.text.trim(),
      spaceId,
      documentPath: this.documentPath(),
      attachments: this.queue.ready()
    });
    this.text = '';
    this.queue.clear();
    setTimeout(() => this.autoGrow());
  }

  appendSpoken(text: string): void {
    this.text = this.text.trim() ? `${this.text.trim()} ${text}` : text;
    setTimeout(() => {
      this.autoGrow();
      this.focus();
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.queue.add(input.files);
    input.value = '';
    this.focus();
  }

  /** A screenshot or photo on the clipboard is attached; pasted text stays text. */
  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length || this.busy()) return;
    event.preventDefault();
    this.queue.add(files);
  }

  onDragOver(event: DragEvent): void {
    if (this.busy() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    this.dragging.set(false);
    const files = event.dataTransfer?.files;
    if (!files?.length || this.busy()) return;
    event.preventDefault();
    this.queue.add(files);
    this.focus();
  }

  autoGrow(): void {
    const el = this.field?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }
}
