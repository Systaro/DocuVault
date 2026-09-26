import { Component, input, output, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, filter } from 'rxjs/operators';
import { SpacesService, SpacePermission } from '../../core/api/spaces.service';
import { UsersService, UserSearchResult } from '../../core/api/users.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../services/toast.service';
import { SearchableSelectComponent, SelectOption } from './searchable-select.component';

@Component({
  selector: 'app-quick-share-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="share-dialog" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="share-header">
          <h2>Share {{ spaceName() }}</h2>
          <button class="icon-btn" (click)="close.emit()">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>

        <!-- Search / Add User -->
        <div class="share-body">
          <div class="search-section">
            <div class="search-row">
              <div class="search-input-wrapper">
                <span translate="no" class="material-icons search-icon">search</span>
                <input
                  type="text"
                  class="input search-input"
                  placeholder="Search users by name or email..."
                  [ngModel]="searchQuery()"
                  (ngModelChange)="onSearchChange($event)"
                  (focus)="showResults.set(true)"
                />
              </div>
            </div>

            <!-- Search Results Dropdown -->
            @if (showResults() && searchQuery().length >= 2) {
              <div class="search-results">
                @if (searching()) {
                  <div class="search-status">
                    <span translate="no" class="material-icons animate-spin">sync</span>
                    Searching...
                  </div>
                } @else if (searchResults().length > 0) {
                  @for (user of searchResults(); track user.id) {
                    <div class="search-result-item">
                      <div class="user-avatar">{{ user.name.charAt(0).toUpperCase() }}</div>
                      <div class="user-info">
                        <div class="user-name">{{ user.name }}</div>
                        <div class="user-email">{{ user.email }}</div>
                      </div>
                      <app-searchable-select
                        class="permission-select"
                        [options]="permissionLevelOptions"
                        [(ngModel)]="addPermissionLevel"
                        [searchable]="false"
                      />
                      <button class="btn btn-sm btn-primary" (click)="addUser(user)">
                        <span translate="no" class="material-icons">person_add</span>
                      </button>
                    </div>
                  }
                } @else {
                  <div class="search-status">
                    <span translate="no" class="material-icons">person_off</span>
                    No users found
                  </div>
                  @if (authService.isAdmin() && isValidEmail(searchQuery())) {
                    <button class="invite-option" (click)="inviteByEmail(searchQuery())">
                      <span translate="no" class="material-icons">mail</span>
                      Invite "{{ searchQuery() }}" via email
                    </button>
                  }
                }
              </div>
            }
          </div>

          <!-- Invite by Email (admin only, when search is empty) -->
          @if (authService.isAdmin() && searchQuery().length === 0) {
            <div class="invite-section">
              <div class="section-label">Invite via email</div>
              <div class="invite-row">
                <div class="search-input-wrapper">
                  <span translate="no" class="material-icons search-icon">mail</span>
                  <input
                    type="email"
                    class="input search-input"
                    placeholder="Enter email address..."
                    [(ngModel)]="inviteEmail"
                  />
                </div>
                <button
                  class="btn btn-sm btn-primary"
                  [disabled]="!isValidEmail(inviteEmail) || inviting()"
                  (click)="inviteByEmail(inviteEmail)"
                >
                  @if (inviting()) {
                    <span translate="no" class="material-icons animate-spin">sync</span>
                  } @else {
                    <span translate="no" class="material-icons">send</span>
                    Send
                  }
                </button>
              </div>
            </div>
          }

          <!-- Current Members -->
          <div class="members-section">
            <div class="section-label">
              Members
              @if (loading()) {
                <span translate="no" class="material-icons animate-spin loading-icon">sync</span>
              }
            </div>
            @if (permissions().length === 0 && !loading()) {
              <div class="empty-members">
                <span translate="no" class="material-icons">group_off</span>
                <p>No members added yet</p>
              </div>
            } @else {
              @for (perm of permissions(); track perm.id) {
                <div class="member-row">
                  <div class="user-avatar">{{ perm.userName.charAt(0).toUpperCase() }}</div>
                  <div class="user-info">
                    <div class="user-name">{{ perm.userName }}</div>
                    <div class="user-email">{{ perm.userEmail }}</div>
                  </div>
                  <app-searchable-select
                    class="permission-select"
                    [options]="permissionLevelOptions"
                    [ngModel]="perm.permissionLevel"
                    (ngModelChange)="updatePermission(perm.userId, $event)"
                    [searchable]="false"
                  />
                  <button class="icon-btn remove-btn" (click)="removeMember(perm.userId)" title="Remove access">
                    <span translate="no" class="material-icons">close</span>
                  </button>
                </div>
              }
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: var(--spacing-lg);
    }

    .share-dialog {
      background: var(--surface);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 520px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-xl);
    }

    .share-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }
    }

    .share-body {
      padding: var(--spacing-lg);
      overflow-y: auto;
      flex: 1;
    }

    .search-section {
      position: relative;
      margin-bottom: var(--spacing-lg);
    }

    .search-row {
      display: flex;
      gap: var(--spacing-sm);
    }

    .search-input-wrapper {
      position: relative;
      flex: 1;

      .search-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 18px;
        color: var(--text-muted);
      }

      .search-input {
        padding-left: 40px;
      }
    }

    .search-results {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      max-height: 240px;
      overflow-y: auto;
      z-index: 10;
      margin-top: var(--spacing-xs);
    }

    .search-result-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      transition: background var(--transition);

      &:hover {
        background: var(--bg-hover, rgba(0, 0, 0, 0.03));
      }
    }

    .search-status {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      color: var(--text-muted);
      font-size: 13px;

      .material-icons {
        font-size: 18px;
      }
    }

    .invite-option {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      border: none;
      background: none;
      cursor: pointer;
      font-size: 14px;
      color: var(--primary);
      text-align: left;
      transition: background var(--transition);

      &:hover {
        background: color-mix(in srgb, var(--primary) 8%, transparent);
      }

      .material-icons {
        font-size: 18px;
      }
    }

    .invite-section {
      margin-bottom: var(--spacing-lg);
    }

    .invite-row {
      display: flex;
      gap: var(--spacing-sm);
      align-items: center;
    }

    .section-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: var(--spacing-sm);
    }

    .loading-icon {
      font-size: 14px;
    }

    .members-section {
      border-top: 1px solid var(--border);
      padding-top: var(--spacing-lg);
    }

    .empty-members {
      text-align: center;
      padding: var(--spacing-lg);
      color: var(--text-muted);

      .material-icons {
        font-size: 32px;
        margin-bottom: var(--spacing-xs);
      }

      p {
        font-size: 13px;
        margin: 0;
      }
    }

    .member-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) 0;

      &:not(:last-child) {
        border-bottom: 1px solid var(--border-light);
      }
    }

    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
      flex-shrink: 0;
    }

    .user-info {
      flex: 1;
      min-width: 0;
    }

    .user-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-email {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    app-searchable-select.permission-select {
      flex-shrink: 0;
      width: 110px;
    }

    .remove-btn {
      flex-shrink: 0;
      color: var(--text-muted);

      .material-icons {
        font-size: 18px;
      }

      &:hover {
        color: var(--danger, #dc3545);
      }
    }

    .btn-sm {
      padding: 6px 10px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;

      .material-icons {
        font-size: 16px;
      }
    }
  `]
})
export class QuickShareDialogComponent implements OnInit, OnDestroy {
  spaceId = input.required<string>();
  spaceName = input.required<string>();
  close = output<void>();

  searchQuery = signal('');
  searchResults = signal<UserSearchResult[]>([]);
  permissions = signal<SpacePermission[]>([]);
  searching = signal(false);
  loading = signal(false);
  inviting = signal(false);
  showResults = signal(false);
  addPermissionLevel = 'READ';
  inviteEmail = '';

  readonly permissionLevelOptions: SelectOption[] = [
    { value: 'READ', label: 'Viewer' },
    { value: 'WRITE', label: 'Editor' },
    { value: 'ADMIN', label: 'Admin' }
  ];

  private search$ = new Subject<string>();
  private subscription = new Subscription();

  constructor(
    private spacesService: SpacesService,
    private usersService: UsersService,
    public authService: AuthService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.loadPermissions();

    const sub = this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(q => q.length >= 2),
      switchMap(q => {
        this.searching.set(true);
        return this.usersService.searchUsers(q);
      })
    ).subscribe({
      next: (results) => {
        const memberIds = new Set(this.permissions().map(p => p.userId));
        this.searchResults.set(results.filter(u => !memberIds.has(u.id)));
        this.searching.set(false);
      },
      error: () => this.searching.set(false)
    });
    this.subscription.add(sub);
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query);
    if (query.length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      return;
    }
    this.search$.next(query);
  }

  loadPermissions(): void {
    this.loading.set(true);
    this.spacesService.getPermissions(this.spaceId()).subscribe({
      next: (perms) => {
        this.permissions.set(perms);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  addUser(user: UserSearchResult): void {
    this.spacesService.addPermission(this.spaceId(), user.id, this.addPermissionLevel).subscribe({
      next: () => {
        this.toastService.success('User Added', `${user.name} now has access.`);
        this.loadPermissions();
        this.searchQuery.set('');
        this.searchResults.set([]);
        this.showResults.set(false);
      },
      error: () => this.toastService.error('Failed', 'Could not add user.')
    });
  }

  updatePermission(userId: string, level: string): void {
    this.spacesService.addPermission(this.spaceId(), userId, level).subscribe({
      next: () => this.toastService.success('Updated', 'Permission level changed.'),
      error: () => this.toastService.error('Failed', 'Could not update permission.')
    });
  }

  removeMember(userId: string): void {
    this.spacesService.removePermission(this.spaceId(), userId).subscribe({
      next: () => {
        this.toastService.success('Removed', 'User access removed.');
        this.loadPermissions();
      },
      error: () => this.toastService.error('Failed', 'Could not remove user.')
    });
  }

  inviteByEmail(email: string): void {
    this.inviting.set(true);
    this.usersService.inviteUser(email, this.spaceId()).subscribe({
      next: () => {
        this.toastService.success('Invitation Sent', `Invitation sent to ${email}.`);
        this.inviteEmail = '';
        this.searchQuery.set('');
        this.searchResults.set([]);
        this.showResults.set(false);
        this.inviting.set(false);
      },
      error: () => {
        this.toastService.error('Failed', 'Could not send invitation.');
        this.inviting.set(false);
      }
    });
  }

  isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
