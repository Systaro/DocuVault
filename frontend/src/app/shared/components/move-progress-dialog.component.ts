import { Component, computed, input, output } from '@angular/core';
import { MoveProgress } from '../../core/api/documents.service';

/**
 * Shows how far a move, copy or rename has got. The server reports a fixed
 * number of steps, so the bar fills step by step: steps that work through files
 * creep forward per file, steps that cannot be counted (a commit, a push) pulse
 * over their slice of the bar until they finish.
 *
 * Purely presentational. Hiding it does not stop anything: the caller keeps
 * listening and reports the outcome with a toast.
 */
@Component({
  selector: 'app-move-progress-dialog',
  standalone: true,
  template: `
    <div class="modal-overlay">
      <div class="modal progress-modal" role="dialog" aria-modal="true" aria-labelledby="move-progress-title">
        <div class="modal-header">
          <h2 id="move-progress-title">{{ title() }}</h2>
        </div>

        <div class="modal-body">
          <div
            class="progress-track"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="percent()"
            [attr.aria-valuetext]="status()"
          >
            <div class="progress-fill" [style.width.%]="percent()"></div>
            @if (uncounted()) {
              <div class="progress-pulse" [style.left.%]="percent()" [style.width.%]="stepShare()"></div>
            }
          </div>

          <div class="progress-meta">
            <span class="progress-status">{{ status() }}</span>
            <span class="progress-percent">{{ percent() }}%</span>
          </div>
          @if (progress(); as p) {
            <p class="progress-step">Step {{ p.step }} of {{ p.steps }}</p>
          }
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" (click)="hide.emit()">Continue in background</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .progress-modal { width: min(440px, 92vw); }

    .progress-track {
      position: relative;
      height: 8px;
      border-radius: 4px;
      background: var(--border);
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--primary);
      transition: width 0.2s linear;
    }

    .progress-pulse {
      position: absolute;
      top: 0;
      height: 100%;
      background: color-mix(in srgb, var(--primary) 45%, transparent);
      animation: progress-pulse 1.2s ease-in-out infinite;
    }

    @keyframes progress-pulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .progress-fill { transition: none; }
      .progress-pulse { animation: none; opacity: 0.6; }
    }

    .progress-meta {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-sm);
      margin-top: var(--spacing-sm);
      font-size: 13.5px;
      color: var(--text-primary);
    }

    .progress-status {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .progress-percent {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }

    .progress-step {
      margin: 4px 0 0;
      font-size: 12.5px;
      color: var(--text-muted);
    }
  `]
})
export class MoveProgressDialogComponent {
  title = input.required<string>();
  /** Null until the server's first report arrives. */
  progress = input<MoveProgress | null>(null);

  readonly hide = output<void>();

  percent = computed(() => {
    const p = this.progress();
    if (!p) return 0;
    const within = p.total > 0 ? p.done / p.total : 0;
    return Math.min(100, Math.round(((p.step - 1 + within) / p.steps) * 100));
  });

  /** The current step has nothing to count, so its slice pulses instead of creeping. */
  uncounted = computed(() => (this.progress()?.total ?? 0) === 0);

  stepShare = computed(() => {
    const p = this.progress();
    return p ? 100 / p.steps : 100;
  });

  status = computed(() => {
    const p = this.progress();
    if (!p) return 'Starting…';
    return p.total > 0 ? `${p.label}: ${p.done} of ${p.total}` : `${p.label}…`;
  });
}
