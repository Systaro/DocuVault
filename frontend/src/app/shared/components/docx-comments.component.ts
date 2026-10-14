import { Component, HostListener, OnDestroy, OnInit, ViewEncapsulation, computed, effect, input, signal, untracked } from '@angular/core';
import { AnnotationThreadComponent, ThreadEntry } from './annotation-thread.component';
import { DocxComment, DocxCommentNote } from '../services/docx-render.service';
import { THREAD_WIDTH, threadPositionBeside } from '../annotations/thread-placement';

/** CSS highlight names, painted by the ::highlight() rules below. */
const HIGHLIGHT_OPEN = 'docx-comment';
const HIGHLIGHT_RESOLVED = 'docx-comment-resolved';
const HIGHLIGHT_ACTIVE = 'docx-comment-active';

function toEntry(note: DocxCommentNote, resolved = false, replies: ThreadEntry[] = []): ThreadEntry {
  return {
    id: note.id,
    userId: null,
    authorName: note.author,
    body: note.text,
    createdAt: note.date,
    anchor: null,
    anchorState: 'ANCHORED',
    resolved,
    resolvedByName: null,
    replies,
  };
}

/** CSS.highlights is a maplike the TypeScript DOM typings don't spell out yet. */
function highlightRegistry(): Map<string, Highlight> | null {
  if (typeof Highlight === 'undefined' || typeof CSS === 'undefined' || !CSS.highlights) return null;
  return CSS.highlights as unknown as Map<string, Highlight>;
}

function elementAt(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/**
 * The comments inside a rendered Word file: their passages lit with the CSS
 * Custom Highlight API (the generated markup stays untouched and the paint
 * follows every reflow), and a click on one opens the comment card beside it.
 * Read-only: the comments belong to the file, not to DocuVault's own threads.
 */
@Component({
  selector: 'app-docx-comments',
  standalone: true,
  imports: [AnnotationThreadComponent],
  template: `
    @if (comments().length) {
      <button type="button" class="docx-comments-fab" (click)="step(1)" title="Comments in this Word file">
        <span translate="no" class="material-icons">chat_bubble_outline</span>
        <span class="docx-comments-count">{{ comments().length }}</span>
      </button>
    }
    @if (entry(); as entry) {
      <app-annotation-thread
        [annotation]="entry"
        [permission]="'VIEW'"
        [posX]="posX()"
        [posY]="posY()"
        [position]="activeIndex() + 1"
        [total]="comments().length"
        [note]="'Comment from the Word file, read-only here.'"
        (close)="close()"
        (previous)="step(-1)"
        (next)="step(1)"
      />
    }
  `,
  // Unencapsulated: ::highlight() and the hover class style the docx-preview
  // markup, which this component does not own.
  encapsulation: ViewEncapsulation.None,
  styles: [`
    /* Same amber / green as the app's own comment highlights. The pages are
       white paper in both themes, so one set of colours serves. */
    ::highlight(docx-comment) { background-color: rgba(245, 158, 11, 0.26); }
    ::highlight(docx-comment-resolved) { background-color: rgba(16, 185, 129, 0.14); }
    ::highlight(docx-comment-active) { background-color: rgba(245, 158, 11, 0.5); }
    .docx-host.docx-comment-hover { cursor: pointer; }

    .docx-comments-fab {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px 8px 14px;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 28px;
      background: var(--surface, #fff);
      color: var(--text-secondary, #4a6366);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04);
      cursor: pointer;
      transition: box-shadow 0.2s, color 0.15s;
    }

    .docx-comments-fab:hover {
      color: var(--text-primary, #1a2e30);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.06);
    }

    .docx-comments-fab .material-icons { font-size: 20px; }

    .docx-comments-count {
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: #f59e0b;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
    }
  `],
})
export class DocxCommentsComponent implements OnInit, OnDestroy {
  /** The element docx-preview rendered into. */
  host = input.required<HTMLElement>();
  /** Threads in document order, as returned by DocxRenderService.render. */
  comments = input<DocxComment[]>([]);

  private activeId = signal<string | null>(null);
  activeIndex = computed(() => this.comments().findIndex(c => c.id === this.activeId()));
  private active = computed(() => this.comments()[this.activeIndex()] ?? null);
  entry = computed(() => {
    const comment = this.active();
    return comment ? toEntry(comment, comment.resolved, comment.replies.map(r => toEntry(r))) : null;
  });
  posX = signal(0);
  posY = signal(0);

  private placeFrame = 0;
  private hoverFrame = 0;

  constructor() {
    // Another file or version: the open card belonged to the old one.
    effect(() => {
      this.comments();
      untracked(() => this.activeId.set(null));
    }, { allowSignalWrites: true });

    effect(() => this.paint(this.comments(), this.active()));
  }

  ngOnInit(): void {
    this.host().addEventListener('mousemove', this.onHostMove);
    this.host().addEventListener('mouseleave', this.onHostLeave);
    document.addEventListener('click', this.onDocumentClick);
    // Capture: the pane that scrolls is an ancestor, and scroll events don't bubble.
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  ngOnDestroy(): void {
    this.host().removeEventListener('mousemove', this.onHostMove);
    this.host().removeEventListener('mouseleave', this.onHostLeave);
    this.host().classList.remove('docx-comment-hover');
    document.removeEventListener('click', this.onDocumentClick);
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    cancelAnimationFrame(this.placeFrame);
    cancelAnimationFrame(this.hoverFrame);
    const registry = highlightRegistry();
    [HIGHLIGHT_OPEN, HIGHLIGHT_RESOLVED, HIGHLIGHT_ACTIVE].forEach(name => registry?.delete(name));
  }

  @HostListener('window:resize')
  onResize(): void {
    this.schedulePlace();
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.activeId.set(null);
  }

  /** Open the next (or previous) comment, wrapping around, and bring its passage into view. */
  step(delta: number): void {
    const list = this.comments();
    if (!list.length) return;
    const index = this.activeIndex();
    const next = index < 0
      ? (delta > 0 ? 0 : list.length - 1)
      : (index + delta + list.length) % list.length;
    const comment = list[next];
    this.activeId.set(comment.id);
    if (comment.range) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      elementAt(comment.range.startContainer)?.scrollIntoView({
        block: 'center',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }
    // A smooth scroll keeps the card on its passage through onScroll.
    this.place();
  }

  private open(comment: DocxComment): void {
    this.activeId.set(comment.id);
    this.place();
  }

  /** Put the card beside the active passage, in the page margin when there is room. */
  private place(): void {
    const range = this.active()?.range;
    const passage = range?.getBoundingClientRect();
    if (!range || !passage || (!passage.width && !passage.height)) {
      this.posX.set(Math.max(20, (window.innerWidth - THREAD_WIDTH) / 2));
      this.posY.set(Math.max(20, window.innerHeight * 0.2));
      return;
    }
    const page = elementAt(range.startContainer)?.closest('section.docx');
    const { x, y } = threadPositionBeside(passage, page?.getBoundingClientRect() ?? null);
    this.posX.set(x);
    this.posY.set(y);
  }

  private schedulePlace(): void {
    if (!this.activeId() || this.placeFrame) return;
    this.placeFrame = requestAnimationFrame(() => {
      this.placeFrame = 0;
      this.place();
    });
  }

  /**
   * The comment whose passage is under the pointer. Where comments overlap,
   * the one on the fewest words wins: it is the more specific remark.
   */
  private commentAt(x: number, y: number): DocxComment | null {
    let best: DocxComment | null = null;
    let bestLength = Infinity;
    for (const comment of this.comments()) {
      if (!comment.range) continue;
      const hit = Array.from(comment.range.getClientRects())
        .some(r => r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      if (!hit) continue;
      const length = comment.range.toString().length;
      if (length < bestLength) {
        best = comment;
        bestLength = length;
      }
    }
    return best;
  }

  private paint(comments: DocxComment[], active: DocxComment | null): void {
    const registry = highlightRegistry();
    if (!registry) return;
    const placed = comments.filter(c => c.range);
    registry.set(HIGHLIGHT_OPEN, new Highlight(...placed.filter(c => !c.resolved).map(c => c.range!)));
    registry.set(HIGHLIGHT_RESOLVED, new Highlight(...placed.filter(c => c.resolved).map(c => c.range!)));
    if (active?.range) {
      const highlight = new Highlight(active.range);
      highlight.priority = 1;
      registry.set(HIGHLIGHT_ACTIVE, highlight);
    } else {
      registry.delete(HIGHLIGHT_ACTIVE);
    }
  }

  private onDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target || target.closest('.annotation-thread, .docx-comments-fab')) return;
    // The end of a drag-selection, not a click on a passage.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const hit = this.host().contains(target) && !target.closest('a[href]')
      ? this.commentAt(event.clientX, event.clientY)
      : null;
    if (hit) this.open(hit);
    else this.close();
  };

  private onHostMove = (event: MouseEvent): void => {
    if (this.hoverFrame || !this.comments().length) return;
    const { clientX, clientY } = event;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      this.host().classList.toggle('docx-comment-hover', !!this.commentAt(clientX, clientY));
    });
  };

  private onHostLeave = (): void => {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    this.host().classList.remove('docx-comment-hover');
  };

  private onScroll = (): void => this.schedulePlace();
}
