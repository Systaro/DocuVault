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
import { RenderMode } from '../utils/file-utils';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-annotation-overlay',
  standalone: true,
  imports: [CommonModule, FormsModule, AnnotationMarkerComponent, AnnotationThreadComponent],
  template: `
    <!-- Click-capture layer: only active in comment mode, hidden when thread/popover is open -->
    @if (annotationMode() && !activeAnnotation() && !newAnnotation()) {
      <div class="annotation-click-layer" (click)="onLayerClick($event)"></div>
    }

    <!-- Markers (skip for html mode — iframe renders its own markers) -->
    @if (renderMode() !== 'html') {
      @for (a of annotations(); track a.id; let i = $index) {
        @if (a.anchor) {
          <app-annotation-marker
            [x]="a.anchor.xPercent"
            [y]="a.anchor.yPercent"
            [index]="i + 1"
            [resolved]="a.resolved"
            [active]="activeAnnotationId() === a.id"
            (markerClick)="openThread(a, $event)"
          />
        }
      }
    }

    <!-- Floating toolbar — Figma-style bottom pill -->
    <div class="annotation-fab" [class.has-annotations]="annotations().length > 0">
      @if (canComment()) {
        <button class="fab-btn" [class.active]="annotationMode()"
                (click)="toggleAnnotationMode()" [title]="annotationMode() ? 'Exit comment mode (Esc)' : 'Add comment'">
          <span class="material-icons">{{ annotationMode() ? 'close' : 'add_comment' }}</span>
          @if (annotationMode()) {
            <span class="fab-label">Click to place comment</span>
          }
        </button>
      }
      @if (annotations().length > 0) {
        <div class="fab-divider"></div>
        <button class="fab-btn" [class.active]="showList()"
                (click)="showList.set(!showList())" title="View all comments">
          <span class="material-icons">chat_bubble_outline</span>
          <span class="fab-badge">{{ annotations().length }}</span>
        </button>
      }
    </div>

    <!-- Thread popover -->
    @if (activeAnnotation(); as active) {
      <app-annotation-thread
        [annotation]="active"
        [permission]="permission()"
        [currentUserId]="currentUserId()"
        [posX]="threadPosX()"
        [posY]="threadPosY()"
        (close)="closeThread()"
        (reply)="onReply($event)"
        (resolve)="onResolve($event)"
        (remove)="onDelete($event)"
      />
    }

    <!-- Yellow dot at click position during creation -->
    @if (newAnnotation(); as na) {
      <div class="annotation-placement-dot"
           [style.left.%]="na.anchor.xPercent"
           [style.top.%]="na.anchor.yPercent"></div>
    }

    <!-- New annotation form -->
    @if (newAnnotation(); as na) {
      <div class="new-annotation-popover" [style.left.px]="na.screenX" [style.top.px]="na.screenY"
           (click)="$event.stopPropagation()">
        @if (requiresName() && !authorName()) {
          <input class="annotation-name-input" [(ngModel)]="authorNameInput" placeholder="Your name..."
                 (keydown.enter)="confirmName()" autofocus />
          <button class="annotation-name-btn" [disabled]="!authorNameInput.trim()" (click)="confirmName()">
            <span class="material-icons">arrow_forward</span>
          </button>
        } @else {
          <textarea class="annotation-input" [(ngModel)]="newAnnotationText" placeholder="Add a comment..."
                    rows="3" (keydown.meta.Enter)="submitNewAnnotation()"
                    (keydown.control.Enter)="submitNewAnnotation()"
                    (keydown.escape)="cancelNewAnnotation()" autofocus></textarea>
          <div class="new-annotation-actions">
            <button class="btn-cancel" (click)="cancelNewAnnotation()">Cancel</button>
            <button class="btn-submit" [disabled]="!newAnnotationText.trim()" (click)="submitNewAnnotation()">
              <span class="material-icons">send</span> Comment
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
              <span class="material-icons">close</span>
            </button>
          </div>
          @for (a of annotations(); track a.id; let i = $index) {
            <div class="list-item" [class.resolved]="a.resolved" (click)="openThreadFromList(a)">
              <span class="list-index" [class.resolved]="a.resolved">{{ i + 1 }}</span>
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
        </div>
    }
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
    app-annotation-overlay {
      display: contents;
    }

    /* Full-area click layer for comment placement */
    .annotation-click-layer {
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
      background: var(--primary, #6fb3b8);
      color: #fff;
    }

    .fab-btn.active .fab-badge {
      background: rgba(255, 255, 255, 0.3);
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

  // State
  annotations = signal<Annotation[]>([]);
  annotationMode = signal(false);
  activeAnnotationId = signal<string | null>(null);
  showList = signal(false);
  threadPosX = signal(0);
  threadPosY = signal(0);
  newAnnotation = signal<{ anchor: AnnotationAnchor; screenX: number; screenY: number } | null>(null);
  newAnnotationText = '';
  authorNameInput = '';
  authorName = signal<string | null>(null);

  // Computed
  activeAnnotation = computed(() => {
    const id = this.activeAnnotationId();
    return id ? this.annotations().find(a => a.id === id) ?? null : null;
  });

  unresolvedCount = computed(() => this.annotations().filter(a => !a.resolved).length);

  requiresName = computed(() => this.shareToken() !== null);

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
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    window.removeEventListener('message', this.boundMessageHandler);
    document.removeEventListener('mousedown', this.boundDocClick);
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
    if (!this.canComment()) return;

    const target = event.target as HTMLElement;
    if (target.closest('.annotation-pin, .annotation-thread, .new-annotation-popover, .annotation-fab, .annotation-list')) return;

    const container = this.elRef.nativeElement.parentElement as HTMLElement;
    const rect = container.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top + container.scrollTop) / container.scrollHeight) * 100;

    let snippet: string | undefined;
    if (this.renderMode() === 'markdown') {
      // Temporarily disable pointer-events on the click layer to peek at content below
      const layer = (this.elRef.nativeElement.parentElement as HTMLElement)?.querySelector('.annotation-click-layer') as HTMLElement;
      if (layer) layer.style.pointerEvents = 'none';
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (layer) layer.style.pointerEvents = '';
      if (el && el.textContent) {
        snippet = el.textContent.substring(0, 40).trim();
      }
    }

    const anchor: AnnotationAnchor = {
      type: this.renderMode() as AnnotationAnchor['type'],
      xPercent,
      yPercent,
      snippet
    };

    this.closeThread();
    this.newAnnotation.set({ anchor, screenX: event.clientX + 16, screenY: event.clientY });
  }

  canComment(): boolean {
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
    const data = event.data;
    if (!data || data.source !== 'docuvault-annotations') return;

    if (data.type === 'ready') {
      this.iframeReady = true;
      this.sendMarkersToIframe();
      if (this.canComment()) {
        this.sendToIframe({ source: 'docuvault-annotations', type: 'enable-click-capture' });
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

    if (data.type === 'click-position' && this.annotationMode() && this.canComment()) {
      const anchor: AnnotationAnchor = {
        type: 'html',
        xPercent: data.xPercent,
        yPercent: data.yPercent,
        elementId: data.elementId || undefined,
        selector: data.selector || undefined
      };

      this.closeThread();
      const iframe = this.getIframeElement();
      const screenX = iframe ? iframe.getBoundingClientRect().left + iframe.clientWidth / 2 : window.innerWidth / 2;
      const screenY = iframe ? iframe.getBoundingClientRect().top + 60 : window.innerHeight * 0.3;
      this.newAnnotation.set({ anchor, screenX, screenY });
    }
  }

  private sendMarkersToIframe(): void {
    if (this.renderMode() !== 'html' || !this.iframeReady) return;

    const markerData = this.annotations().map((a, i) => ({
      id: a.id,
      index: i + 1,
      xPercent: a.anchor?.xPercent ?? 50,
      yPercent: a.anchor?.yPercent ?? 50,
      elementId: a.anchor?.elementId,
      selector: a.anchor?.selector,
      offsetX: a.anchor?.offsetX,
      offsetY: a.anchor?.offsetY,
      resolved: a.resolved
    }));

    this.sendToIframe({
      source: 'docuvault-annotations',
      type: 'render-markers',
      annotations: markerData
    });
  }

  private sendToIframe(message: any): void {
    const iframe = this.getIframeElement();
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(message, '*');
    }
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
      },
      error: () => {}
    });
  }

  // --- Thread interactions ---

  openThread(annotation: Annotation, event: MouseEvent): void {
    event.stopPropagation();
    this.activeAnnotationId.set(annotation.id);
    this.cancelNewAnnotation();

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

  openThreadFromList(annotation: Annotation): void {
    this.showList.set(false);
    this.activeAnnotationId.set(annotation.id);

    if (!annotation.anchor) {
      this.threadPosX.set(Math.max(20, (window.innerWidth - 340) / 2));
      this.threadPosY.set(Math.max(20, window.innerHeight * 0.2));
      return;
    }

    const container = this.elRef.nativeElement.parentElement as HTMLElement;
    if (!container) return;

    // Scroll the container so the annotation's y position is visible
    const targetScrollTop = (annotation.anchor.yPercent / 100) * container.scrollHeight - container.clientHeight / 3;
    container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });

    // Position the thread popover near the marker after scroll settles
    setTimeout(() => {
      const rect = container.getBoundingClientRect();
      const markerX = rect.left + (annotation.anchor!.xPercent / 100) * rect.width;
      const markerY = rect.top + (annotation.anchor!.yPercent / 100) * container.scrollHeight - container.scrollTop;

      let x = markerX + 20;
      let y = markerY - 20;
      if (x + 340 > window.innerWidth) x = markerX - 360;
      if (y + 300 > window.innerHeight) y = window.innerHeight - 320;
      if (y < 10) y = 10;

      this.threadPosX.set(x);
      this.threadPosY.set(y);
    }, 350);
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
      authorName: this.authorName()
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
