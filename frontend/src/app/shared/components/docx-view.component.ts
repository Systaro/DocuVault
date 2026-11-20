import { Component, ElementRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DocxRenderService } from '../services/docx-render.service';

/**
 * A Word document rendered page by page from [url], for the views that show a
 * file without editing it (the fullscreen preview, a share link). The editor
 * keeps its own rendering because it also draws the document's comments.
 */
@Component({
  selector: 'app-docx-view',
  standalone: true,
  template: `
    @if (state() === 'loading') {
      <div class="docx-view-status">
        <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
    } @else if (state() === 'error') {
      <div class="docx-view-status">
        <p>This document could not be displayed.</p>
        <a [href]="url()" download class="btn btn-primary">
          <span translate="no" class="material-icons">download</span>
          Download File
        </a>
      </div>
    }
    <div #host class="docx-host" translate="no" [class.hidden]="state() !== 'ready'"></div>
  `,
  styles: [`
    :host { display: block; width: 100%; }

    .docx-view-status {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-md, 16px);
      padding: 64px 16px;
      color: var(--text-muted);
    }
  `]
})
export class DocxViewComponent {
  readonly url = input.required<string>();
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly docx = inject(DocxRenderService);

  constructor() {
    effect(() => {
      const url = this.url();
      // After this render pass, so the host element exists.
      untracked(() => setTimeout(() => this.load(url)));
    });
  }

  private async load(url: string): Promise<void> {
    const stale = () => url !== this.url();
    this.state.set('loading');
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (stale()) return;
      await this.docx.render(buffer, this.host().nativeElement);
      if (!stale()) this.state.set('ready');
    } catch {
      if (!stale()) this.state.set('error');
    }
  }
}
