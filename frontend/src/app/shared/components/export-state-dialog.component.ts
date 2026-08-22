import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Chooser shown when downloading an HTML file that uses the DocuVault State
 * Library: export the raw file, or a frozen copy with the current state
 * embedded so it works standalone.
 */
@Component({
  selector: 'app-export-state-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="modal-overlay" (click)="closed.emit()">
      <div class="modal export-state-dialog" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>
            <span translate="no" class="material-icons">download</span>
            Export {{ fileName() }}
          </h2>
          <button class="icon-btn" (click)="closed.emit()">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>
        <div class="modal-body">
          <p class="export-intro">
            This file uses DocuVault state. You can include a snapshot of the
            current saved state so the exported file works on its own.
          </p>
          <button class="export-option" (click)="chosen.emit(true)">
            <span translate="no" class="material-icons option-icon">ac_unit</span>
            <span class="option-text">
              <span class="option-title">With frozen state</span>
              <span class="option-hint">
                Embeds the state as of right now. Works standalone &amp; offline;
                the copy is read-only — changes in it are not saved anywhere.
              </span>
            </span>
          </button>
          <button class="export-option" (click)="chosen.emit(false)">
            <span translate="no" class="material-icons option-icon">code</span>
            <span class="option-text">
              <span class="option-title">Without state</span>
              <span class="option-hint">
                The raw file only. It loads live state again when hosted in DocuVault.
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .export-state-dialog { width: 440px; }

    .export-intro {
      margin: 0 0 16px;
      font-size: 14px;
      color: var(--text-secondary);
    }

    .export-option {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
      padding: 14px 16px;
      margin-bottom: 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      cursor: pointer;
      text-align: left;
      transition: border-color 0.15s, background 0.15s;

      &:hover {
        border-color: var(--primary);
        background: var(--surface-hover, #f3f4f6);
      }

      &:last-child { margin-bottom: 0; }
    }

    .option-icon {
      color: var(--primary);
      font-size: 22px;
      margin-top: 2px;
    }

    .option-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .option-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .option-hint {
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.4;
    }
  `],
})
export class ExportStateDialogComponent {
  fileName = input.required<string>();

  /** Emits true for "with frozen state", false for "without state". */
  chosen = output<boolean>();
  closed = output<void>();
}
