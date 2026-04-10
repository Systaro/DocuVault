import { Component, input, output, signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Annotation, AnnotationPermission } from '../../core/api/annotations.service';

@Component({
  selector: 'app-annotation-thread',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="annotation-thread" [style.left.px]="posX()" [style.top.px]="posY()"
         (click)="$event.stopPropagation()">
      <div class="thread-header">
        <div class="thread-author">
          <span class="author-avatar">{{ annotation().authorName.charAt(0).toUpperCase() }}</span>
          <div class="author-info">
            <span class="author-name">{{ annotation().authorName }}</span>
            <span class="author-date">{{ formatDate(annotation().createdAt) }}</span>
          </div>
        </div>
        <div class="thread-actions">
          @if (canResolve()) {
            <button class="thread-btn" [class.resolved]="annotation().resolved"
                    (click)="resolve.emit(annotation().id)" [title]="annotation().resolved ? 'Reopen' : 'Resolve'">
              <span class="material-icons">{{ annotation().resolved ? 'check_circle' : 'check_circle_outline' }}</span>
            </button>
          }
          @if (canDelete(annotation())) {
            <button class="thread-btn danger" (click)="remove.emit(annotation().id)" title="Delete">
              <span class="material-icons">delete_outline</span>
            </button>
          }
          <button class="thread-btn" (click)="close.emit()" title="Close">
            <span class="material-icons">close</span>
          </button>
        </div>
      </div>

      <div class="thread-body">{{ annotation().body }}</div>

      @if (annotation().resolved) {
        <div class="resolved-badge">
          <span class="material-icons">check_circle</span>
          Resolved{{ annotation().resolvedByName ? ' by ' + annotation().resolvedByName : '' }}
        </div>
      }

      @if (annotation().replies.length > 0) {
        <div class="thread-replies">
          @for (reply of annotation().replies; track reply.id) {
            <div class="reply">
              <div class="reply-header">
                <span class="reply-avatar">{{ reply.authorName.charAt(0).toUpperCase() }}</span>
                <span class="reply-author">{{ reply.authorName }}</span>
                <span class="reply-date">{{ formatDate(reply.createdAt) }}</span>
                @if (canDelete(reply)) {
                  <button class="thread-btn small danger" (click)="remove.emit(reply.id)" title="Delete reply">
                    <span class="material-icons">close</span>
                  </button>
                }
              </div>
              <div class="reply-body">{{ reply.body }}</div>
            </div>
          }
        </div>
      }

      @if (canComment()) {
        <div class="thread-reply-box">
          <textarea
            class="reply-input"
            [(ngModel)]="replyText"
            placeholder="Write a reply..."
            rows="2"
            (keydown.meta.Enter)="submitReply()"
            (keydown.control.Enter)="submitReply()"
          ></textarea>
          <button class="reply-submit" [disabled]="!replyText.trim()" (click)="submitReply()">
            <span class="material-icons">send</span>
          </button>
        </div>
      }
    </div>
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
    .annotation-thread {
      position: fixed;
      width: 320px;
      max-height: 420px;
      overflow-y: auto;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #d4e5e7);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-xl, 0 20px 40px rgba(0, 0, 0, 0.15));
      z-index: 200;
      display: flex;
      flex-direction: column;
    }

    .thread-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px 8px;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }

    .thread-author {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .author-avatar, .reply-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #f59e0b;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 13px;
      flex-shrink: 0;
    }

    .reply-avatar {
      width: 22px;
      height: 22px;
      font-size: 11px;
    }

    .author-info {
      display: flex;
      flex-direction: column;
    }

    .author-name, .reply-author {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary, #1a2e30);
    }

    .author-date, .reply-date {
      font-size: 11px;
      color: var(--text-muted, #7a9a9d);
    }

    .thread-actions {
      display: flex;
      gap: 2px;
    }

    .thread-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--text-muted, #7a9a9d);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .thread-btn .material-icons { font-size: 18px; }

    .thread-btn:hover { background: #f3f4f6; color: var(--text-primary, #374151); }

    .thread-btn.resolved { color: #10b981; }

    .thread-btn.danger:hover { background: #fef2f2; color: #ef4444; }

    .thread-btn.small {
      width: 22px;
      height: 22px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .thread-btn.small .material-icons { font-size: 14px; }

    .reply:hover .thread-btn.small { opacity: 1; }

    .thread-body {
      padding: 10px 14px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-primary, #1a2e30);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .resolved-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 12px;
      color: #10b981;
      background: #ecfdf5;
      border-top: 1px solid #d1fae5;
    }

    .resolved-badge .material-icons { font-size: 16px; }

    .thread-replies {
      border-top: 1px solid var(--border, #e5e7eb);
    }

    .reply {
      padding: 8px 14px;
      border-bottom: 1px solid var(--border, #f0f0f0);
    }

    .reply:last-child { border-bottom: none; }

    .reply-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .reply-date { margin-left: auto; }

    .reply-body {
      padding: 4px 0 0 28px;
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-primary, #1a2e30);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .thread-reply-box {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--border, #e5e7eb);
      align-items: flex-end;
    }

    .reply-input {
      flex: 1;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      outline: none;
      background: var(--background, #f6f6f2);
      color: var(--text-primary, #1a2e30);
      transition: border-color 0.15s;
    }

    .reply-input:focus {
      border-color: #f59e0b;
    }

    .reply-submit {
      width: 34px;
      height: 34px;
      border: none;
      border-radius: 8px;
      background: #f59e0b;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .reply-submit:hover { background: #d97706; }
    .reply-submit:disabled { opacity: 0.5; cursor: default; }
    .reply-submit .material-icons { font-size: 18px; }
  `]
})
export class AnnotationThreadComponent {
  annotation = input.required<Annotation>();
  permission = input.required<AnnotationPermission>();
  currentUserId = input<string | null>(null);
  posX = input<number>(0);
  posY = input<number>(0);

  close = output<void>();
  reply = output<string>();
  resolve = output<string>();
  remove = output<string>();

  replyText = '';

  canComment(): boolean {
    const p = this.permission();
    return p === 'COMMENT' || p === 'EDIT' || p === 'ADMIN';
  }

  canResolve(): boolean {
    const p = this.permission();
    if (p === 'EDIT' || p === 'ADMIN') return true;
    if (p === 'COMMENT') {
      const a = this.annotation();
      return a.userId === this.currentUserId() || a.userId === null;
    }
    return false;
  }

  canDelete(a: Annotation): boolean {
    const p = this.permission();
    if (p === 'ADMIN') return true;
    if (p === 'EDIT' || p === 'COMMENT') {
      return a.userId === this.currentUserId() || a.userId === null;
    }
    return false;
  }

  submitReply(): void {
    const text = this.replyText.trim();
    if (!text) return;
    this.reply.emit(text);
    this.replyText = '';
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
