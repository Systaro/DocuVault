import { Component, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService, AiEditResult } from '../../core/api/ai.service';
import { ToastService } from '../services/toast.service';

/**
 * "Edit via AI" side panel: takes a free-form instruction, sends it to the AI
 * edit endpoint (which rewrites the file and saves the result as a commit) and
 * emits the result — including the previous content that powers the step-back
 * banner. Rendered as a right-hand drawer without a backdrop, so the document
 * stays visible and scrollable while writing the instruction.
 */
@Component({
  selector: 'app-ai-edit-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <aside class="ai-edit-panel" role="dialog" aria-label="Edit via AI">
      <div class="ai-edit-panel-header">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>
        </svg>
        <h2>Edit via AI</h2>
        <button class="ai-edit-close" (click)="close()" [disabled]="editing()" title="Close">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="ai-edit-panel-body">
        @if (editing()) {
          <div class="ai-edit-progress">
            <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p>The AI is editing <strong>{{ fileName() }}</strong>…</p>
            <p class="ai-edit-hint">The result is saved as a new commit — you can review and revert it afterwards.</p>
          </div>
        } @else {
          <p class="ai-edit-intro">
            Describe the change to make to <strong>{{ fileName() }}</strong>.
            The AI edits the file and saves the result as a commit you can revert.
          </p>
          <textarea
            class="ai-edit-textarea"
            [(ngModel)]="instruction"
            rows="6"
            placeholder="e.g. Fix all typos and tighten the introduction section"
          ></textarea>
          @if (error()) {
            <p class="ai-edit-error">{{ error() }}</p>
          }
        }
      </div>
      <div class="ai-edit-panel-footer">
        <button type="button" class="ai-btn-secondary" (click)="close()" [disabled]="editing()">Cancel</button>
        <button type="button" class="ai-btn-primary" (click)="apply()" [disabled]="!canApply()">
          @if (editing()) {
            Editing…
          } @else {
            Apply
          }
        </button>
      </div>
    </aside>
  `,
  styles: [`
    .ai-edit-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 400px;
      max-width: 100vw;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
      z-index: 1000;
      animation: ai-edit-slide-in 0.2s ease;
    }

    @keyframes ai-edit-slide-in {
      from { transform: translateX(100%); }
      to { transform: none; }
    }

    .ai-edit-panel-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);

      > svg {
        color: var(--primary);
        flex-shrink: 0;
      }

      h2 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
      }
    }

    .ai-edit-close {
      display: flex;
      align-items: center;
      color: var(--text-muted);
      cursor: pointer;
      background: none;
      border: none;
      padding: 4px;

      &:hover:not(:disabled) {
        color: var(--text-primary);
      }
    }

    .ai-edit-panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.25rem;
    }

    .ai-edit-intro {
      color: var(--text-primary);
      font-size: 0.9375rem;
      line-height: 1.5;
      margin-bottom: 0.75rem;
    }

    .ai-edit-textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.625rem 0.75rem;
      font-size: 0.9375rem;
      color: var(--text-primary);
      background: var(--background);
      resize: vertical;

      &:focus {
        outline: none;
        border-color: var(--primary);
      }
    }

    .ai-edit-error {
      margin-top: 0.5rem;
      color: #dc2626;
      font-size: 0.8125rem;
    }

    .ai-edit-hint {
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .ai-edit-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 2rem 0;
      text-align: center;

      svg {
        color: var(--primary);
      }

      p {
        color: var(--text-primary);
        font-size: 0.9375rem;
      }
    }

    .ai-edit-panel-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border);
    }

    .ai-btn-secondary {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--background);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .ai-btn-primary {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      background: var(--primary);
      color: white;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--primary-dark, #2563eb);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    @media (max-width: 640px) {
      .ai-edit-panel {
        width: 100%;
      }
    }
  `]
})
export class AiEditDialogComponent {
  @Input({ required: true }) spaceId!: string;
  @Input({ required: true }) filePath!: string;
  @Output() closed = new EventEmitter<void>();
  @Output() applied = new EventEmitter<AiEditResult>();

  instruction = '';
  editing = signal(false);
  error = signal<string | null>(null);

  constructor(
    private aiService: AiService,
    private toastService: ToastService
  ) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  fileName(): string {
    return this.filePath.split('/').pop() || this.filePath;
  }

  // Plain method (not computed): instruction is ngModel-bound, so a computed
  // would never re-evaluate when it changes.
  canApply(): boolean {
    return !this.editing() && this.instruction.trim().length > 0;
  }

  close(): void {
    if (this.editing()) return;
    this.closed.emit();
  }

  apply(): void {
    if (!this.canApply()) return;
    const instruction = this.instruction.trim();
    this.editing.set(true);
    this.error.set(null);
    this.aiService.editDocument(this.spaceId, this.filePath, instruction).subscribe({
      next: (result) => {
        this.editing.set(false);
        this.instruction = '';
        this.toastService.success('AI edit applied', 'The document was updated and saved as a commit.');
        this.applied.emit(result);
      },
      error: (err) => {
        this.editing.set(false);
        this.error.set(err.error?.error || err.error?.message || 'The AI edit failed. Please try again.');
      }
    });
  }
}
