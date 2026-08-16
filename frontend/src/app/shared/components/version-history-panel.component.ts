import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentVersion } from '../../core/api/document-history.service';

/**
 * Version-history drawer for a single file: its commit track, newest first.
 * Shared by the Markdown editor and the HTML editor — the panel only reports
 * clicks, the host decides what showing or restoring a version means.
 */
@Component({
  selector: 'app-version-history-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="history-panel" (click)="$event.stopPropagation()">
      <div class="history-header">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>Version history</span>
        <button class="editor-icon-btn ml-auto" title="Close" (click)="closed.emit()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      @if (loading) {
        <div class="history-loading">
          <svg class="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (versions.length === 0) {
        <p class="history-empty">
          No versions recorded yet. Every save from now on becomes a version you can
          come back to here.
        </p>
      } @else {
        <div class="history-list">
          @for (v of versions; track v.sha; let i = $index) {
            <div class="history-item-wrap">
              <button
                type="button"
                class="history-item"
                [class.active]="activeSha === v.sha || (i === 0 && !activeSha)"
                (click)="view.emit(v)"
              >
                <div class="history-item-top">
                  <span class="history-item-date">{{ v.committedAt | date:'MMM d, y, HH:mm' }}</span>
                  @if (i === 0) {
                    <span class="history-badge-current">Current</span>
                  }
                  @if (loadingSha === v.sha) {
                    <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                </div>
                @if (v.message) {
                  <div class="history-item-msg">{{ v.message }}</div>
                }
                @if (v.authorName) {
                  <div class="history-item-author">{{ v.authorName }}</div>
                }
              </button>
              @if (showDiff) {
                <button
                  type="button"
                  class="history-item-diff"
                  title="Show changes in this version"
                  [class.active]="activeSha === v.sha && diffActive"
                  (click)="diff.emit(v); $event.stopPropagation()"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5v14m-3-3h6M15 8h6"/>
                  </svg>
                </button>
              }
            </div>
          }
        </div>
      }
    </aside>
  `,
  styles: [`
    .history-panel {
      /* Anchored to the host editor (position: relative), not the viewport —
         a fixed top:0 panel would hide its header under the app header bar. */
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 320px;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: var(--shadow-lg);
      z-index: 60;
    }

    .history-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-primary);
    }

    .editor-icon-btn {
      padding: 6px 8px;
      border-radius: 6px;
      border: none;
      background: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;

      &:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }
    }

    .history-loading {
      display: flex;
      justify-content: center;
      padding: 32px 0;
      color: var(--text-muted);
    }

    .history-empty {
      padding: 20px 16px;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .history-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .history-item-wrap {
      position: relative;

      &:hover .history-item-diff,
      .history-item-diff.active {
        opacity: 1;
      }
    }

    .history-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;

      &:hover {
        background: var(--surface-hover);
      }

      &.active {
        border-color: var(--primary);
        background: color-mix(in srgb, var(--primary) 8%, var(--surface));
      }
    }

    .history-item-diff {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-secondary);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition);

      &:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }

      &.active {
        border-color: var(--primary);
        color: var(--primary);
      }
    }

    .history-item-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .history-item-date {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .history-badge-current {
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--primary);
      color: white;
      font-size: 0.6875rem;
      font-weight: 600;
    }

    .history-item-msg {
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .history-item-author {
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
  `]
})
export class VersionHistoryPanelComponent {
  @Input() versions: DocumentVersion[] = [];
  @Input() loading = false;
  /** Version being shown right now, or null while the live file is. */
  @Input() activeSha: string | null = null;
  /** Version whose content is still being fetched. */
  @Input() loadingSha: string | null = null;
  /** The active version is shown as a diff rather than as content. */
  @Input() diffActive = false;
  /** Hosts without a diff view (the HTML editor) hide the per-entry diff button. */
  @Input() showDiff = true;

  @Output() view = new EventEmitter<DocumentVersion>();
  @Output() diff = new EventEmitter<DocumentVersion>();
  @Output() closed = new EventEmitter<void>();
}
