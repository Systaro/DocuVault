import {
  Component, input, signal, computed, effect, OnInit, OnDestroy,
  ElementRef, ViewEncapsulation, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AnnotationsService, Annotation, AnnotationAnchor, AnnotationPermission, CreateAnnotationRequest
} from '../../core/api/annotations.service';
import { AnnotationMarkerComponent } from './annotation-marker.component';
import { AnnotationThreadComponent } from './annotation-thread.component';
import { ContextMenuComponent, ContextMenuItem } from './context-menu.component';
import { RenderMode } from '../utils/file-utils';
import { ToastService } from '../services/toast.service';
import { anchorRecord, describePoint, describeRange, Anchored, AnchorState } from '../annotations/anchoring/anchoring';
import { TextIndex } from '../annotations/anchoring/text-index';
import { AnchorRecord, ANCHOR_VERSION, TextQuoteSelector, findSelector, toAnchorRecord } from '../annotations/anchoring/selectors';

/** One painted line of a range, in host coordinates. */
interface Rect { x: number; y: number; w: number; h: number; }

/** Where one comment currently sits, in host-relative pixels. */
interface Placement {
  state: AnchorState;
  position: { start: number; end: number } | null;
  currentText?: string;
  x: number;
  y: number;
  /** Every line the anchored text occupies, for the highlight. */
  rects: Rect[];
}

/**
 * The lines a range paints, relative to the host's own coordinate space rather
 * than the viewport — so they scroll with the content instead of sliding over
 * it, exactly like the pins.
 */
function rectsOf(range: Range, host: HTMLElement, hostBox: DOMRect): Rect[] {
  return Array.from(range.getClientRects())
    .filter(r => r.width > 0 && r.height > 0)
    .map(r => ({
      x: r.left - hostBox.left + host.scrollLeft,
      y: r.top - hostBox.top + host.scrollTop,
      w: r.width,
      h: r.height
    }));
}

/**
 * A comment being written but not yet posted. The placement dot is carried in
 * its own coordinates because the anchor may be a text quote, which has no
 * percentage to render from.
 */
interface NewAnnotationDraft {
  anchor: AnnotationAnchor;
  screenX: number;
  screenY: number;
  dotX: number;
  dotY: number;
  dotUnit: '%' | 'px';
  /** The passage being commented on, kept lit while the comment is written. */
  rects: Rect[];
}

/** The first rect a range actually paints into, ignoring zero-size fragments. */
function firstVisibleRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
  if (rects.length > 0) return rects[0];
  const fallback = range.getBoundingClientRect();
  return fallback.width || fallback.height ? fallback : null;
}

/** The thread card's own size, from annotation-thread.component. */
const THREAD_WIDTH = 320;
const THREAD_HEIGHT = 320;

@Component({
  selector: 'app-annotation-overlay',
  standalone: true,
  imports: [CommonModule, FormsModule, AnnotationMarkerComponent, AnnotationThreadComponent, ContextMenuComponent],
  template: `
    <!-- Image mode: click + marker layer sized to the image so positions follow scroll & zoom -->
    @if (renderMode() === 'image') {
      <div class="annotation-content-layer"
           [style.width.px]="contentWidth()"
           [style.height.px]="contentHeight()"
           [style.left.px]="contentLeft()"
           [style.top.px]="contentTop()">
        @if (annotationMode() && !activeAnnotation() && !newAnnotation()) {
          <div class="annotation-click-layer-inner" (click)="onContentLayerClick($event)"></div>
        }
        @for (a of annotations(); track a.id; let i = $index) {
          @if (a.anchor) {
            <app-annotation-marker
              [x]="a.anchor.xPercent ?? 50"
              [y]="a.anchor.yPercent ?? 50"
              [index]="i + 1"
              [resolved]="a.resolved"
              [active]="activeAnnotationId() === a.id"
              (markerClick)="openThread(a, $event)"
            />
          }
        }
      </div>
    } @else {
      <!-- Click-capture layer: only active in comment mode, hidden when thread/popover is open.
           Skipped for html mode — the injected bridge script captures clicks inside the iframe instead,
           and an outer layer here would intercept clicks before they reach the iframe. -->
      @if (annotationMode() && !activeAnnotation() && !newAnnotation() && renderMode() !== 'html') {
        <div class="annotation-click-layer" (click)="onLayerClick($event)"></div>
      }

      <!-- Highlights. A pin alone says "there is a comment somewhere near
           here"; lighting the anchored lines says "this sentence has a
           comment", which is the whole point of anchoring to text.
           pointer-events stays off so selecting a commented passage still
           works — clicks are hit-tested against these rects instead. -->
      @if (usesTextAnchoring()) {
        @for (a of placedAnnotations(); track a.id) {
          @if (placementOf(a.id); as placement) {
            @for (r of placement.rects; track $index) {
              <div
                class="annotation-highlight"
                [class.resolved]="a.resolved"
                [class.shifted]="placement.state === 'SHIFTED'"
                [class.active]="activeAnnotationId() === a.id || hoveredAnnotationId() === a.id"
                [style.left.px]="r.x"
                [style.top.px]="r.y"
                [style.width.px]="r.w"
                [style.height.px]="r.h"
              ></div>
            }
          }
        }
        @if (newAnnotation(); as na) {
          @for (r of na.rects; track $index) {
            <div class="annotation-highlight draft"
                 [style.left.px]="r.x" [style.top.px]="r.y"
                 [style.width.px]="r.w" [style.height.px]="r.h"></div>
          }
        }
      }

      <!-- Markers. Text documents position from a resolved range, measured in
           pixels off the live DOM, so reflow and zoom move the pin with the
           text instead of away from it. Everything else keeps percentages. -->
      @if (usesTextAnchoring()) {
        @for (a of placedAnnotations(); track a.id) {
          @if (placementOf(a.id); as placement) {
            <app-annotation-marker
              [x]="placement.x"
              [y]="placement.y"
              unit="px"
              [index]="markerIndexOf(a)"
              [resolved]="a.resolved"
              [shifted]="placement.state === 'SHIFTED'"
              [active]="activeAnnotationId() === a.id"
              (markerClick)="openThread(a, $event)"
              (markerHover)="hoveredAnnotationId.set($event ? a.id : null)"
            />
          }
        }
      } @else if (renderMode() !== 'html') {
        @for (a of annotations(); track a.id; let i = $index) {
          @if (a.anchor) {
            <app-annotation-marker
              [x]="a.anchor.xPercent ?? 50"
              [y]="a.anchor.yPercent ?? 50"
              [index]="i + 1"
              [resolved]="a.resolved"
              [active]="activeAnnotationId() === a.id"
              (markerClick)="openThread(a, $event)"
            />
          }
        }
      }
    }

    <!-- Floating toolbar — Figma-style bottom pill. Hidden entirely when commenting
         is disabled (e.g. distraction-free fullscreen preview). -->
    @if (allowComment()) {
      <div class="annotation-fab" [class.has-annotations]="annotations().length > 0">
        @if (canComment()) {
          <button class="fab-btn" [class.active]="annotationMode()"
                  (click)="toggleAnnotationMode()" [title]="annotationMode() ? 'Exit comment mode (Esc)' : 'Add comment'">
            <span translate="no" class="material-icons">{{ annotationMode() ? 'close' : 'add_comment' }}</span>
            @if (annotationMode()) {
              <span class="fab-label">Click to place comment</span>
            }
          </button>
        }
        @if (annotations().length > 0) {
          <div class="fab-divider"></div>
          <button class="fab-btn" [class.active]="showList()"
                  (click)="showList.set(!showList())" title="View all comments">
            <span translate="no" class="material-icons">chat_bubble_outline</span>
            <span class="fab-badge">{{ annotations().length }}</span>
          </button>
        }
      </div>
    }

    <!-- Thread popover -->
    @if (activeAnnotation(); as active) {
      <app-annotation-thread
        [annotation]="active"
        [permission]="permission()"
        [currentUserId]="currentUserId()"
        [posX]="threadPosX()"
        [posY]="threadPosY()"
        [currentText]="placementOf(active.id)?.currentText ?? null"
        (close)="closeThread()"
        (reply)="onReply($event)"
        (resolve)="onResolve($event)"
        (remove)="onDelete($event)"
      />
    }

    <!-- Yellow dot at click position during creation. Skipped for html mode — the bridge script draws
         the dot inside the iframe at the actual click pixel; the parent's percentages don't translate. -->
    @if (newAnnotation(); as na) {
      @if (renderMode() !== 'html') {
        <div class="annotation-placement-dot"
             [style.left]="na.dotX + na.dotUnit"
             [style.top]="na.dotY + na.dotUnit"></div>
      }
    }

    <!-- New annotation form -->
    @if (newAnnotation(); as na) {
      <div class="new-annotation-popover" [style.left.px]="na.screenX" [style.top.px]="na.screenY"
           (click)="$event.stopPropagation()">
        @if (requiresName() && !authorName()) {
          <input class="annotation-name-input" [(ngModel)]="authorNameInput" placeholder="Your name..."
                 (keydown.enter)="confirmName()" autofocus />
          <button class="annotation-name-btn" [disabled]="!authorNameInput.trim()" (click)="confirmName()">
            <span translate="no" class="material-icons">arrow_forward</span>
          </button>
        } @else {
          <textarea class="annotation-input" [(ngModel)]="newAnnotationText" placeholder="Add a comment..."
                    rows="3" (keydown.meta.Enter)="submitNewAnnotation()"
                    (keydown.control.Enter)="submitNewAnnotation()"
                    (keydown.escape)="cancelNewAnnotation()" autofocus></textarea>
          <div class="new-annotation-actions">
            <button class="btn-cancel" (click)="cancelNewAnnotation()">Cancel</button>
            <button class="btn-submit" [disabled]="!newAnnotationText.trim()" (click)="submitNewAnnotation()">
              <span translate="no" class="material-icons">send</span> Comment
            </button>
          </div>
        }
      </div>
    }

    <!-- List panel (floating, no backdrop) -->
    @if (showList()) {
      <div class="annotation-list">
          <div class="list-header">
            <h3>Comments ({{ annotations().length }})</h3>
            <button class="thread-btn" (click)="showList.set(false)">
              <span translate="no" class="material-icons">close</span>
            </button>
          </div>
          <!-- Only the comments that still have a pin; the unanchored ones get
               their own section below, with the actions they actually need. -->
          @for (a of placedAnnotations(); track a.id) {
            <div class="list-item" [class.resolved]="a.resolved" (click)="openThreadFromList(a)">
              <span class="list-index" [class.resolved]="a.resolved">{{ markerIndexOf(a) }}</span>
              <div class="list-content">
                <div class="list-meta">
                  <span class="list-author">{{ a.authorName }}</span>
                  <span class="list-date">{{ formatDate(a.createdAt) }}</span>
                </div>
                <div class="list-body">{{ a.body }}</div>
                @if (a.replies.length > 0) {
                  <span class="list-replies">{{ a.replies.length }} {{ a.replies.length === 1 ? 'reply' : 'replies' }}</span>
                }
              </div>
            </div>
          }
          @if (annotations().length === 0) {
            <div class="list-empty">No comments yet</div>
          }

          <!-- Comments whose text is gone. Never auto-resolved: a comment about
               a paragraph someone rewrote is the one most likely to still need
               an answer, and possibly to be about the rewrite itself. -->
          @if (orphanedAnnotations().length > 0) {
            <div class="orphan-section">
              <div class="orphan-header">
                <span translate="no" class="material-icons">link_off</span>
                <span>Unanchored ({{ orphanedAnnotations().length }})</span>
              </div>
              <p class="orphan-explainer">
                The text these were written on isn't in the document any more.
              </p>
              @for (a of orphanedAnnotations(); track a.id) {
                <div class="list-item orphan-item" [class.resolved]="a.resolved">
                  <div class="list-content">
                    <div class="list-meta">
                      <span class="list-author">{{ a.authorName }}</span>
                      <span class="list-date">{{ formatDate(a.createdAt) }}</span>
                    </div>
                    <div class="list-body">{{ a.body }}</div>
                    @if (originalQuoteOf(a); as quote) {
                      <blockquote class="orphan-quote">“{{ quote }}”</blockquote>
                    }
                    <div class="orphan-actions">
                      @if (canComment()) {
                        <button type="button" class="orphan-btn" (click)="startReanchor(a)">
                          <span translate="no" class="material-icons">my_location</span> Re-anchor
                        </button>
                      }
                      <button type="button" class="orphan-btn" (click)="onResolve(a.id)">
                        <span translate="no" class="material-icons">check</span>
                        {{ a.resolved ? 'Reopen' : 'Resolve' }}
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
    }

    <!-- Right-click menu. Text anchoring makes "select the words, then comment
         on them" the natural gesture, and that needs somewhere to put it. -->
    @if (contextMenu(); as menu) {
      <app-context-menu
        [items]="menu.items"
        [x]="menu.x"
        [y]="menu.y"
        (select)="onContextMenuSelect($event)"
        (dismiss)="closeContextMenu()"
      />
    }

    <!-- Selecting words is already the gesture that means "I want to say
         something about this", so the offer follows the selection instead of
         waiting behind a right-click. mousedown is swallowed: taking focus
         would drop the very selection the comment is about. -->
    @if (selectionOffer(); as offer) {
      <button
        type="button"
        class="selection-offer"
        [style.left.px]="offer.x"
        [style.top.px]="offer.y"
        (mousedown)="$event.preventDefault()"
        (click)="commentOnOfferedSelection()"
        title="Comment on selection"
        aria-label="Comment on selection"
      >
        <span translate="no" class="material-icons">add_comment</span>
      </button>
    }

    <!-- Re-anchor mode banner: the click layer is repurposed, so say so. -->
    @if (reanchoring(); as target) {
      <div class="reanchor-banner">
        <span translate="no" class="material-icons">my_location</span>
        <span class="reanchor-text">Click where “{{ target.body }}” belongs now</span>
        <button type="button" class="reanchor-cancel" (click)="cancelReanchor()">Cancel</button>
      </div>
    }
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
    app-annotation-overlay {
      display: contents;
    }

    .selection-offer {
      position: fixed;
      z-index: 401;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 8px;
      background: var(--surface, #fff);
      color: var(--primary, #388087);
      box-shadow: 0 4px 14px rgba(18, 52, 59, 0.18);
      cursor: pointer;
      animation: selection-offer-in 0.1s ease-out;
    }

    .selection-offer:hover { background: var(--background, #f6f6f2); }
    .selection-offer .material-icons { font-size: 18px; }

    @keyframes selection-offer-in {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .selection-offer { animation: none; }
    }

    /* Full-area click layer for comment placement */
    .annotation-click-layer {
      position: absolute;
      inset: 0;
      pointer-events: auto;
      cursor: crosshair;
      z-index: 5;
    }

    /* Image mode: layer sized to the image's rendered dimensions so markers anchor to image content, not viewport */
    .annotation-content-layer {
      position: absolute;
      pointer-events: none;
      z-index: 4;
    }

    .annotation-content-layer .annotation-pin {
      pointer-events: auto;
    }

    .annotation-click-layer-inner {
      position: absolute;
      inset: 0;
      pointer-events: auto;
      cursor: crosshair;
      z-index: 5;
    }

    /* Figma-style floating pill at bottom center */
    .annotation-fab {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 28px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04);
      padding: 4px;
      pointer-events: auto;
      z-index: 200;
      transition: box-shadow 0.2s;
    }

    .annotation-fab:hover {
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.06);
    }

    .fab-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: none;
      border-radius: 24px;
      background: none;
      color: var(--text-secondary, #4a6366);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .fab-btn .material-icons { font-size: 20px; }

    .fab-btn:hover {
      background: var(--background, #f6f6f2);
      color: var(--text-primary, #1a2e30);
    }

    .fab-btn.active {
      background: var(--primary, #6fb3b8);
      color: #fff;
    }

    .fab-btn.active:hover {
      background: var(--primary-dark, #388087);
    }

    .fab-label {
      font-size: 13px;
      font-weight: 400;
    }

    .fab-divider {
      width: 1px;
      height: 24px;
      background: var(--border, #d4e5e7);
      margin: 0 2px;
    }

    .fab-badge {
      font-size: 12px;
      font-weight: 600;
      min-width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: #f59e0b;
      color: #fff;
    }

    .fab-btn.active .fab-badge {
      background: #d97706;
    }

    /* Yellow placement dot at click position */
    .annotation-placement-dot {
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #f59e0b;
      border: 2px solid #fff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      transform: translate(-50%, -50%);
      z-index: 6;
      pointer-events: none;
      animation: dot-pulse 1.5s ease-in-out infinite;
    }

    @keyframes dot-pulse {
      0%, 100% { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 0 0 0 rgba(245, 158, 11, 0.4); }
      50% { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 0 0 6px rgba(245, 158, 11, 0); }
    }

    /* New annotation popover */
    .new-annotation-popover {
      position: fixed;
      width: 280px;
      padding: 12px;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #d4e5e7);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-xl, 0 20px 40px rgba(0, 0, 0, 0.15));
      z-index: 210;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .annotation-name-input, .annotation-input {
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      background: var(--background, #f6f6f2);
      color: var(--text-primary, #1a2e30);
      resize: none;
      width: 100%;
      box-sizing: border-box;
    }

    .annotation-name-input:focus, .annotation-input:focus {
      border-color: #f59e0b;
    }

    .annotation-name-btn {
      align-self: flex-end;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 8px;
      background: #f59e0b;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .annotation-name-btn:disabled { opacity: 0.5; }
    .annotation-name-btn .material-icons { font-size: 18px; }

    .new-annotation-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .btn-cancel {
      padding: 6px 14px;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 8px;
      background: none;
      color: var(--text-secondary, #4a6366);
      cursor: pointer;
      font-size: 13px;
      transition: background 0.15s;
    }

    .btn-cancel:hover { background: #f3f4f6; }

    .btn-submit {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 14px;
      border: none;
      border-radius: 8px;
      background: #f59e0b;
      color: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.15s;
    }

    .btn-submit:hover { background: #d97706; }
    .btn-submit:disabled { opacity: 0.5; cursor: default; }
    .btn-submit .material-icons { font-size: 16px; }

    /* Floating comments list */
    .annotation-list {
      position: fixed;
      right: 24px;
      bottom: 80px;
      width: 340px;
      max-width: 90vw;
      max-height: 60vh;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #d4e5e7);
      border-radius: var(--radius-lg, 12px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      z-index: 180;
      pointer-events: auto;
    }

    .list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }

    .list-header h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary, #1a2e30);
    }

    .list-item {
      display: flex;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border, #f0f0f0);
      cursor: pointer;
      transition: background 0.15s;
    }

    .list-item:hover { background: #f9fafb; }
    .list-item.resolved { opacity: 0.6; }

    .list-index {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #f59e0b;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .list-index.resolved { background: #10b981; }

    .list-content { flex: 1; min-width: 0; }

    .list-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .list-author {
      font-weight: 600;
      font-size: 12px;
      color: var(--text-primary, #1a2e30);
    }

    .list-date {
      font-size: 11px;
      color: var(--text-muted, #7a9a9d);
    }

    .list-body {
      font-size: 13px;
      color: var(--text-secondary, #4a6366);
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .list-replies {
      font-size: 11px;
      color: #d97706;
      margin-top: 4px;
      display: inline-block;
    }

    .list-empty {
      padding: 40px 16px;
      text-align: center;
      color: var(--text-muted, #7a9a9d);
      font-size: 14px;
    }

    /* The commented passage itself. Translucent rather than opaque so the text
       reads through it like a marker pen, and pointer-transparent so selecting
       a commented sentence still works — clicks are hit-tested in code. */
    .annotation-highlight {
      position: absolute;
      pointer-events: none;
      z-index: 1;
      border-radius: 2px;
      background: rgba(245, 158, 11, 0.26);
      box-shadow: inset 0 -1px 0 rgba(245, 158, 11, 0.55);
      transition: background 0.12s ease, box-shadow 0.12s ease;
    }

    /* Hovering the pin, or having its thread open, lifts the passage so you can
       see which words a comment belongs to before committing to opening it. */
    .annotation-highlight.active {
      background: rgba(245, 158, 11, 0.42);
      box-shadow: inset 0 -2px 0 rgba(217, 119, 6, 0.85);
    }

    /* Settled discussion shouldn't keep shouting from the page. */
    .annotation-highlight.resolved {
      background: rgba(16, 185, 129, 0.14);
      box-shadow: inset 0 -1px 0 rgba(16, 185, 129, 0.4);
    }

    .annotation-highlight.resolved.active {
      background: rgba(16, 185, 129, 0.26);
    }

    /* Fuzzy match: dashed underline, matching the amber ring on its pin. */
    .annotation-highlight.shifted {
      box-shadow: inset 0 -2px 0 rgba(180, 125, 42, 0.7);
    }

    /* The passage being written about right now. */
    .annotation-highlight.draft {
      background: rgba(245, 158, 11, 0.4);
      box-shadow: inset 0 -2px 0 rgba(217, 119, 6, 0.9);
    }

    @media (prefers-reduced-motion: reduce) {
      .annotation-highlight { transition: none; }
    }

    /* Unanchored comments. Amber rather than red: nothing is broken and nothing
       is lost — the text simply moved on and a person needs to decide. */
    .orphan-section {
      border-top: 1px solid var(--border, #d4e5e7);
      margin-top: 8px;
      padding-top: 8px;
    }

    .orphan-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px 2px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #b07d2a;

      .material-icons { font-size: 16px; }
    }

    .orphan-explainer {
      margin: 0;
      padding: 0 16px 8px;
      font-size: 12px;
      color: var(--text-muted, #7a9a9d);
    }

    .orphan-item {
      cursor: default;
      border-left: 3px solid rgba(180, 125, 42, 0.6);
    }

    .orphan-quote {
      margin: 6px 0 0;
      padding-left: 8px;
      border-left: 2px solid var(--border, #d4e5e7);
      font-size: 12.5px;
      font-style: italic;
      color: var(--text-muted, #7a9a9d);
      overflow-wrap: anywhere;
    }

    .orphan-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .orphan-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 6px;
      background: none;
      color: var(--text-primary, #12262a);
      font-size: 12px;
      cursor: pointer;

      .material-icons { font-size: 14px; }

      &:hover { background: var(--background, #f6f6f2); }
    }

    .reanchor-banner {
      position: fixed;
      left: 50%;
      bottom: 88px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(520px, 92vw);
      padding: 10px 14px;
      border-radius: 999px;
      background: #b07d2a;
      color: #fff;
      font-size: 13px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
      z-index: 400;

      .material-icons { font-size: 18px; }
    }

    .reanchor-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .reanchor-cancel {
      border: none;
      background: rgba(255, 255, 255, 0.22);
      color: #fff;
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;

      &:hover { background: rgba(255, 255, 255, 0.35); }
    }
  `]
})
export class AnnotationOverlayComponent implements OnInit, OnDestroy {
  // Inputs
  spaceId = input<string>('');
  filePath = input.required<string>();
  renderMode = input.required<RenderMode>();
  permission = input<AnnotationPermission>('VIEW');
  shareToken = input<string | null>(null);
  currentUserId = input<string | null>(null);
  // Set false to hide the annotation FAB entirely (e.g. distraction-free fullscreen preview)
  allowComment = input<boolean>(true);
  /**
   * Content hash of the document as currently rendered. When it matches what an
   * anchor was last resolved against, the stored placement still holds and the
   * whole matching pipeline is skipped.
   */
  docHash = input<string | null>(null);

  // State
  annotations = signal<Annotation[]>([]);
  annotationMode = signal(false);
  activeAnnotationId = signal<string | null>(null);
  showList = signal(false);
  threadPosX = signal(0);
  threadPosY = signal(0);
  newAnnotation = signal<NewAnnotationDraft | null>(null);
  newAnnotationText = '';
  authorNameInput = '';
  authorName = signal<string | null>(null);

  // Content-layer geometry (image mode) — tracked so markers anchor to the image, not the viewport
  contentWidth = signal(0);
  contentHeight = signal(0);
  contentLeft = signal(0);
  contentTop = signal(0);
  private contentObserver: ResizeObserver | null = null;
  private contentTarget: HTMLElement | null = null;

  // Computed
  activeAnnotation = computed(() => {
    const id = this.activeAnnotationId();
    return id ? this.annotations().find(a => a.id === id) ?? null : null;
  });

  unresolvedCount = computed(() => this.annotations().filter(a => !a.resolved).length);

  requiresName = computed(() => this.shareToken() !== null);

  // --- Anchoring (text documents) ---

  /** Where each comment currently lands, keyed by annotation id. */
  placements = signal<Map<string, Placement>>(new Map());

  /** True for the render modes whose anchors are text rather than coordinates. */
  usesTextAnchoring = computed(() => this.renderMode() === 'markdown');

  /** Comments that still have a place on the page, in stable display order. */
  placedAnnotations = computed(() => {
    if (!this.usesTextAnchoring()) return this.annotations();
    const placements = this.placements();
    return this.annotations().filter(a => placements.get(a.id)?.state !== 'ORPHANED');
  });

  /**
   * Comments whose text is gone. Kept and shown rather than resolved — a
   * comment about a paragraph someone rewrote is the one most likely to still
   * need an answer.
   */
  orphanedAnnotations = computed(() => {
    if (!this.usesTextAnchoring()) return [];
    const placements = this.placements();
    return this.annotations().filter(a => placements.get(a.id)?.state === 'ORPHANED');
  });

  /** The annotation being given a new home by clicking, or null. */
  reanchoring = signal<Annotation | null>(null);

  placementOf(id: string): Placement | undefined {
    return this.placements().get(id);
  }

  /** 1-based badge number, counted over the comments actually on the page. */
  markerIndexOf(annotation: Annotation): number {
    return this.annotations().findIndex(a => a.id === annotation.id) + 1;
  }

  /** Consecutive resolution passes that found no text to anchor against. */
  private emptyRetries = 0;
  private resizeObserver: ResizeObserver | null = null;
  private reflowHandle: ReturnType<typeof setTimeout> | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private iframeReady = false;
  private boundMessageHandler = this.onIframeMessage.bind(this);

  constructor(
    private annotationsService: AnnotationsService,
    private toastService: ToastService,
    private elRef: ElementRef
  ) {
    effect(() => {
      const fp = this.filePath();
      const sid = this.spaceId();
      if (fp && sid) {
        this.loadAnnotations();
      }
    });

    // Mirror comment-mode state into the iframe so its click listener only acts when on.
    effect(() => {
      const on = this.annotationMode();
      if (this.renderMode() === 'html' && this.iframeReady) {
        this.sendToIframe({ source: 'docuvault-annotations', type: 'set-comment-mode', on });
      }
    });
  }

  ngOnInit(): void {
    const token = this.shareToken();
    if (token) {
      const stored = localStorage.getItem(`dv-author-${token}`);
      if (stored) this.authorName.set(stored);
    }

    window.addEventListener('message', this.boundMessageHandler);
    setTimeout(() => document.addEventListener('mousedown', this.boundDocClick), 0);
    this.loadAnnotations();
    this.refreshInterval = setInterval(() => this.loadAnnotations(), 30000);

    if (this.renderMode() === 'image') {
      // Defer to next tick so the <img> sibling is rendered before we observe it
      setTimeout(() => this.observeContentTarget(), 0);
    }

    if (this.usesTextAnchoring()) {
      setTimeout(() => this.observeHostResize(), 0);
      document.addEventListener('contextmenu', this.onHostContextMenu, true);
      document.addEventListener('mouseup', this.onSelectionSettled);
      document.addEventListener('keyup', this.onSelectionSettled);
      document.addEventListener('selectionchange', this.onSelectionChanged);
      document.addEventListener('click', this.onHostClick, true);
    }
  }

  /** Pin currently hovered, so its highlight lifts with it. */
  hoveredAnnotationId = signal<string | null>(null);

  /**
   * Open a comment by clicking the text it is attached to.
   *
   * The highlights themselves are pointer-transparent — if they weren't, you
   * could no longer select a commented passage, which is the very gesture that
   * creates comments. So the click is caught on the host and tested against the
   * stored rects instead.
   */
  private onHostClick = (event: MouseEvent): void => {
    const host = this.host;
    if (!host || !this.usesTextAnchoring()) return;
    if (this.newAnnotation() || this.reanchoring()) return;

    const target = event.target as HTMLElement | null;
    if (!target || !host.contains(target)) return;
    // A link inside a commented sentence still navigates, and our own chrome
    // handles its own clicks.
    if (target.closest('a, button, input, textarea, .annotation-pin, .annotation-thread, .annotation-list, .annotation-fab, .new-annotation-popover')) {
      return;
    }
    // A drag that selected text is not a click — leave the selection alone.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    const hit = this.annotationAtPoint(event.clientX, event.clientY);
    if (!hit) return;

    event.preventDefault();
    event.stopPropagation();
    this.openThread(hit, event);
  };

  /** The most specific commented passage under a point, if any. */
  private annotationAtPoint(clientX: number, clientY: number): Annotation | null {
    const host = this.host;
    if (!host) return null;
    const hostBox = host.getBoundingClientRect();
    const x = clientX - hostBox.left + host.scrollLeft;
    const y = clientY - hostBox.top + host.scrollTop;

    let best: { annotation: Annotation; area: number } | null = null;
    for (const annotation of this.placedAnnotations()) {
      const placement = this.placements().get(annotation.id);
      if (!placement) continue;
      for (const r of placement.rects) {
        if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
        // Overlapping comments: the tightest one is the one meant.
        const area = placement.rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
        if (!best || area < best.area) best = { annotation, area };
        break;
      }
    }
    return best?.annotation ?? null;
  }

  /** Lines an about-to-be-created anchor covers, for the draft highlight. */
  private rectsForAnchor(anchor: AnnotationAnchor, host: HTMLElement): Rect[] {
    const result = anchorRecord(host, toAnchorRecord(anchor));
    if (!result.range) return [];
    return rectsOf(result.range, host, host.getBoundingClientRect());
  }

  // --- Right-click menu ---

  /** The open context menu: its items and where the pointer was. */
  contextMenu = signal<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
  /** What the menu was opened on, kept so the chosen action knows its target. */
  private contextTarget: { selection: Range | null; annotation: Annotation | null } = {
    selection: null,
    annotation: null
  };

  /**
   * Open the right-click menu over the document.
   *
   * Bound in the capture phase on the host so it works over the rendered
   * content and over a pin alike, and so it beats the browser's own menu
   * without every child having to opt in.
   */
  private onHostContextMenu = (event: MouseEvent): void => {
    const host = this.host;
    if (!host || !this.usesTextAnchoring()) return;

    const target = event.target as HTMLElement | null;
    if (!target || !host.contains(target)) return;
    // Leave form fields and our own popovers to the browser's menu — cut,
    // copy and paste are more useful there than anything offered here.
    if (target.closest('input, textarea, [contenteditable="true"], .annotation-thread, .annotation-list, .new-annotation-popover')) {
      return;
    }

    const annotation = this.annotationUnder(target);
    const selection = this.selectionInside(host);
    const items = this.buildContextMenu(selection, annotation);
    if (items.length === 0) return;

    event.preventDefault();
    this.contextTarget = { selection, annotation };
    this.contextMenu.set({ items, x: event.clientX, y: event.clientY });
  };

  /** The comment whose pin was right-clicked, if any. */
  private annotationUnder(target: HTMLElement): Annotation | null {
    const pin = target.closest('app-annotation-marker');
    if (!pin) return null;
    // Markers render in the same order as the placed list, so position maps back.
    const markers = Array.from(this.host?.querySelectorAll('app-annotation-marker') ?? []);
    const placed = this.placedAnnotations();
    const at = markers.indexOf(pin);
    return at >= 0 && at < placed.length ? placed[at] : null;
  }

  /** The current selection, but only when it lies inside this document. */
  private selectionInside(host: HTMLElement): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return null;
    return range.toString().trim() ? range : null;
  }

  private buildContextMenu(selection: Range | null, annotation: Annotation | null): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    if (annotation) {
      items.push({ id: 'open', label: 'Open comment', icon: 'chat_bubble_outline' });
      if (this.canResolve(annotation)) {
        items.push({
          id: 'resolve',
          label: annotation.resolved ? 'Reopen comment' : 'Resolve comment',
          icon: annotation.resolved ? 'restart_alt' : 'check_circle_outline'
        });
      }
      if (this.canDelete(annotation)) {
        items.push({ id: 'delete', label: 'Delete comment', icon: 'delete_outline', danger: true });
      }
      return items;
    }

    if (selection) {
      // No quote hint here: the selection is highlighted on the page right
      // behind the menu, so repeating it is noise — and truncated to a couple
      // of words it doesn't even show where the selection ends, which was the
      // only thing it could have usefully confirmed.
      items.push({
        id: 'comment-selection',
        label: 'Comment on selection',
        icon: 'add_comment',
        disabled: !this.canComment(),
        disabledReason: this.shareToken()
          ? 'This share link is view-only'
          : 'You need comment access on this space'
      });
      items.push({ id: 'copy', label: 'Copy', icon: 'content_copy' });
    } else if (this.canComment()) {
      items.push({
        id: 'comment-here',
        label: 'Comment on this paragraph',
        icon: 'add_comment'
      });
    }

    if (this.annotations().length > 0) {
      items.push({ id: 'list', label: 'Show all comments', icon: 'forum' });
    }

    return items;
  }

  onContextMenuSelect(item: ContextMenuItem): void {
    const { selection, annotation } = this.contextTarget;
    const at = this.contextMenu();
    this.closeContextMenu();

    switch (item.id) {
      case 'open':
        if (annotation) this.openThreadFromList(annotation);
        break;
      case 'resolve':
        if (annotation) this.onResolve(annotation.id);
        break;
      case 'delete':
        if (annotation) this.onDelete(annotation.id);
        break;
      case 'copy':
        if (selection) navigator.clipboard?.writeText(selection.toString()).catch(() => {});
        break;
      case 'list':
        this.showList.set(true);
        break;
      case 'comment-selection':
        if (selection && at) this.startCommentOnRange(selection, at.x, at.y);
        break;
      case 'comment-here':
        if (at) this.startCommentAtPoint(at.x, at.y);
        break;
    }
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  // --- Comment on a selection, without the detour through a menu ---

  /** Where to offer a comment for the selection that was just made. */
  selectionOffer = signal<{ x: number; y: number } | null>(null);
  private offeredRange: Range | null = null;

  /**
   * Runs when a selection is finished rather than while it is being dragged,
   * so the button appears where the gesture ended instead of chasing the
   * pointer across the paragraph.
   */
  private onSelectionSettled = (): void => {
    // The browser updates the selection after these events, not before.
    setTimeout(() => this.refreshSelectionOffer(), 0);
  };

  private onSelectionChanged = (): void => {
    // A selection inside the preview frame is reported by the frame itself;
    // the parent's own selection is empty then and must not clear the offer.
    if (this.framedSelection) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) this.clearSelectionOffer();
  };

  /** Quote reported by the preview frame, for a selection made inside it. */
  private framedSelection: { quote: string; xPercent: number; yPercent: number } | null = null;

  private refreshSelectionOffer(): void {
    const host = this.host;
    if (!host || !this.usesTextAnchoring() || !this.canComment()) return this.clearSelectionOffer();
    // Not while something else already owns the selection or the screen.
    if (this.newAnnotation() || this.activeAnnotationId() || this.contextMenu() || this.reanchoring()) {
      return this.clearSelectionOffer();
    }

    const range = this.selectionInside(host);
    if (!range) return this.clearSelectionOffer();

    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
    const last = rects[rects.length - 1];
    if (!last) return this.clearSelectionOffer();

    // Beside where the selection ends, centred on that line: a button floating
    // above it would cover the line before, which is often the text being read.
    this.offeredRange = range.cloneRange();
    this.selectionOffer.set({
      x: Math.min(last.right + 8, window.innerWidth - 38),
      y: Math.min(Math.max(6, last.top + (last.height - 30) / 2), window.innerHeight - 38)
    });
  }

  private clearSelectionOffer(): void {
    this.offeredRange = null;
    this.framedSelection = null;
    if (this.selectionOffer()) this.selectionOffer.set(null);
  }

  /** Opens the composer on the selection the button belongs to. */
  commentOnOfferedSelection(): void {
    const range = this.offeredRange;
    const framed = this.framedSelection;
    const at = this.selectionOffer();
    this.clearSelectionOffer();
    if (!at) return;

    if (framed) {
      this.startCommentOnFramedSelection(framed, at.x, at.y);
      return;
    }
    if (range) this.startCommentOnRange(range, at.x, at.y);
  }

  /**
   * A selection made inside the preview frame. The frame reported the words and
   * where they sit; the comment is anchored to the quote, so it survives the
   * page being re-rendered around it exactly as a markdown one does.
   */
  private startCommentOnFramedSelection(
    framed: { quote: string; xPercent: number; yPercent: number },
    screenX: number,
    screenY: number
  ): void {
    this.closeThread();
    this.newAnnotation.set({
      anchor: {
        type: 'html',
        v: ANCHOR_VERSION,
        xPercent: framed.xPercent,
        yPercent: framed.yPercent,
        snippet: framed.quote,
        selectors: [{ type: 'TextQuote', exact: framed.quote }]
      },
      screenX,
      screenY,
      dotX: framed.xPercent,
      dotY: framed.yPercent,
      dotUnit: '%',
      // The passage lives in the frame, so the frame lights it — nothing to
      // paint out here.
      rects: []
    });
    this.newAnnotationText = '';
  }

  /** Open the comment composer against an explicit selection. */
  private startCommentOnRange(range: Range, screenX: number, screenY: number): void {
    const host = this.host;
    if (!host) return;
    const described = describeRange(host, range);
    if (!described) return;

    const box = range.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    // Our own highlight replaces the native selection, which the browser drops
    // the moment focus moves into the comment box anyway — so without this the
    // passage goes dark exactly while you are writing about it.
    const rects = rectsOf(range, host, hostBox);
    window.getSelection()?.removeAllRanges();

    this.closeThread();
    this.newAnnotation.set({
      anchor: described as unknown as AnnotationAnchor,
      screenX: screenX + 12,
      screenY: screenY,
      dotX: box.left - hostBox.left + host.scrollLeft,
      dotY: box.top - hostBox.top + host.scrollTop,
      dotUnit: 'px',
      rects
    });
  }

  /** Open the composer against whatever block sits under the pointer. */
  private startCommentAtPoint(clientX: number, clientY: number): void {
    const host = this.host;
    if (!host) return;
    const described = describePoint(host, clientX, clientY);
    if (!described) return;

    const hostBox = host.getBoundingClientRect();
    this.closeThread();
    this.newAnnotation.set({
      anchor: described as unknown as AnnotationAnchor,
      screenX: clientX + 12,
      screenY: clientY,
      dotX: clientX - hostBox.left + host.scrollLeft,
      dotY: clientY - hostBox.top + host.scrollTop,
      dotUnit: 'px',
      rects: []
    });
  }

  // --- Anchor resolution ---

  /** The element the document is rendered into — everything anchors inside it. */
  private get host(): HTMLElement | null {
    return (this.elRef.nativeElement.parentElement as HTMLElement) ?? null;
  }

  /**
   * Put every comment back onto the document as it stands right now.
   *
   * Runs on load, on resize and whenever the rendered content changes, because
   * a resolved position is measured from the live DOM rather than stored — which
   * is exactly why reflow and zoom stop moving pins around.
   */
  private resolveAnchors(): void {
    const host = this.host;
    if (!host || !this.usesTextAnchoring()) return;

    const annotations = this.annotations();
    if (annotations.length === 0) {
      if (this.placements().size) this.placements.set(new Map());
      return;
    }

    // Built once for the whole pass rather than per comment, and used as the
    // gate below: an empty index means the document hasn't rendered yet, not
    // that every comment lost its text.
    const index = TextIndex.build(host);
    if (!index.text.trim()) {
      // Resolving now would orphan every comment on the page and — worse —
      // persist that, so the next reader loads a document whose comments are
      // all marked unanchored. Wait for the content instead. Bounded, because
      // a document really can be empty and this must not spin forever.
      if (this.emptyRetries < 20) {
        this.emptyRetries++;
        this.scheduleReflow(150);
      }
      return;
    }

    this.emptyRetries = 0;
    const hostBox = host.getBoundingClientRect();
    const next = new Map<string, Placement>();

    for (const annotation of annotations) {
      const stored = toAnchorRecord(annotation.anchorCurrent ?? annotation.anchor);
      const result = anchorRecord(host, stored, index);

      let x = 0;
      let y = 0;
      let rects: Rect[] = [];
      if (result.range) {
        const box = firstVisibleRect(result.range);
        if (box) {
          // Document-space, not viewport-space: the pin lives inside the
          // scrolling host, so it must not move when the host scrolls.
          x = box.left - hostBox.left + host.scrollLeft;
          y = box.top - hostBox.top + host.scrollTop;
        }
        rects = rectsOf(result.range, host, hostBox);
      }

      next.set(annotation.id, {
        state: result.state,
        position: result.position,
        currentText: result.currentText,
        x,
        y,
        rects
      });

      this.persistPlacement(annotation, result, stored);
    }

    this.placements.set(next);
  }

  /**
   * Write a re-resolved anchor back, so the next reader doesn't redo the work
   * and the space's unanchored count reflects reality. Skipped when nothing
   * changed, which is the overwhelmingly common case.
   */
  private persistPlacement(annotation: Annotation, result: Anchored, stored: AnchorRecord | null): void {
    const docHash = this.docHash();
    // No hash means the surface can't vouch for what it is rendering — the
    // editor shows unsaved text, and caching an anchor against a draft that may
    // never be saved would point every reader at text that doesn't exist.
    // Those surfaces still resolve and display; they just don't write back.
    if (!docHash) return;

    const stateChanged = annotation.anchorState !== result.state;
    const hashChanged = annotation.anchorDocHash !== docHash;
    // A legacy anchor gets promoted the first time it resolves — that is how the
    // percentage-only backlog acquires a quote selector without a migration.
    const needsUpgrade = (annotation.anchorVersion ?? 0) < ANCHOR_VERSION && result.state !== 'ORPHANED';
    if (!stateChanged && !hashChanged && !needsUpgrade) return;

    const record = result.range && result.position
      ? describeRange(this.host!, result.range) ?? stored
      : stored;

    const request = {
      anchorCurrent: (record as AnnotationAnchor | null) ?? undefined,
      anchorState: result.state,
      docHash
    };

    const token = this.shareToken();
    const call = token
      ? this.annotationsService.updatePublicAnchor(token, annotation.id, request)
      : this.annotationsService.updateAnchor(this.spaceId(), annotation.id, request);

    // Best-effort: a failure here costs a recomputation next time, nothing more.
    call.subscribe({
      next: (updated) => this.annotations.update(list =>
        list.map(a => a.id === updated.id ? { ...a, ...updated, replies: a.replies } : a)
      ),
      error: () => {}
    });
  }

  /** Recompute positions after layout settles — images and diagrams arrive late. */
  private scheduleReflow(delay = 120): void {
    if (this.reflowHandle) clearTimeout(this.reflowHandle);
    this.reflowHandle = setTimeout(() => {
      this.reflowHandle = null;
      this.resolveAnchors();
    }, delay);
  }

  private observeHostResize(): void {
    const host = this.host;
    if (!host || !this.usesTextAnchoring()) return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleReflow(60));
    this.resizeObserver.observe(host);
  }

  // --- Re-anchoring an orphan ---

  startReanchor(annotation: Annotation): void {
    this.reanchoring.set(annotation);
    this.showList.set(false);
    this.annotationMode.set(true);
    this.closeThread();
    this.toastService.info(
      'Pick a spot',
      `Click where "${annotation.body.slice(0, 40)}" belongs now.`
    );
  }

  cancelReanchor(): void {
    this.reanchoring.set(null);
    this.annotationMode.set(false);
  }

  private applyReanchor(annotation: Annotation, anchor: AnnotationAnchor): void {
    const request = {
      anchorCurrent: anchor,
      anchorState: 'ANCHORED' as const,
      docHash: this.docHash() ?? undefined
    };
    const token = this.shareToken();
    const call = token
      ? this.annotationsService.updatePublicAnchor(token, annotation.id, request)
      : this.annotationsService.updateAnchor(this.spaceId(), annotation.id, request);

    call.subscribe({
      next: () => {
        this.reanchoring.set(null);
        this.annotationMode.set(false);
        this.toastService.success('Re-anchored', 'The comment now points at the text you picked.');
        this.loadAnnotations();
      },
      error: () => {
        this.toastService.error('Re-anchor failed', 'Could not move that comment.');
      }
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this.reflowHandle) clearTimeout(this.reflowHandle);
    window.removeEventListener('message', this.boundMessageHandler);
    document.removeEventListener('mousedown', this.boundDocClick);
    document.removeEventListener('contextmenu', this.onHostContextMenu, true);
    document.removeEventListener('mouseup', this.onSelectionSettled);
    document.removeEventListener('keyup', this.onSelectionSettled);
    document.removeEventListener('selectionchange', this.onSelectionChanged);
    document.removeEventListener('click', this.onHostClick, true);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.contentObserver) {
      this.contentObserver.disconnect();
      this.contentObserver = null;
    }
  }

  // --- Content-layer tracking (image mode) ---

  private observeContentTarget(): void {
    const parent = this.elRef.nativeElement.parentElement as HTMLElement | null;
    if (!parent) return;
    const img = parent.querySelector('img') as HTMLImageElement | null;
    if (!img) return;

    this.contentTarget = img;

    const update = () => this.updateContentGeometry();

    if (!img.complete) {
      img.addEventListener('load', update, { once: true });
    }

    this.contentObserver = new ResizeObserver(update);
    this.contentObserver.observe(img);
    this.contentObserver.observe(parent);
    update();
  }

  private updateContentGeometry(): void {
    const img = this.contentTarget;
    if (!img) return;
    const parent = this.elRef.nativeElement.parentElement as HTMLElement | null;
    if (!parent) return;

    // offsetLeft/offsetTop give the image's position inside its scrollable parent (not viewport-relative,
    // so values stay correct regardless of scroll position).
    this.contentLeft.set(img.offsetLeft);
    this.contentTop.set(img.offsetTop);
    this.contentWidth.set(img.offsetWidth);
    this.contentHeight.set(img.offsetHeight);
  }

  onContentLayerClick(event: MouseEvent): void {
    if (!this.canComment()) return;

    const target = event.target as HTMLElement;
    if (target.closest('.annotation-pin, .annotation-thread, .new-annotation-popover, .annotation-fab, .annotation-list')) return;

    const layer = event.currentTarget as HTMLElement;
    const rect = layer.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;

    const anchor: AnnotationAnchor = {
      type: 'image',
      xPercent,
      yPercent
    };

    this.closeThread();
    this.newAnnotation.set({
      anchor, screenX: event.clientX + 16, screenY: event.clientY,
      dotX: xPercent, dotY: yPercent, dotUnit: '%', rects: []
    });
  }

  private boundDocClick = (event: MouseEvent) => {
    if (!this.activeAnnotation() && !this.newAnnotation()) return;
    const target = event.target as HTMLElement;
    if (target.closest('app-annotation-thread, .annotation-thread, .annotation-pin, app-annotation-marker, .annotation-fab, .new-annotation-popover')) return;
    this.closeThread();
    this.cancelNewAnnotation();
  };


  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.newAnnotation()) {
      this.cancelNewAnnotation();
    } else if (this.activeAnnotation()) {
      this.closeThread();
    } else if (this.annotationMode()) {
      this.annotationMode.set(false);
    }
  }

  onLayerClick(event: MouseEvent): void {
    const reanchoring = this.reanchoring();
    if (!reanchoring && !this.canComment()) return;

    const target = event.target as HTMLElement;
    if (target.closest('.annotation-pin, .annotation-thread, .new-annotation-popover, .annotation-fab, .annotation-list')) return;

    const container = this.elRef.nativeElement.parentElement as HTMLElement;
    const anchor = this.describeClick(container, event);
    if (!anchor) return;

    if (reanchoring) {
      this.applyReanchor(reanchoring, anchor);
      return;
    }

    this.closeThread();
    const box = container.getBoundingClientRect();
    const usesPixels = this.usesTextAnchoring();
    this.newAnnotation.set({
      anchor,
      screenX: event.clientX + 16,
      screenY: event.clientY,
      dotX: usesPixels
        ? event.clientX - box.left + container.scrollLeft
        : ((event.clientX - box.left) / box.width) * 100,
      dotY: usesPixels
        ? event.clientY - box.top + container.scrollTop
        : ((event.clientY - box.top + container.scrollTop) / container.scrollHeight) * 100,
      dotUnit: usesPixels ? 'px' : '%',
      rects: usesPixels ? this.rectsForAnchor(anchor, container) : []
    });
  }

  /**
   * Turn a click into an anchor. For text documents that means the text under
   * the pointer, not the coordinates of the pointer: a percentage of the page
   * height stops being true the moment anyone adds a paragraph above it.
   *
   * The click layer sits over the content, so it has to be made transparent to
   * hit-testing for the moment it takes to see what is underneath.
   */
  private describeClick(container: HTMLElement, event: MouseEvent): AnnotationAnchor | null {
    if (!this.usesTextAnchoring()) {
      const rect = container.getBoundingClientRect();
      return {
        type: this.renderMode() as AnnotationAnchor['type'],
        xPercent: ((event.clientX - rect.left) / rect.width) * 100,
        yPercent: ((event.clientY - rect.top + container.scrollTop) / container.scrollHeight) * 100
      };
    }

    // A live selection is the strongest signal available — the reader has told
    // us exactly which words they mean.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (container.contains(range.commonAncestorContainer)) {
        const described = describeRange(container, range);
        if (described) {
          selection.removeAllRanges();
          return described as unknown as AnnotationAnchor;
        }
      }
    }

    const layer = container.querySelector('.annotation-click-layer') as HTMLElement | null;
    const previous = layer?.style.pointerEvents ?? '';
    if (layer) layer.style.pointerEvents = 'none';
    const described = describePoint(container, event.clientX, event.clientY);
    if (layer) layer.style.pointerEvents = previous;

    return (described as unknown as AnnotationAnchor) ?? null;
  }

  /** Same rules as the thread popover applies to its own buttons. */
  canResolve(annotation: Annotation): boolean {
    const p = this.permission();
    if (p === 'EDIT' || p === 'ADMIN') return true;
    if (p === 'COMMENT') return annotation.userId === this.currentUserId() || annotation.userId === null;
    return false;
  }

  canDelete(annotation: Annotation): boolean {
    const p = this.permission();
    if (p === 'ADMIN') return true;
    if (p === 'EDIT' || p === 'COMMENT') {
      return annotation.userId === this.currentUserId() || annotation.userId === null;
    }
    return false;
  }

  canComment(): boolean {
    if (!this.allowComment()) return false;
    const p = this.permission();
    return p === 'COMMENT' || p === 'EDIT' || p === 'ADMIN';
  }

  toggleAnnotationMode(): void {
    const entering = !this.annotationMode();
    this.annotationMode.set(entering);
    this.cancelNewAnnotation();
    this.closeThread();
  }

  // --- iframe communication ---

  private onIframeMessage(event: MessageEvent): void {
    // The previewed document may run untrusted scripts of its own — that is a
    // deliberate product decision (see SECURITY.md) — so a message claiming to
    // be from the bridge is not enough on its own. The frame is same-origin, so
    // anything from elsewhere is not ours.
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'docuvault-annotations') return;

    if (data.type === 'ready') {
      this.iframeReady = true;
      this.sendMarkersToIframe();
      if (this.canComment()) {
        this.sendToIframe({ source: 'docuvault-annotations', type: 'enable-click-capture' });
        this.sendToIframe({ source: 'docuvault-annotations', type: 'set-comment-mode', on: this.annotationMode() });
      }
    }

    if (data.type === 'marker-click') {
      const annotation = this.annotations().find(a => a.id === data.id);
      if (annotation) {
        this.activeAnnotationId.set(annotation.id);
        this.cancelNewAnnotation();
        const iframe = this.getIframeElement();
        if (iframe) {
          const rect = iframe.getBoundingClientRect();
          this.threadPosX.set(rect.left + rect.width / 2 - 160);
          this.threadPosY.set(Math.max(20, rect.top + 40));
        } else {
          this.threadPosX.set(Math.max(20, (window.innerWidth - 340) / 2));
          this.threadPosY.set(Math.max(20, window.innerHeight * 0.3));
        }
      }
    }

    // A selection inside the preview frame: the same offer as in a markdown
    // document, positioned over the frame at the coordinates it reported.
    if (data.type === 'selection' && this.canComment() && !this.newAnnotation() && !this.activeAnnotationId()) {
      const iframe = this.getIframeElement();
      const frame = iframe?.getBoundingClientRect();
      if (frame && data.rect) {
        this.framedSelection = {
          quote: data.quote,
          xPercent: data.xPercent,
          yPercent: data.yPercent
        };
        this.selectionOffer.set({
          x: Math.min(frame.left + data.rect.right + 8, window.innerWidth - 38),
          y: Math.min(
            Math.max(6, frame.top + data.rect.top + (data.rect.height - 30) / 2),
            window.innerHeight - 38
          )
        });
      }
    }

    if (data.type === 'selection-cleared') {
      this.clearSelectionOffer();
    }

    if (data.type === 'click-position' && this.annotationMode() && this.canComment()) {
      // Carries both shapes: the flat fields the bridge positions from, and a
      // v1 selector list so the quote is stored the same way as everywhere else.
      const quote: string | undefined = data.quote || undefined;
      const anchor: AnnotationAnchor = {
        type: 'html',
        v: ANCHOR_VERSION,
        xPercent: data.xPercent,
        yPercent: data.yPercent,
        offsetX: typeof data.offsetX === 'number' ? data.offsetX : undefined,
        offsetY: typeof data.offsetY === 'number' ? data.offsetY : undefined,
        elementId: data.elementId || undefined,
        selector: data.selector || undefined,
        snippet: quote,
        selectors: [
          ...(data.elementId || data.selector
            ? [{ type: 'Structural', elementId: data.elementId || undefined, path: data.selector || undefined }]
            : []),
          ...(quote ? [{ type: 'TextQuote', exact: quote }] : []),
          { type: 'Geometric', xPercent: data.xPercent, yPercent: data.yPercent }
        ]
      };

      this.closeThread();

      // Translate the iframe-local click coords into parent-viewport coords, then offset for the popover.
      const iframe = this.getIframeElement();
      const rect = iframe?.getBoundingClientRect();
      let screenX: number;
      let screenY: number;
      if (rect && typeof data.clientX === 'number' && typeof data.clientY === 'number') {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const POPOVER_W = 280;
        const POPOVER_H = 160;
        screenX = rect.left + data.clientX + 16;
        screenY = rect.top + data.clientY - 20;
        // Edge clipping
        if (screenX + POPOVER_W > vw) screenX = rect.left + data.clientX - POPOVER_W - 16;
        if (screenY + POPOVER_H > vh) screenY = vh - POPOVER_H - 20;
        if (screenY < 10) screenY = 10;
        if (screenX < 10) screenX = 10;
      } else {
        screenX = rect ? rect.left + rect.width / 2 - 140 : window.innerWidth / 2;
        screenY = rect ? rect.top + 60 : window.innerHeight * 0.3;
      }
      this.newAnnotation.set({
        anchor, screenX, screenY,
        dotX: anchor.xPercent ?? 0, dotY: anchor.yPercent ?? 0, dotUnit: '%', rects: []
      });
    }
  }

  private sendMarkersToIframe(): void {
    if (this.renderMode() !== 'html' || !this.iframeReady) return;

    const markerData = this.annotations().map((a, i) => {
      const stored = a.anchorCurrent ?? a.anchor;
      const record = toAnchorRecord(stored);
      const quote = findSelector<TextQuoteSelector>(record, 'TextQuote');
      return {
        id: a.id,
        index: i + 1,
        xPercent: stored?.xPercent ?? 50,
        yPercent: stored?.yPercent ?? 50,
        elementId: stored?.elementId,
        selector: stored?.selector,
        offsetX: stored?.offsetX,
        offsetY: stored?.offsetY,
        // The bridge prefers this over the selector path, for the same reason
        // the parent does: a path matches whatever now sits in that slot.
        quote: quote?.exact ?? stored?.snippet,
        shifted: a.anchorState === 'SHIFTED',
        resolved: a.resolved
      };
    });

    this.sendToIframe({
      source: 'docuvault-annotations',
      type: 'render-markers',
      annotations: markerData
    });
  }

  private sendToIframe(message: any): void {
    const iframe = this.getIframeElement();
    // Addressed to our own origin rather than '*': the frame is same-origin, and
    // a wildcard would hand the payload to whatever ends up loaded there.
    iframe?.contentWindow?.postMessage(message, window.location.origin);
  }

  private getIframeElement(): HTMLIFrameElement | null {
    const parent = this.elRef.nativeElement.parentElement as HTMLElement;
    return parent?.querySelector('iframe') ?? null;
  }

  // --- Annotation loading ---

  loadAnnotations(): void {
    const token = this.shareToken();
    const obs = token
      ? this.annotationsService.getPublicAnnotations(token, this.filePath())
      : this.annotationsService.getAnnotations(this.spaceId(), this.filePath());

    obs.subscribe({
      next: (annotations) => {
        this.annotations.set(annotations);
        this.sendMarkersToIframe();
        // Deferred one frame: the document may still be rendering, and a range
        // measured against an unlaid-out DOM gives a zero-size rect.
        this.scheduleReflow(0);
      },
      error: () => {}
    });
  }

  /** The text a comment was originally written against, if it recorded any. */
  originalQuoteOf(annotation: Annotation): string | null {
    const record = toAnchorRecord(annotation.anchor);
    const quote = findSelector<TextQuoteSelector>(record, 'TextQuote');
    const exact = quote?.exact?.trim();
    if (!exact) return null;
    return exact.length > 160 ? `${exact.slice(0, 160)}…` : exact;
  }

  // --- Thread interactions ---

  openThread(annotation: Annotation, event: MouseEvent): void {
    event.stopPropagation();
    this.activeAnnotationId.set(annotation.id);
    this.cancelNewAnnotation();

    // Beside the passage it belongs to, when we know where that is — a comment
    // about a sentence should sit next to the sentence, not wherever the
    // pointer happened to be.
    const passage = this.passageRectFor(annotation.id);
    if (passage) {
      this.placeThreadBeside(passage);
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = event.clientX + 16;
    let y = event.clientY - 20;
    if (x + 340 > vw) x = event.clientX - 356;
    if (y + 300 > vh) y = vh - 320;
    if (y < 10) y = 10;

    this.threadPosX.set(x);
    this.threadPosY.set(y);
  }

  /** Where a comment's passage sits on screen, if it is currently placed. */
  private passageRectFor(annotationId: string): DOMRect | null {
    const host = this.host;
    const rects = this.placementOf(annotationId)?.rects;
    if (!host || !rects?.length) return null;

    const box = host.getBoundingClientRect();
    const left = Math.min(...rects.map(r => r.x));
    const right = Math.max(...rects.map(r => r.x + r.w));
    const top = Math.min(...rects.map(r => r.y));
    const bottom = Math.max(...rects.map(r => r.y + r.h));

    return new DOMRect(
      box.left + left - host.scrollLeft,
      box.top + top - host.scrollTop,
      right - left,
      bottom - top
    );
  }

  /**
   * Put the thread card next to [passage], on whichever side has more room.
   *
   * A document is usually a column with margins either side, and which margin
   * is roomier depends on where the passage sits and how wide the window is —
   * so the side is measured rather than assumed. The card only falls back to
   * overlapping the text when neither margin can hold it.
   */
  private placeThreadBeside(passage: DOMRect): void {
    const gutter = 16;
    const column = this.host?.getBoundingClientRect();
    const roomLeft = passage.left;
    const roomRight = window.innerWidth - passage.right;
    const preferRight = roomRight >= roomLeft;

    // In the margin when the page has one to spare — there the card covers no
    // text at all, which is the whole point of putting it beside the passage.
    // A narrow window has no such margin, and then sitting next to the marked
    // words beats being pushed off to an edge far from them.
    const marginRight = column ? window.innerWidth - column.right : 0;
    const marginLeft = column ? column.left : 0;
    const fitsRightMargin = column && marginRight >= THREAD_WIDTH + gutter * 2;
    const fitsLeftMargin = column && marginLeft >= THREAD_WIDTH + gutter * 2;

    let x: number;
    if (preferRight && fitsRightMargin) x = column!.right + gutter;
    else if (!preferRight && fitsLeftMargin) x = column!.left - THREAD_WIDTH - gutter;
    else if (fitsRightMargin) x = column!.right + gutter;
    else if (fitsLeftMargin) x = column!.left - THREAD_WIDTH - gutter;
    else x = preferRight ? passage.right + gutter : passage.left - THREAD_WIDTH - gutter;

    this.threadPosX.set(
      Math.min(Math.max(8, x), Math.max(8, window.innerWidth - THREAD_WIDTH - 8))
    );
    this.threadPosY.set(
      Math.min(Math.max(10, passage.top - 8), Math.max(10, window.innerHeight - THREAD_HEIGHT))
    );
  }

  openThreadFromList(annotation: Annotation): void {
    this.showList.set(false);
    this.activeAnnotationId.set(annotation.id);

    if (!annotation.anchor) {
      this.threadPosX.set(Math.max(20, (window.innerWidth - 340) / 2));
      this.threadPosY.set(Math.max(20, window.innerHeight * 0.2));
      return;
    }

    // HTML mode: the iframe scrolls internally — ask the bridge script to scroll to the pin
    if (this.renderMode() === 'html') {
      this.sendToIframe({ source: 'docuvault-annotations', type: 'scroll-to-marker', id: annotation.id });
      const iframe = this.getIframeElement();
      setTimeout(() => {
        const rect = iframe?.getBoundingClientRect();
        this.threadPosX.set(rect ? rect.left + rect.width / 2 - 160 : Math.max(20, (window.innerWidth - 340) / 2));
        this.threadPosY.set(rect ? Math.max(20, rect.top + 40) : Math.max(20, window.innerHeight * 0.3));
      }, 450);
      return;
    }

    const container = this.elRef.nativeElement.parentElement as HTMLElement;
    if (!container) return;

    // Text documents already know where the comment landed, in container
    // pixels — no percentage arithmetic needed, and no drift when the page has
    // reflowed since the anchor was written.
    if (this.usesTextAnchoring()) {
      const placement = this.placements().get(annotation.id);
      if (!placement || placement.state === 'ORPHANED') {
        this.threadPosX.set(Math.max(20, (window.innerWidth - 340) / 2));
        this.threadPosY.set(Math.max(20, window.innerHeight * 0.2));
        return;
      }
      container.scrollTo({
        top: Math.max(0, placement.y - container.clientHeight / 3),
        behavior: 'smooth'
      });
      setTimeout(() => this.placeThreadNear(container, placement.x, placement.y), 350);
      return;
    }

    // For image mode, anchor coords are relative to the IMG (content-layer), not the container.
    // Use the content layer's offsetTop + the image's height to compute the scroll target.
    const isImage = this.renderMode() === 'image';
    const refHeight = isImage ? this.contentHeight() : container.scrollHeight;
    const refTopOffset = isImage ? this.contentTop() : 0;
    const refWidth = isImage ? this.contentWidth() : container.scrollWidth;
    const refLeftOffset = isImage ? this.contentLeft() : 0;
    const xPercent = annotation.anchor.xPercent ?? 50;
    const yPercent = annotation.anchor.yPercent ?? 50;

    // Scroll the container so the annotation's y position is visible
    const targetScrollTop = refTopOffset + (yPercent / 100) * refHeight - container.clientHeight / 3;
    container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });

    // Position the thread popover near the marker after scroll settles
    setTimeout(() => {
      this.placeThreadNear(
        container,
        refLeftOffset + (xPercent / 100) * refWidth,
        refTopOffset + (yPercent / 100) * refHeight
      );
    }, 350);
  }

  /** Put the thread popover beside a marker at container-relative coordinates. */
  private placeThreadNear(container: HTMLElement, containerX: number, containerY: number): void {
    const rect = container.getBoundingClientRect();
    const markerX = rect.left + containerX - container.scrollLeft;
    const markerY = rect.top + containerY - container.scrollTop;

    let x = markerX + 20;
    let y = markerY - 20;
    if (x + 340 > window.innerWidth) x = markerX - 360;
    if (y + 300 > window.innerHeight) y = window.innerHeight - 320;
    if (y < 10) y = 10;

    this.threadPosX.set(x);
    this.threadPosY.set(y);
  }

  closeThread(): void {
    this.activeAnnotationId.set(null);
  }

  // --- CRUD ---

  confirmName(): void {
    const name = this.authorNameInput.trim();
    if (!name) return;
    this.authorName.set(name);
    const token = this.shareToken();
    if (token) localStorage.setItem(`dv-author-${token}`, name);
  }

  submitNewAnnotation(): void {
    const text = this.newAnnotationText.trim();
    const na = this.newAnnotation();
    if (!text || !na) return;

    const request: CreateAnnotationRequest = {
      body: text,
      anchor: na.anchor,
      authorName: this.authorName(),
      docHash: this.docHash()
    };

    const token = this.shareToken();
    const obs = token
      ? this.annotationsService.createPublicAnnotation(token, this.filePath(), request)
      : this.annotationsService.createAnnotation(this.spaceId(), this.filePath(), request);

    obs.subscribe({
      next: () => {
        this.cancelNewAnnotation();
        this.loadAnnotations();
      },
      error: () => this.toastService.show('error', 'Error', 'Failed to create annotation.')
    });
  }

  cancelNewAnnotation(): void {
    if (this.newAnnotation() && this.renderMode() === 'html') {
      this.sendToIframe({ source: 'docuvault-annotations', type: 'clear-placement-dot' });
    }
    this.newAnnotation.set(null);
    this.newAnnotationText = '';
  }

  onReply(text: string): void {
    const active = this.activeAnnotation();
    if (!active) return;

    const request: CreateAnnotationRequest = {
      body: text,
      parentId: active.id,
      authorName: this.authorName()
    };

    const token = this.shareToken();
    const obs = token
      ? this.annotationsService.createPublicAnnotation(token, this.filePath(), request)
      : this.annotationsService.createAnnotation(this.spaceId(), this.filePath(), request);

    obs.subscribe({
      next: () => this.loadAnnotations(),
      error: () => this.toastService.show('error', 'Error', 'Failed to post reply.')
    });
  }

  onResolve(annotationId: string): void {
    const token = this.shareToken();
    const obs = token
      ? this.annotationsService.togglePublicResolve(token, annotationId)
      : this.annotationsService.toggleResolve(this.spaceId(), annotationId);

    obs.subscribe({
      next: () => this.loadAnnotations(),
      error: () => this.toastService.show('error', 'Error', 'Failed to update annotation.')
    });
  }

  onDelete(annotationId: string): void {
    const token = this.shareToken();
    const obs = token
      ? this.annotationsService.deletePublicAnnotation(token, annotationId)
      : this.annotationsService.deleteAnnotation(this.spaceId(), annotationId);

    obs.subscribe({
      next: () => {
        if (this.activeAnnotationId() === annotationId) this.closeThread();
        this.loadAnnotations();
      },
      error: () => this.toastService.show('error', 'Error', 'Failed to delete annotation.')
    });
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}
