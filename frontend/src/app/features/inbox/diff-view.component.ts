import { Component, Input, Output, EventEmitter, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  lineNum: number;
  text: string;
}

@Component({
  selector: 'app-diff-view',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="diff-overlay" (click)="close.emit()">
      <div class="diff-modal" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="diff-header">
          <div class="diff-header-icon">
            <span class="material-icons">article</span>
          </div>
          <div class="diff-header-text">
            <h2>{{ documentPath }}</h2>
            <div class="diff-header-sub">
              <span class="material-icons">auto_awesome</span>
              AI merge preview
            </div>
          </div>
          <button class="icon-btn" (click)="close.emit()">
            <span class="material-icons">close</span>
          </button>
        </div>

        <!-- Legend -->
        <div class="diff-legend">
          <div class="legend-item"><div class="legend-dot add"></div>Added by AI</div>
          <div class="legend-item"><div class="legend-dot remove"></div>Removed by AI</div>
          <div class="legend-item"><div class="legend-dot context"></div>Unchanged</div>
        </div>

        <!-- Diff content -->
        <div class="diff-content">
          @for (line of diffLines(); track $index) {
            <div class="diff-line {{ line.type }}">
              <span class="diff-line-num">{{ line.lineNum }}</span>
              <span class="diff-line-sign">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ' }}</span>
              <span class="diff-line-text">{{ line.text }}</span>
            </div>
          }
        </div>

        <!-- Footer -->
        <div class="diff-footer">
          <div class="diff-stats">
            <span class="stat additions">
              <span class="material-icons">add</span>
              {{ addCount() }} additions
            </span>
            <span class="stat deletions">
              <span class="material-icons">remove</span>
              {{ removeCount() }} deletions
            </span>
          </div>
          <div class="diff-actions">
            <button class="btn btn-secondary" (click)="close.emit()">Cancel</button>
            <button class="btn btn-primary" (click)="accept.emit()">
              <span class="material-icons">check</span>
              Accept changes
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .diff-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 250;
    }

    .diff-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl, 12px);
      width: 820px;
      max-width: 95vw;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      animation: modalIn 0.2s ease;
    }

    @keyframes modalIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }

    .diff-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .diff-header-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(111, 179, 184, 0.15);
      border: 1px solid rgba(111, 179, 184, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .material-icons { font-size: 18px; color: var(--primary); }
    }

    .diff-header-text { flex: 1; }

    .diff-header-text h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 4px;
    }

    .diff-header-sub {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-muted);

      .material-icons { font-size: 14px; color: var(--primary); }
    }

    .diff-legend {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 24px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;

      &.add { background: #22c55e; }
      &.remove { background: #ef4444; }
      &.context { background: var(--border); }
    }

    .diff-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.65;
    }

    .diff-line {
      display: flex;
      align-items: flex-start;
      border-radius: 3px;
      margin-bottom: 1px;

      &.context { color: var(--text-secondary); }

      &.add {
        background: rgba(34, 197, 94, 0.08);
        border-left: 3px solid #22c55e;
        .diff-line-sign { color: #22c55e; }
        .diff-line-text { color: #15803d; }
      }

      &.remove {
        background: rgba(239, 68, 68, 0.08);
        border-left: 3px solid #ef4444;
        .diff-line-sign { color: #ef4444; }
        .diff-line-text { color: #dc2626; text-decoration: line-through; opacity: 0.8; }
      }
    }

    .diff-line-num {
      width: 36px;
      flex-shrink: 0;
      text-align: right;
      padding: 3px 8px 3px 0;
      font-size: 11px;
      color: var(--text-muted);
      user-select: none;
    }

    .diff-line-sign {
      width: 20px;
      flex-shrink: 0;
      text-align: center;
      padding: 3px 0;
      font-weight: 700;
    }

    .diff-line-text {
      flex: 1;
      padding: 3px 8px;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .diff-footer {
      padding: 14px 24px;
      border-top: 1px solid var(--border);
      background: var(--background);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .diff-stats {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;

      .stat { display: flex; align-items: center; gap: 4px; }
      .material-icons { font-size: 14px; }
      .additions { color: #22c55e; }
      .deletions { color: #ef4444; }
    }

    .diff-actions { display: flex; gap: 10px; }
  `]
})
export class DiffViewComponent {
  @Input() original = '';
  @Input() merged = '';
  @Input() documentPath = '';
  @Output() accept = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  diffLines = computed(() => this.computeDiff(this.original, this.merged));
  addCount = computed(() => this.diffLines().filter(l => l.type === 'add').length);
  removeCount = computed(() => this.diffLines().filter(l => l.type === 'remove').length);

  private computeDiff(original: string, merged: string): DiffLine[] {
    const originalLines = original.split('\n');
    const mergedLines = merged.split('\n');

    // Simple LCS-based diff
    const lcs = this.lcsMatrix(originalLines, mergedLines);
    const result: DiffLine[] = [];
    let lineNum = 1;

    const buildDiff = (i: number, j: number): void => {
      if (i > 0 && j > 0 && originalLines[i - 1] === mergedLines[j - 1]) {
        buildDiff(i - 1, j - 1);
        result.push({ type: 'context', lineNum: lineNum++, text: originalLines[i - 1] });
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        buildDiff(i, j - 1);
        result.push({ type: 'add', lineNum: lineNum++, text: mergedLines[j - 1] });
      } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
        buildDiff(i - 1, j);
        result.push({ type: 'remove', lineNum: lineNum++, text: originalLines[i - 1] });
      }
    };

    buildDiff(originalLines.length, mergedLines.length);
    return result;
  }

  private lcsMatrix(a: string[], b: string[]): number[][] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp;
  }
}
