import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EditProposal } from '../../core/api/ai.service';
import { spaceRoute } from '../../shared/utils/route-utils';

interface DiffLine {
  kind: 'context' | 'removed' | 'added';
  text: string;
}

/**
 * A change the assistant proposed to an existing document. Nothing is written
 * until the user applies it; the card shows exactly which lines change, with a
 * few unchanged lines around them for orientation.
 */
@Component({
  selector: 'app-proposal-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="proposal" [class]="'proposal status-' + proposal().status.toLowerCase()">
      <div class="proposal-header">
        <span translate="no" class="material-icons">edit_note</span>
        <div class="proposal-title">
          <span class="proposal-summary">{{ proposal().summary }}</span>
          @if (proposal().spaceFullPath) {
            <a class="proposal-path" [routerLink]="docRoute()" [queryParams]="{ path: proposal().path }">{{ proposal().path }}</a>
          } @else {
            <span class="proposal-path">{{ proposal().path }}</span>
          }
        </div>
        <span class="proposal-state">{{ stateLabel() }}</span>
      </div>

      <pre class="proposal-diff" translate="no">@for (line of lines(); track $index) {<span class="diff-line" [class]="'diff-line ' + line.kind">{{ line.kind === 'removed' ? '-' : line.kind === 'added' ? '+' : ' ' }} {{ line.text }}
</span>}</pre>

      @if (proposal().error) {
        <p class="proposal-error">
          <span translate="no" class="material-icons">error_outline</span>{{ proposal().error }}
        </p>
      }

      @if (proposal().status === 'PENDING') {
        <div class="proposal-actions">
          <button type="button" class="btn btn-ghost" [disabled]="working()" (click)="discard.emit()">Discard</button>
          <button type="button" class="btn btn-primary" [disabled]="working()" (click)="apply.emit()">
            <span translate="no" class="material-icons">check</span>Apply
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .proposal {
      margin-top: var(--spacing-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      overflow: hidden;

      &.status-applied { border-color: var(--success); }
      &.status-failed { border-color: var(--error); }
      &.status-discarded { opacity: 0.7; }
    }

    .proposal-header {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-light);

      > .material-icons { color: var(--primary-dark); font-size: 20px; }
    }

    .proposal-title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .proposal-summary { font-weight: 600; font-size: 14px; color: var(--text-primary); }

    .proposal-path {
      font-size: 12px;
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }

    a.proposal-path:hover { color: var(--primary-dark); }

    .proposal-state {
      flex-shrink: 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .status-applied .proposal-state { color: var(--success); }
    .status-failed .proposal-state { color: var(--error); }

    .proposal-diff {
      margin: 0;
      padding: 8px 0;
      max-height: 320px;
      overflow: auto;
      background: var(--background);
      font-size: 12.5px;
      line-height: 1.55;
    }

    .diff-line {
      display: block;
      padding: 0 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;

      &.context { color: var(--text-muted); }
      &.removed { background: color-mix(in srgb, var(--error) 14%, transparent); color: var(--text-primary); }
      &.added { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--text-primary); }
    }

    .proposal-error {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 8px 12px;
      font-size: 13px;
      color: var(--error);

      .material-icons { font-size: 16px; }
    }

    .proposal-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-sm);
      padding: 8px 12px;
      border-top: 1px solid var(--border-light);

      .material-icons { font-size: 18px; }
    }
  `]
})
export class ProposalCardComponent {
  proposal = input.required<EditProposal>();
  working = input(false);

  apply = output<void>();
  discard = output<void>();

  docRoute = computed(() => spaceRoute(this.proposal().spaceFullPath ?? '', 'doc'));

  lines = computed<DiffLine[]>(() => {
    const p = this.proposal();
    const split = (text: string) => (text ? text.split('\n') : []);
    return [
      ...split(p.contextBefore).map(text => ({ kind: 'context' as const, text })),
      ...split(p.oldText).map(text => ({ kind: 'removed' as const, text })),
      ...split(p.newText).map(text => ({ kind: 'added' as const, text })),
      ...split(p.contextAfter).map(text => ({ kind: 'context' as const, text }))
    ];
  });

  stateLabel = computed(() => {
    switch (this.proposal().status) {
      case 'APPLIED': return 'Applied';
      case 'DISCARDED': return 'Discarded';
      case 'FAILED': return 'Not applied';
      default: return 'Waiting for you';
    }
  });
}
