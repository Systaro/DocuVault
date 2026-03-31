import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { UsersService, Invitation, UserPermission } from '../../core/api/users.service';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { AuthService, User } from '../../core/auth/auth.service';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="users-management">
      <div class="management-header">
        <div>
          <h1>User Management</h1>
          <p class="subtitle">Manage team members and their permissions</p>
        </div>
        <button (click)="showInviteModal.set(true)" class="btn btn-primary">
          <span class="material-icons">person_add</span>
          Invite User
        </button>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-card-icon">
            <span class="material-icons">group</span>
          </div>
          <div class="stat-value">{{ users().length }}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon active">
            <span class="material-icons">how_to_reg</span>
          </div>
          <div class="stat-value">{{ getAdminCount() }}</div>
          <div class="stat-label">Administrators</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon pending">
            <span class="material-icons">pending</span>
          </div>
          <div class="stat-value">{{ invitations().length }}</div>
          <div class="stat-label">Pending Invites</div>
        </div>
      </div>

      <!-- Users Table -->
      <div class="users-table-container">
        <div class="table-header">
          <h2>Team Members</h2>
          <div class="search-box">
            <span class="material-icons">search</span>
            <input
              type="text"
              [(ngModel)]="searchTerm"
              placeholder="Search users..."
            />
          </div>
        </div>

        <div class="table">
          <div class="table-head">
            <div class="table-row">
              <div class="table-cell user-col">User</div>
              <div class="table-cell role-col">Role</div>
              <div class="table-cell actions-col">Actions</div>
            </div>
          </div>
          <div class="table-body">
            @for (user of filteredUsers(); track user.id) {
              <div class="table-row" [class.disabled-user]="user.enabled === false">
                <div class="table-cell user-col">
                  <div class="user-avatar" [class.avatar-pending]="user.enabled === false">{{ getInitials(user.name) }}</div>
                  <div class="user-details">
                    <span class="user-name">
                      {{ user.name }}
                      @if (user.enabled === false) {
                        <span class="pending-tag">Invited</span>
                      }
                    </span>
                    <span class="user-email">{{ user.email }}</span>
                  </div>
                </div>
                <div class="table-cell role-col">
                  <span class="role-badge" [attr.data-role]="user.role.toLowerCase()">
                    {{ formatRole(user.role) }}
                  </span>
                </div>
                <div class="table-cell actions-col">
                  @if (authService.user()?.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN' && user.enabled !== false) {
                    <button class="icon-btn" (click)="impersonateUser(user)" title="Impersonate">
                      <span class="material-icons">swap_horiz</span>
                    </button>
                  }
                  <button class="icon-btn" (click)="editUser(user)" title="Edit & manage permissions">
                    <span class="material-icons">edit</span>
                  </button>
                  <button class="icon-btn" (click)="deleteUser(user)" title="Delete">
                    <span class="material-icons">delete</span>
                  </button>
                </div>
              </div>
            } @empty {
              <div class="table-empty">
                <span class="material-icons">group</span>
                <p>No users found</p>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Pending Invitations -->
      @if (invitations().length > 0) {
        <div class="users-table-container">
          <div class="table-header">
            <h2>Pending Invitations</h2>
          </div>
          <div class="table">
            <div class="table-head">
              <div class="table-row">
                <div class="table-cell email-col">Email</div>
                <div class="table-cell role-col">Role</div>
                <div class="table-cell date-col">Expires</div>
                <div class="table-cell status-col">Status</div>
                <div class="table-cell actions-col">Actions</div>
              </div>
            </div>
            <div class="table-body">
              @for (inv of invitations(); track inv.id) {
                <div class="table-row">
                  <div class="table-cell email-col">{{ inv.email }}</div>
                  <div class="table-cell role-col">
                    <span class="role-badge" [attr.data-role]="inv.role.toLowerCase()">
                      {{ formatRole(inv.role) }}
                    </span>
                  </div>
                  <div class="table-cell date-col">{{ formatDate(inv.expiresAt) }}</div>
                  <div class="table-cell status-col">
                    @if (inv.accepted) {
                      <span class="status-badge accepted">
                        <span class="material-icons">check_circle</span>
                        Accepted
                      </span>
                    } @else {
                      <span class="status-badge pending">
                        <span class="material-icons">schedule</span>
                        Pending
                      </span>
                    }
                  </div>
                  <div class="table-cell actions-col">
                    @if (!inv.accepted) {
                      <button class="icon-btn" (click)="copyInviteLink(inv)" [title]="copiedId() === inv.id ? 'Copied!' : 'Copy invite link'">
                        @if (copiedId() === inv.id) {
                          <span class="material-icons" style="color: #388e3c">check</span>
                        } @else {
                          <span class="material-icons">content_copy</span>
                        }
                      </button>
                      <button class="icon-btn" (click)="resendInvitation(inv)" title="Resend invitation email" [disabled]="resendingId() === inv.id">
                        @if (resendingId() === inv.id) {
                          <span class="material-icons animate-spin">sync</span>
                        } @else {
                          <span class="material-icons">forward_to_inbox</span>
                        }
                      </button>
                      <button class="icon-btn" (click)="deleteInvitation(inv)" title="Delete invitation">
                        <span class="material-icons">delete</span>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      }

      <!-- Invite Modal -->
      @if (showInviteModal()) {
        <div class="modal-overlay" (click)="closeInviteModal()">
          <div class="modal" (click)="$event.stopPropagation()">
            @if (createdInvitation()) {
              <!-- Success state: show invite link -->
              <div class="modal-header">
                <h2>
                  <span class="material-icons" style="color: #388e3c">check_circle</span>
                  Invitation Created
                </h2>
                <button class="icon-btn" (click)="closeInviteModal()">
                  <span class="material-icons">close</span>
                </button>
              </div>
              <div class="modal-body">
                <p class="invite-success-msg">Invitation sent to <strong>{{ createdInvitation()!.email }}</strong>. Share the link below so they can join:</p>
                <div class="invite-link-box">
                  <code class="invite-link-text">{{ getInviteUrl(createdInvitation()!.token) }}</code>
                  <button class="btn btn-sm btn-primary" (click)="copyInviteLink(createdInvitation()!)">
                    @if (copiedId() === createdInvitation()!.id) {
                      <span class="material-icons">check</span>
                      Copied!
                    } @else {
                      <span class="material-icons">content_copy</span>
                      Copy Link
                    }
                  </button>
                </div>
                <div class="modal-footer">
                  <button type="button" (click)="closeInviteModal()" class="btn btn-primary">
                    Done
                  </button>
                </div>
              </div>
            } @else {
              <!-- Form state -->
              <div class="modal-header">
                <h2>
                  <span class="material-icons">person_add</span>
                  Invite User
                </h2>
                <button class="icon-btn" (click)="closeInviteModal()">
                  <span class="material-icons">close</span>
                </button>
              </div>

              <form (ngSubmit)="inviteUser()" class="modal-body">
                <div class="form-group">
                  <label class="form-label">Email address</label>
                  <div class="input-icon">
                    <span class="material-icons">mail</span>
                    <input
                      type="email"
                      [(ngModel)]="inviteEmail"
                      name="email"
                      class="input"
                      placeholder="user@example.com"
                      required
                    />
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label">Role</label>
                  <div class="input-icon">
                    <span class="material-icons">badge</span>
                    <select [(ngModel)]="inviteRole" name="role" class="input">
                      <option value="VIEWER">Viewer - Can view documents</option>
                      <option value="EDITOR">Editor - Can edit documents</option>
                      <option value="ORG_ADMIN">Org Admin - Can manage spaces</option>
                    </select>
                  </div>
                </div>

                <div class="modal-footer">
                  <button type="button" (click)="closeInviteModal()" class="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" [disabled]="sending()" class="btn btn-primary">
                    @if (sending()) {
                      <span class="material-icons animate-spin">sync</span>
                      Sending...
                    } @else {
                      <span class="material-icons">send</span>
                      Send Invitation
                    }
                  </button>
                </div>
              </form>
            }
          </div>
        </div>
      }

      <!-- Edit Modal -->
      @if (editingUser()) {
        <div class="modal-overlay" (click)="closeEditModal()">
          <div class="modal modal-wide" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>
                <span class="material-icons">edit</span>
                Edit User
                @if (editingUser()!.enabled === false) {
                  <span class="pending-tag">Invited</span>
                }
              </h2>
              <button class="icon-btn" (click)="closeEditModal()">
                <span class="material-icons">close</span>
              </button>
            </div>

            <div class="modal-body">
              <!-- User info section -->
              <div class="edit-section">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Name</label>
                    <div class="input-icon">
                      <span class="material-icons">person</span>
                      <input
                        type="text"
                        [(ngModel)]="editForm.name"
                        class="input"
                        [disabled]="editingUser()!.enabled === false"
                      />
                    </div>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Role</label>
                    <div class="input-icon">
                      <span class="material-icons">badge</span>
                      <select [(ngModel)]="editForm.role" class="input">
                        <option value="VIEWER">Viewer</option>
                        <option value="EDITOR">Editor</option>
                        <option value="ORG_ADMIN">Org Admin</option>
                        <option value="SUPER_ADMIN">Super Admin</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Permissions section -->
              <div class="edit-section">
                <h3 class="section-title">
                  <span class="material-icons">security</span>
                  Space Permissions
                </h3>
                <p class="section-hint">Grant or revoke access to spaces. Changes are saved together.</p>

                @if (loadingPermissions()) {
                  <div class="loading-permissions">
                    <span class="material-icons animate-spin">sync</span>
                    Loading...
                  </div>
                } @else {
                  <div class="permissions-list">
                    @for (space of allSpaces(); track space.id) {
                      <div class="permission-row"
                           [class.has-permission]="space.type === 'GROUP' ? getGroupAccessStatus(space) !== 'none' : !!getSpacePermission(space.id)"
                           [class.is-group]="space.type === 'GROUP'"
                           [style.padding-left.px]="getSpaceIndent(space)">
                        <div class="permission-space">
                          <span class="material-icons space-icon">
                            {{ space.type === 'GROUP' ? 'folder' : 'description' }}
                          </span>
                          <span class="space-name">{{ space.name }}</span>
                          <span class="space-path">{{ space.fullPath }}</span>
                        </div>
                        <div class="permission-control">
                          @if (space.type === 'GROUP') {
                            <div class="group-access-control">
                              <span class="group-access-badge badge-{{ getGroupAccessStatus(space) }}">
                                {{ getGroupAccessStatus(space) === 'all' ? 'All' : getGroupAccessStatus(space) === 'partial' ? 'Partial' : '—' }}
                              </span>
                              <button type="button" class="btn-bulk btn-bulk-edit" (click)="setAllChildren(space, 'EDIT')">Edit all</button>
                              <button type="button" class="btn-bulk btn-bulk-clear" (click)="setAllChildren(space, '')">Clear</button>
                            </div>
                          } @else {
                            <select
                              [ngModel]="getSpacePermission(space.id)"
                              (ngModelChange)="setSpacePermission(space.id, $event)"
                              class="permission-select"
                            >
                              <option value="">No access</option>
                              <option value="VIEW">View</option>
                              <option value="EDIT">Edit</option>
                              <option value="ADMIN">Admin</option>
                            </select>
                          }
                        </div>
                      </div>
                    } @empty {
                      <div class="no-spaces">No spaces available</div>
                    }
                  </div>
                }
              </div>

              <div class="modal-footer">
                <button type="button" (click)="closeEditModal()" class="btn btn-secondary">
                  Cancel
                </button>
                <button type="button" (click)="saveUser()" [disabled]="savingUser()" class="btn btn-primary">
                  @if (savingUser()) {
                    <span class="material-icons animate-spin">sync</span>
                    Saving...
                  } @else {
                    <span class="material-icons">save</span>
                    Save Changes
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .users-management {
      background: transparent;
    }

    .management-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--spacing-xl);

      h1 {
        font-size: 24px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .subtitle {
        color: var(--text-muted);
        font-size: 14px;
      }
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--spacing-lg);
      margin-bottom: var(--spacing-xl);
    }

    .stat-card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: var(--spacing-lg);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .stat-card-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: rgba(111, 179, 184, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--spacing-md);

      .material-icons {
        font-size: 22px;
        color: var(--primary);
      }

      &.active {
        background: rgba(76, 175, 80, 0.15);

        .material-icons {
          color: #2e7d32;
        }
      }

      &.pending {
        background: rgba(255, 152, 0, 0.15);

        .material-icons {
          color: #f57c00;
        }
      }
    }

    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1;
      margin-bottom: var(--spacing-xs);
    }

    .stat-label {
      font-size: 13px;
      color: var(--text-muted);
    }

    .users-table-container {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      margin-bottom: var(--spacing-xl);
      overflow: hidden;
    }

    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 17px;
        font-weight: 600;
        color: var(--text-primary);
      }
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      background: var(--background);
      border-radius: var(--radius-md);
      border: 1px solid var(--border);

      .material-icons {
        font-size: 20px;
        color: var(--text-muted);
      }

      input {
        border: none;
        background: transparent;
        outline: none;
        font-size: 14px;
        color: var(--text-primary);
        width: 200px;

        &::placeholder {
          color: var(--text-muted);
        }
      }
    }

    .table {
      width: 100%;
    }

    .table-head {
      background: var(--background);
    }

    .table-head .table-row {
      border-bottom: 1px solid var(--border);
    }

    .table-head .table-cell {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }

    .table-row {
      display: flex;
      align-items: center;
      padding: var(--spacing-md) var(--spacing-lg);
      border-bottom: 1px solid var(--border-light);
      transition: background var(--transition);

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: var(--background);
      }
    }

    .table-cell {
      padding: var(--spacing-sm);
    }

    .user-col {
      flex: 2;
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }

    .email-col {
      flex: 2;
    }

    .role-col {
      flex: 1;
    }

    .status-col {
      flex: 1;
    }

    .actions-col {
      flex: 0 0 170px;
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-xs);
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary-light) 0%, var(--primary) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .user-details {
      display: flex;
      flex-direction: column;
    }

    .user-name {
      font-weight: 500;
      color: var(--text-primary);
      font-size: 14px;
    }

    .user-email {
      font-size: 12px;
      color: var(--text-muted);
    }

    .role-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 500;

      &[data-role="super_admin"] {
        background: rgba(156, 39, 176, 0.1);
        color: #7b1fa2;
      }

      &[data-role="org_admin"] {
        background: rgba(33, 150, 243, 0.1);
        color: #1976d2;
      }

      &[data-role="editor"] {
        background: rgba(76, 175, 80, 0.1);
        color: #388e3c;
      }

      &[data-role="viewer"] {
        background: rgba(158, 158, 158, 0.15);
        color: #616161;
      }
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;

      .material-icons {
        font-size: 16px;
      }

      &.accepted {
        color: #388e3c;
      }

      &.pending {
        color: #f57c00;
      }
    }

    .table-empty {
      padding: var(--spacing-xxl);
      text-align: center;
      color: var(--text-muted);

      .material-icons {
        font-size: 48px;
        margin-bottom: var(--spacing-md);
        opacity: 0.5;
      }
    }

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

    .modal {
      background: var(--surface);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 480px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-wide {
      max-width: 640px;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);

      h2 {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);

        .material-icons {
          color: var(--primary);
        }
      }
    }

    .modal-body {
      padding: var(--spacing-lg);
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-md);
      padding-top: var(--spacing-lg);
      margin-top: var(--spacing-md);
      border-top: 1px solid var(--border);
    }

    @media (max-width: 768px) {
      .management-header {
        flex-direction: column;
        gap: var(--spacing-md);

        .btn {
          width: 100%;
        }
      }

      .table-row {
        flex-wrap: wrap;
      }

      .user-col {
        flex: 1 1 100%;
        margin-bottom: var(--spacing-sm);
      }

      .date-col,
      .actions-col {
        flex: 1;
      }

      .search-box input {
        width: 120px;
      }
    }

    .invite-success-msg {
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: var(--spacing-lg);

      strong {
        color: var(--text-primary);
      }
    }

    .invite-link-box {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }

    .invite-link-text {
      flex: 1;
      font-size: 12px;
      color: var(--text-secondary);
      word-break: break-all;
      line-height: 1.4;
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
      white-space: nowrap;

      .material-icons {
        font-size: 16px;
      }
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .disabled-user {
      opacity: 0.7;
    }

    .avatar-pending {
      background: linear-gradient(135deg, #bbb 0%, #999 100%) !important;
    }

    .pending-tag {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      font-size: 11px;
      font-weight: 500;
      background: rgba(255, 152, 0, 0.15);
      color: #f57c00;
      margin-left: 6px;
    }

    .edit-section {
      margin-bottom: var(--spacing-lg);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-md);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--spacing-xs);

      .material-icons {
        font-size: 20px;
        color: var(--primary);
      }
    }

    .section-hint {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: var(--spacing-md);
    }

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

    .permission-control {
      flex-shrink: 0;
      margin-left: var(--spacing-md);
    }

    .permission-select {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 13px;
      cursor: pointer;
      min-width: 100px;

      &:focus {
        outline: none;
        border-color: var(--primary);
      }
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
  `]
})
export class UsersComponent implements OnInit {
  users = signal<User[]>([]);
  invitations = signal<Invitation[]>([]);
  showInviteModal = signal(false);
  editingUser = signal<User | null>(null);
  sending = signal(false);
  savingUser = signal(false);
  resendingId = signal<string | null>(null);
  copiedId = signal<string | null>(null);
  createdInvitation = signal<Invitation | null>(null);
  loadingPermissions = signal(false);
  allSpaces = signal<Space[]>([]);
  searchTerm = '';

  inviteEmail = '';
  inviteRole = 'VIEWER';

  editForm = {
    name: '',
    role: ''
  };

  // Map of spaceId -> permissionLevel for the user being edited
  editPermissions: Record<string, string> = {};

  constructor(
    private usersService: UsersService,
    private spacesService: SpacesService,
    public authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadUsers();
    this.loadInvitations();
  }

  loadUsers(): void {
    this.usersService.getUsers().subscribe({
      next: (users) => this.users.set(users)
    });
  }

  loadInvitations(): void {
    this.usersService.getInvitations().subscribe({
      next: (invs) => this.invitations.set(invs.filter(i => !i.accepted))
    });
  }

  filteredUsers(): User[] {
    if (!this.searchTerm) return this.users();
    const term = this.searchTerm.toLowerCase();
    return this.users().filter(u =>
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term)
    );
  }

  getAdminCount(): number {
    return this.users().filter(u =>
      u.role === 'SUPER_ADMIN' || u.role === 'ORG_ADMIN'
    ).length;
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }

  formatRole(role: string): string {
    return role.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  }

  inviteUser(): void {
    if (!this.inviteEmail) return;

    this.sending.set(true);
    this.usersService.inviteUser(this.inviteEmail, undefined, this.inviteRole).subscribe({
      next: (invitation) => {
        this.sending.set(false);
        this.createdInvitation.set(invitation);
        this.inviteEmail = '';
        this.inviteRole = 'VIEWER';
        this.loadInvitations();
        this.loadUsers();
      },
      error: (err) => {
        this.sending.set(false);
        if (err.status === 409) {
          alert('A user or pending invitation with this email already exists.');
        }
      }
    });
  }

  closeInviteModal(): void {
    this.showInviteModal.set(false);
    this.createdInvitation.set(null);
  }

  getInviteUrl(token: string): string {
    return `${window.location.origin}/accept-invitation?token=${token}`;
  }

  copyInviteLink(inv: Invitation): void {
    const url = this.getInviteUrl(inv.token);
    navigator.clipboard.writeText(url).then(() => {
      this.copiedId.set(inv.id);
      setTimeout(() => this.copiedId.set(null), 2000);
    });
  }

  resendInvitation(inv: Invitation): void {
    this.resendingId.set(inv.id);
    this.usersService.resendInvitation(inv.id).subscribe({
      next: () => {
        this.resendingId.set(null);
        this.loadInvitations();
      },
      error: () => {
        this.resendingId.set(null);
      }
    });
  }

  deleteInvitation(inv: Invitation): void {
    if (confirm(`Remove invitation for "${inv.email}"?`)) {
      this.usersService.deleteInvitation(inv.id).subscribe({
        next: () => this.loadInvitations()
      });
    }
  }

  impersonateUser(user: User): void {
    this.usersService.impersonateUser(user.id).subscribe({
      next: () => {
        this.authService.checkAuth().subscribe(() => {
          this.router.navigate(['/dashboard']);
        });
      }
    });
  }

  editUser(user: User): void {
    this.editingUser.set(user);
    this.editForm = {
      name: user.name,
      role: user.role
    };
    this.editPermissions = {};
    this.loadingPermissions.set(true);

    // Load spaces and user permissions in parallel
    forkJoin({
      spaces: this.spacesService.getSpaces(),
      permissions: this.usersService.getUserPermissions(user.id)
    }).subscribe({
      next: ({ spaces, permissions }) => {
        this.allSpaces.set(spaces.sort((a, b) => a.fullPath.localeCompare(b.fullPath)));
        this.editPermissions = {};
        permissions.forEach(p => {
          this.editPermissions[p.spaceId] = p.permissionLevel;
        });
        this.loadingPermissions.set(false);
      },
      error: () => {
        this.loadingPermissions.set(false);
      }
    });
  }

  closeEditModal(): void {
    this.editingUser.set(null);
    this.editPermissions = {};
  }

  getSpacePermission(spaceId: string): string {
    return this.editPermissions[spaceId] || '';
  }

  setSpacePermission(spaceId: string, level: string): void {
    if (level) {
      this.editPermissions[spaceId] = level;
    } else {
      delete this.editPermissions[spaceId];
    }
  }

  getSpaceIndent(space: Space): number {
    const depth = (space.fullPath.match(/\//g) || []).length;
    return 12 + depth * 20;
  }

  getGroupAccessStatus(group: Space): 'all' | 'partial' | 'none' {
    const repos = this.getDescendantRepos(group);
    if (repos.length === 0) return 'none';
    const withAccess = repos.filter(r => !!this.editPermissions[r.id]);
    if (withAccess.length === 0) return 'none';
    if (withAccess.length === repos.length) return 'all';
    return 'partial';
  }

  private getDescendantRepos(group: Space): Space[] {
    const result: Space[] = [];
    const children = this.allSpaces().filter(s => s.parentId === group.id);
    for (const child of children) {
      if (child.type === 'GROUP') {
        result.push(...this.getDescendantRepos(child));
      } else {
        result.push(child);
      }
    }
    return result;
  }

  setAllChildren(group: Space, level: string): void {
    const repos = this.getDescendantRepos(group);
    for (const repo of repos) {
      if (level) {
        this.editPermissions[repo.id] = level;
      } else {
        delete this.editPermissions[repo.id];
      }
    }
  }

  saveUser(): void {
    const user = this.editingUser();
    if (!user) return;

    this.savingUser.set(true);

    // Build permissions array from the map
    const permissions = Object.entries(this.editPermissions).map(([spaceId, permissionLevel]) => ({
      spaceId,
      permissionLevel
    }));

    // Save user info and permissions in parallel
    forkJoin({
      userUpdate: this.usersService.updateUser(user.id, this.editForm),
      permUpdate: this.usersService.setUserPermissions(user.id, permissions)
    }).subscribe({
      next: () => {
        this.savingUser.set(false);
        this.editingUser.set(null);
        this.editPermissions = {};
        this.loadUsers();
      },
      error: () => {
        this.savingUser.set(false);
      }
    });
  }

  deleteUser(user: User): void {
    if (confirm(`Are you sure you want to delete "${user.name}"?`)) {
      this.usersService.deleteUser(user.id).subscribe({
        next: () => this.loadUsers()
      });
    }
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString();
  }
}
