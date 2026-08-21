import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Space } from '../../core/api/spaces.service';
import { SearchableSelectComponent, SelectOption } from './searchable-select.component';

/** A grant the subject already has from somewhere else (e.g. a team they're in). */
export interface InheritedGrant {
  level: string;
  source: string;
}

/**
 * Space tree with a permission select per repository and bulk actions per group.
 * Shared by the user editor and the team editor so both stay in sync.
 */
@Component({
  selector: 'app-space-permission-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    @if (loading) {
      <div class="loading-permissions">
        <span translate="no" class="material-icons animate-spin">sync</span>
        Loading...
      </div>
    } @else {
      <div class="permissions-list">
        @for (space of spaces; track space.id) {
          <div class="permission-row"
               [class.has-permission]="space.type === 'GROUP' ? getGroupAccessStatus(space) !== 'none' : !!getPermission(space.id)"
               [class.is-group]="space.type === 'GROUP'"
               [style.padding-left.px]="getIndent(space)">
            <div class="permission-space">
              <span translate="no" class="material-icons space-icon">
                {{ space.type === 'GROUP' ? 'folder' : 'description' }}
              </span>
              <span class="space-name">{{ space.name }}</span>
              <span class="space-path">{{ space.fullPath }}</span>
              @for (grant of inheritedFor(space.id); track grant.source) {
                <span class="inherited-chip" [title]="'Inherited from ' + grant.source">
                  <span translate="no" class="material-icons">groups</span>
                  {{ grant.source }} · {{ formatLevel(grant.level) }}
                </span>
              }
            </div>
            <div class="permission-control">
              @if (space.type === 'GROUP') {
                <div class="group-access-control">
                  <span class="group-access-badge badge-{{ getGroupAccessStatus(space) }}">
                    {{ groupBadgeLabel(space) }}
                  </span>
                  <button type="button" class="btn-bulk btn-bulk-edit" (click)="setAllChildren(space, 'EDIT')">Edit all</button>
                  <button type="button" class="btn-bulk btn-bulk-clear" (click)="setAllChildren(space, '')">Clear</button>
                </div>
              } @else {
                <app-searchable-select
                  class="permission-select"
                  [options]="permissionLevelOptions"
                  [ngModel]="getPermission(space.id)"
                  (ngModelChange)="setPermission(space.id, $event)"
                  [searchable]="false"
                />
              }
            </div>
          </div>
        } @empty {
          <div class="no-spaces">No spaces available</div>
        }
      </div>
    }
  `,
  styles: [`
    .loading-permissions {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-lg);
      justify-content: center;
      color: var(--text-muted);
      font-size: 14px;
    }

    .permissions-list {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      max-height: 340px;
      overflow-y: auto;
    }

    .permission-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-light);
      transition: background var(--transition);

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: var(--background);
      }

      &.has-permission {
        background: rgba(111, 179, 184, 0.06);
      }
    }

    .permission-space {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }

    .space-icon {
      font-size: 18px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .space-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .space-path {
      font-size: 12px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inherited-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      background: rgba(33, 150, 243, 0.12);
      color: #1976d2;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;

      .material-icons {
        font-size: 13px;
      }
    }

    .permission-control {
      flex-shrink: 0;
      margin-left: var(--spacing-md);
    }

    app-searchable-select.permission-select {
      width: 140px;
    }

    .is-group {
      background: var(--surface-raised, rgba(0, 0, 0, 0.02));
    }

    .group-access-control {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .group-access-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      min-width: 54px;
      text-align: center;

      &.badge-none {
        background: var(--surface-raised, #f0f0f0);
        color: var(--text-muted);
      }

      &.badge-partial {
        background: #fff3cd;
        color: #7a5c00;
      }

      &.badge-all {
        background: #d4edda;
        color: #155724;
      }
    }

    .btn-bulk {
      font-size: 12px;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      cursor: pointer;
      background: var(--surface);
      color: var(--text-secondary);

      &:hover {
        background: var(--surface-raised);
      }
    }

    .btn-bulk-edit {
      color: var(--primary);
      border-color: var(--primary);

      &:hover {
        background: rgba(var(--primary-rgb, 0, 120, 212), 0.06);
      }
    }

    .btn-bulk-clear {
      color: var(--text-muted);

      &:hover {
        color: var(--danger, #dc3545);
        border-color: var(--danger, #dc3545);
      }
    }

    .no-spaces {
      padding: var(--spacing-lg);
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `]
})
export class SpacePermissionPickerComponent {
  /** Flat space list, expected pre-sorted by fullPath. */
  @Input() spaces: Space[] = [];

  /** spaceId -> permission level. Mutated in place and re-emitted on change. */
  @Input() permissions: Record<string, string> = {};
  @Output() permissionsChange = new EventEmitter<Record<string, string>>();

  /** spaceId -> grants the subject already holds elsewhere, shown as read-only chips. */
  @Input() inherited: Record<string, InheritedGrant[]> = {};

  @Input() loading = false;

  readonly permissionLevelOptions: SelectOption[] = [
    { value: '', label: 'No access' },
    { value: 'VIEW', label: 'View' },
    { value: 'EDIT', label: 'Edit' },
    { value: 'ADMIN', label: 'Admin' }
  ];

  getPermission(spaceId: string): string {
    return this.permissions[spaceId] || '';
  }

  setPermission(spaceId: string, level: string): void {
    if (level) {
      this.permissions[spaceId] = level;
    } else {
      delete this.permissions[spaceId];
    }
    this.permissionsChange.emit(this.permissions);
  }

  inheritedFor(spaceId: string): InheritedGrant[] {
    return this.inherited[spaceId] || [];
  }

  formatLevel(level: string): string {
    return level.charAt(0) + level.slice(1).toLowerCase();
  }

  getIndent(space: Space): number {
    const depth = (space.fullPath.match(/\//g) || []).length;
    return 12 + depth * 20;
  }

  groupBadgeLabel(group: Space): string {
    const status = this.getGroupAccessStatus(group);
    return status === 'all' ? 'All' : status === 'partial' ? 'Partial' : '—';
  }

  getGroupAccessStatus(group: Space): 'all' | 'partial' | 'none' {
    const repos = this.getDescendantRepos(group);
    if (repos.length === 0) return 'none';
    const withAccess = repos.filter(r => !!this.permissions[r.id]);
    if (withAccess.length === 0) return 'none';
    if (withAccess.length === repos.length) return 'all';
    return 'partial';
  }

  setAllChildren(group: Space, level: string): void {
    for (const repo of this.getDescendantRepos(group)) {
      if (level) {
        this.permissions[repo.id] = level;
      } else {
        delete this.permissions[repo.id];
      }
    }
    this.permissionsChange.emit(this.permissions);
  }

  private getDescendantRepos(group: Space): Space[] {
    const result: Space[] = [];
    for (const child of this.spaces.filter(s => s.parentId === group.id)) {
      if (child.type === 'GROUP') {
        result.push(...this.getDescendantRepos(child));
      } else {
        result.push(child);
      }
    }
    return result;
  }
}
