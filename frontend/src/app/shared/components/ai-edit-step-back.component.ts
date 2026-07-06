import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../core/api/documents.service';
import { ToastService } from '../services/toast.service';

export interface AiEditUndoState {
  path: string;
  previousContent: string;
}

/**
 * Step-back banner shown after an AI edit. Offers a read-only preview of the
 * pre-edit version (the host renders it — nothing is written) and a revert
 * that must be confirmed before the previous content is committed back.
 */
@Component({
  selector: 'app-ai-edit-step-back',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (undo) {
      <div class="ai-undo-banner" [class.previewing]="viewingPrevious">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>
        </svg>
        @if (viewingPrevious) {
          <span>Previous version (before the AI edit) — preview only, the file is unchanged.</span>
          <button type="button" class="ai-undo-btn" (click)="showCurrent.emit()">
            Show current version
          </button>
          <button type="button" class="ai-undo-btn ai-undo-btn--primary" (click)="confirming.set(true)" [disabled]="reverting()">
            Revert to this version…
          </button>
        } @else {
          <span>AI edit applied and committed.</span>
          @if (canPreview) {
            <button type="button" class="ai-undo-btn" (click)="showPrevious.emit(undo.previousContent)">
              Show previous version
            </button>
          } @else {
            <button type="button" class="ai-undo-btn" (click)="confirming.set(true)" [disabled]="reverting()">
              Revert AI edit…
            </button>
          }
          <button type="button" class="ai-undo-dismiss" (click)="dismissed.emit()" title="Dismiss">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        }
      </div>

      @if (confirming()) {
        <div class="ai-modal-overlay" (click)="confirming.set(false)">
          <div class="ai-revert-modal" (click)="$event.stopPropagation()">
            <div class="ai-revert-modal-header">
              <h2>Revert AI edit</h2>
              <button class="ai-revert-close" (click)="confirming.set(false)" [disabled]="reverting()">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="ai-revert-modal-body">
              <p>Restore the version of <strong>{{ fileName() }}</strong> from before the AI edit?</p>
              <p class="ai-revert-hint">The restored version is saved as a new commit — nothing is lost from the history.</p>
            </div>
            <div class="ai-revert-modal-footer">
              <button type="button" class="ai-btn-secondary" (click)="confirming.set(false)" [disabled]="reverting()">Cancel</button>
              <button type="button" class="ai-btn-primary" (click)="revert()" [disabled]="reverting()">
                @if (reverting()) {
                  Reverting…
                } @else {
                  Revert & commit
                }
              </button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .ai-undo-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.75rem 0;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text-primary);
      font-size: 0.875rem;

      > svg {
        color: var(--primary);
        flex-shrink: 0;
      }
    }

    .ai-undo-banner.previewing {
      border-color: var(--primary);
      background: var(--background);
    }

    .ai-undo-banner .ai-undo-btn:first-of-type {
      margin-left: auto;
    }

    .ai-undo-btn {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.25rem 0.625rem;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-primary);
      background: var(--background);
      cursor: pointer;
      white-space: nowrap;

      &:hover:not(:disabled) {
        background: var(--background-darker);
      }

      &:disabled {
        opacity: 0.6;
        cursor: default;
      }
    }

    .ai-undo-btn.ai-undo-btn--primary {
      border-color: var(--primary);
      background: var(--primary);
      color: #fff;

      &:hover:not(:disabled) {
        background: var(--primary-dark, #2563eb);
      }
    }

    .ai-undo-dismiss {
      display: flex;
      align-items: center;
      color: var(--text-muted);
      cursor: pointer;
      background: none;
      border: none;
      padding: 2px;

      &:hover {
        color: var(--text-primary);
      }
    }

    .ai-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
    }

    .ai-revert-modal {
      background: var(--surface);
      border-radius: 12px;
      width: 100%;
      max-width: 440px;
      box-shadow: var(--shadow-lg);
    }

    .ai-revert-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
      }
    }

    .ai-revert-close {
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

    .ai-revert-modal-body {
      padding: 1.25rem 1.5rem;

      p {
        color: var(--text-primary);
        font-size: 0.9375rem;
        line-height: 1.5;
      }
    }

    .ai-revert-hint {
      color: var(--text-muted) !important;
      font-size: 0.8125rem !important;
      margin-top: 0.5rem;
    }

    .ai-revert-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
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
  `]
})
export class AiEditStepBackComponent {
  @Input({ required: true }) spaceId!: string;
  @Input() undo: AiEditUndoState | null = null;
  /** Whether the host is currently rendering the previous version. */
  @Input() viewingPrevious = false;
  /** False for render modes the host can't swap inline (iframes etc.) — offers direct revert instead. */
  @Input() canPreview = true;

  @Output() showPrevious = new EventEmitter<string>();
  @Output() showCurrent = new EventEmitter<void>();
  @Output() dismissed = new EventEmitter<void>();
  @Output() reverted = new EventEmitter<void>();

  confirming = signal(false);
  reverting = signal(false);

  constructor(
    private documentsService: DocumentsService,
    private toastService: ToastService
  ) {}

  fileName(): string {
    return this.undo?.path.split('/').pop() || '';
  }

  revert(): void {
    const undo = this.undo;
    if (!undo || this.reverting()) return;
    this.reverting.set(true);
    this.documentsService.updateDocument(this.spaceId, undo.path, {
      content: undo.previousContent,
      autoCommit: true,
      commitMessage: 'Revert AI edit'
    }).subscribe({
      next: () => {
        this.reverting.set(false);
        this.confirming.set(false);
        this.toastService.success('AI edit reverted', 'The previous version was restored and committed.');
        this.reverted.emit();
      },
      error: () => {
        this.reverting.set(false);
        this.confirming.set(false);
        this.toastService.error('Revert failed', 'Could not restore the previous version. Please try again.');
      }
    });
  }
}
