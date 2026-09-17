import { Component, signal, computed, ElementRef, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationsService, NotificationFeedItem } from '../../core/api/notifications.service';
import { Subject, interval, startWith, switchMap, takeUntil } from 'rxjs';

interface SpaceGroup {
  spaceName: string;
  spaceFullPath: string;
  items: NotificationFeedItem[];
}

/**
 * Header bell with an in-app change feed — the same document changes the
 * digest emails report, grouped per space, with an unseen-count badge.
 */
@Component({
  selector: 'app-header-notifications',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="notifications">
      <button class="icon-btn" title="Notifications" (click)="toggle()">
        <span translate="no" class="material-icons">notifications</span>
        @if (unseenCount() > 0) {
          <span class="badge">{{ unseenCount() > 99 ? '99+' : unseenCount() }}</span>
        }
      </button>

      @if (open()) {
        <div class="feed-dropdown">
          <div class="feed-header">
            <span class="feed-title">Notifications</span>
            @if (unseenCount() > 0) {
              <span class="feed-subtitle">{{ unseenCount() }} new</span>
            }
          </div>

          @if (loading()) {
            <div class="feed-status">
              <span translate="no" class="material-icons spin">sync</span>
              Loading...
            </div>
          } @else if (groups().length === 0) {
            <div class="feed-status">
              <span translate="no" class="material-icons">notifications_none</span>
              No recent changes
            </div>
          } @else {
            <div class="feed-list">
              @for (group of groups(); track group.spaceFullPath) {
                <div class="feed-group">
                  <div class="group-header">
                    <span class="group-space">{{ group.spaceName }}</span>
                    <span class="group-count">{{ group.items.length }} {{ group.items.length === 1 ? 'update' : 'updates' }}</span>
                  </div>
                  @for (item of group.items; track item.id) {
                    <button class="feed-item" [class.unseen]="item.unseen" (click)="openItem(item)">
                      <span translate="no" class="material-icons change-icon" [class]="'change-' + item.changeType.toLowerCase()">
                        {{ changeIcon(item.changeType) }}
                      </span>
                      <span class="item-body">
                        <span class="item-file">{{ item.changeType === 'TASK_ASSIGNED' ? item.filePath : fileName(item.filePath) }}</span>
                        <span class="item-meta">
                          {{ changeLabel(item.changeType) }}
                          @if (item.authorName) { <span>by {{ item.authorName }}</span> }
                          · {{ relativeTime(item.detectedAt) }}
                        </span>
                      </span>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .notifications {
      position: relative;
      display: flex;
    }

    .icon-btn {
      position: relative;
    }

    .badge {
      position: absolute;
      top: -2px;
      right: -4px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ef4444;
      color: white;
      font-size: 10px;
      font-weight: 700;
      border-radius: 8px;
      line-height: 1;
    }

    .feed-dropdown {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: 400px;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      z-index: 200;
      overflow: hidden;
    }

    .feed-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .feed-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .feed-subtitle {
      font-size: 12px;
      font-weight: 600;
      color: var(--primary);
    }

    .feed-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 28px;
      color: var(--text-secondary);
      font-size: 13px;

      .material-icons { font-size: 20px; }
    }

    .spin { animation: spin 1s linear infinite; }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .feed-list {
      overflow-y: auto;
      padding: 6px;
    }

    .feed-group {
      &:not(:last-child) {
        margin-bottom: 4px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--border);
      }
    }

    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px 4px;
    }

    .group-space {
      font-size: 12px;
      font-weight: 600;
      color: var(--primary);
    }

    .group-count {
      font-size: 11px;
      color: var(--text-secondary);
    }

    .feed-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      border-radius: var(--radius-md);
      color: var(--text-primary);

      &:hover { background: var(--background); }

      &.unseen .item-file { font-weight: 600; }
    }

    .change-icon {
      flex-shrink: 0;
      font-size: 17px;

      &.change-added { color: #10b981; }
      &.change-modified { color: var(--primary); }
      &.change-deleted { color: #ef4444; }
      &.change-renamed { color: #f59e0b; }
    }

    .item-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .item-file {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-meta {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `]
})
export class HeaderNotificationsComponent implements OnInit, OnDestroy {
  open = signal(false);
  loading = signal(false);
  unseenCount = signal(0);
  items = signal<NotificationFeedItem[]>([]);

  groups = computed<SpaceGroup[]>(() => {
    const bySpace = new Map<string, SpaceGroup>();
    for (const item of this.items()) {
      let group = bySpace.get(item.spaceFullPath);
      if (!group) {
        group = { spaceName: item.spaceName, spaceFullPath: item.spaceFullPath, items: [] };
        bySpace.set(item.spaceFullPath, group);
      }
      group.items.push(item);
    }
    return [...bySpace.values()];
  });

  private destroy$ = new Subject<void>();

  constructor(
    private notificationsService: NotificationsService,
    private router: Router,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    // Refresh the badge every 2 minutes so new changes surface without a reload.
    interval(120_000).pipe(
      startWith(0),
      switchMap(() => this.notificationsService.getFeed()),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (feed) => {
        this.items.set(feed.items);
        this.unseenCount.set(feed.unseenCount);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.loading.set(this.items().length === 0);
      this.notificationsService.getFeed().subscribe({
        next: (feed) => {
          this.items.set(feed.items);
          this.loading.set(false);
          // Opening the panel counts as "seen": clear the badge server-side,
          // but keep the per-item unseen highlight for this render.
          if (feed.unseenCount > 0) {
            this.notificationsService.markSeen().subscribe({
              next: () => this.unseenCount.set(0)
            });
          }
        },
        error: () => this.loading.set(false)
      });
    }
  }

  openItem(item: NotificationFeedItem): void {
    this.open.set(false);
    if (item.changeType === 'TASK_ASSIGNED') {
      this.router.navigate(['/tasks']);
      return;
    }
    if (item.changeType === 'DELETED') {
      this.router.navigate(['/spaces', ...item.spaceFullPath.split('/')]);
      return;
    }
    this.router.navigate(
      ['/spaces', ...item.spaceFullPath.split('/'), 'doc'],
      { queryParams: { path: item.filePath } }
    );
  }

  fileName(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  changeIcon(type: string): string {
    switch (type) {
      case 'ADDED': return 'add_circle';
      case 'DELETED': return 'remove_circle';
      case 'RENAMED': return 'drive_file_rename_outline';
      case 'TASK_ASSIGNED': return 'task_alt';
      default: return 'edit';
    }
  }

  changeLabel(type: string): string {
    switch (type) {
      case 'ADDED': return 'added';
      case 'DELETED': return 'deleted';
      case 'RENAMED': return 'renamed';
      case 'TASK_ASSIGNED': return 'assigned to you';
      default: return 'modified';
    }
  }

  relativeTime(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }
}
