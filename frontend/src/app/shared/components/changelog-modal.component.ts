import { Component, Input, Output, EventEmitter, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeHtml } from '@angular/platform-browser';
import { ChangelogRelease } from '../../core/api/changelog.service';
import { MarkdownRenderService } from '../services/markdown-render.service';
import { ChangelogDemoComponent } from './changelog-demo.component';
import { BrandingService } from '../../core/branding/branding.service';

/**
 * A release note is prose with pictures in it, and a picture is either a still
 * (plain markdown, `![alt](assets/…png)`) or an animated demo the app draws
 * itself (`![alt](demo:name)`). The demo is a component rather than markup in
 * the note, so its CSS is scoped and its animation can answer to the reader's
 * motion settings — which is why a note is rendered as a list of parts instead
 * of one block of HTML.
 */
type ReleasePart =
  | { kind: 'markdown'; html: SafeHtml }
  | { kind: 'demo'; name: string; label: string };

interface RenderedRelease extends ChangelogRelease {
  parts: ReleasePart[];
}

/** `![alt](demo:name)` on a line of its own. */
const DEMO_MARKER = /^[ \t]*!\[([^\]]*)\]\(demo:([a-z0-9-]+)\)[ \t]*$/gim;

/**
 * What's-new dialog. Purely presentational — the caller decides which releases
 * to hand in (the unseen ones on login, all of them when opened on purpose).
 */
@Component({
  selector: 'app-changelog-modal',
  standalone: true,
  imports: [CommonModule, ChangelogDemoComponent],
  template: `
    <div class="cl-overlay" (click)="closeIfOutside($event)">
      <div class="cl-modal" #modal>
        <div class="cl-header">
          <div class="cl-icon">
            <span translate="no" class="material-icons">auto_awesome</span>
          </div>
          <div class="cl-heading">
            <h2>What's new</h2>
            <p>{{ subtitle }}</p>
          </div>
          <button class="icon-btn" (click)="dismiss.emit()" title="Close">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>

        <div class="cl-body">
          @for (release of renderedReleases; track release.version) {
            <section class="cl-release">
              <div class="cl-release-head">
                <span class="cl-version">{{ release.version }}</span>
                <span class="cl-date">{{ release.date }}</span>
              </div>
              <h3 class="cl-title">{{ release.title }}</h3>
              @for (part of release.parts; track $index) {
                @if (part.kind === 'demo') {
                  <app-changelog-demo [name]="part.name" [label]="part.label" />
                } @else {
                  <div class="markdown-readonly cl-notes" [innerHTML]="part.html"></div>
                }
              }
            </section>
          }
        </div>

        <div class="cl-footer">
          <button class="btn btn-primary" (click)="dismiss.emit()">Got it</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cl-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-lg);
      z-index: 1000;
    }

    .cl-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      width: 100%;
      max-width: 640px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .cl-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);
    }

    .cl-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: var(--radius-full);
      background: var(--primary-light);
      color: var(--primary-dark);
    }

    .cl-heading {
      flex: 1;
      min-width: 0;
    }

    .cl-heading h2 {
      margin: 0;
      font-size: 1.15rem;
      color: var(--text-primary);
    }

    .cl-heading p {
      margin: 2px 0 0;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .cl-body {
      padding: var(--spacing-lg);
      overflow-y: auto;
      flex: 1;
    }

    .cl-release + .cl-release {
      margin-top: var(--spacing-xl);
      padding-top: var(--spacing-xl);
      border-top: 1px solid var(--border-light);
    }

    .cl-release-head {
      display: flex;
      align-items: baseline;
      gap: var(--spacing-sm);
    }

    .cl-version {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: var(--background-darker);
      color: var(--primary-dark);
    }

    .cl-date {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .cl-title {
      margin: var(--spacing-sm) 0 var(--spacing-md);
      font-size: 1rem;
      color: var(--text-primary);
    }

    .cl-notes {
      font-size: 0.9rem;
      color: var(--text-secondary);
    }

    .cl-footer {
      display: flex;
      justify-content: flex-end;
      padding: var(--spacing-md) var(--spacing-lg);
      border-top: 1px solid var(--border);
      background: var(--background-darker);
    }
  `]
})
export class ChangelogModalComponent {
  private markdown = inject(MarkdownRenderService);
  private branding = inject(BrandingService);

  renderedReleases: RenderedRelease[] = [];

  /**
   * Rendered once per assignment rather than from the template — a method call
   * in the binding would re-parse the markdown on every change-detection pass.
   */
  @Input() set releases(value: ChangelogRelease[]) {
    this.renderedReleases = (value ?? []).map(release => ({
      ...release,
      parts: this.toParts(release.body)
    }));
  }

  /**
   * Splits a note into prose and demos. The marker only counts on a line of its
   * own — the same place a still picture sits — so a split can never land inside
   * a list or a paragraph and leave half-parsed markdown behind.
   */
  private toParts(body: string): ReleasePart[] {
    const parts: ReleasePart[] = [];
    let cursor = 0;

    for (const match of body.matchAll(DEMO_MARKER)) {
      const at = match.index ?? 0;
      this.pushMarkdown(parts, body.slice(cursor, at));
      parts.push({ kind: 'demo', label: match[1], name: match[2] });
      cursor = at + match[0].length;
    }
    this.pushMarkdown(parts, body.slice(cursor));

    return parts;
  }

  private pushMarkdown(parts: ReleasePart[], markdown: string): void {
    if (!markdown.trim()) return;
    parts.push({ kind: 'markdown', html: this.markdown.renderInline(markdown) });
  }

  @Output() dismiss = new EventEmitter<void>();

  get subtitle(): string {
    const count = this.renderedReleases.length;
    if (count === 0) return 'No release notes available.';
    if (count === 1) return `${this.branding.appName()} ${this.renderedReleases[0].version}`;
    return `${count} releases since you were last here`;
  }

  closeIfOutside(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('cl-overlay')) {
      this.dismiss.emit();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss.emit();
  }
}
