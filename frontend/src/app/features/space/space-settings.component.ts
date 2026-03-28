import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SpacesService, Space, SpacePermission } from '../../core/api/spaces.service';
import { UsersService } from '../../core/api/users.service';
import { User } from '../../core/auth/auth.service';
import { LogoUploadComponent } from '../../shared/components/logo-upload.component';
import { ToastService } from '../../shared/services/toast.service';
import { InboxService, RoutingRule, RuleType, RuleAction } from '../../core/api/inbox.service';

@Component({
  selector: 'app-space-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, LogoUploadComponent],
  template: `
    <div class="p-8">
      <div class="max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold text-gray-900 mb-8">
          {{ space()?.type === 'GROUP' ? 'Group' : 'Space' }} Settings
        </h1>

        @if (space()) {
          <!-- General Settings -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4">General</h2>
            <form (ngSubmit)="saveSettings()" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                <app-logo-upload
                  [currentLogoUrl]="space()?.logoUrl || null"
                  (fileSelected)="onLogoSelected($event)"
                  (logoRemoved)="onLogoRemoved()"
                ></app-logo-upload>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  [(ngModel)]="settings.name"
                  name="name"
                  class="input"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  [(ngModel)]="settings.description"
                  name="description"
                  class="input"
                  rows="3"
                ></textarea>
              </div>

              <!-- Git settings only for repositories -->
              @if (space()?.type === 'REPOSITORY') {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <input
                    type="text"
                    [(ngModel)]="settings.branch"
                    name="branch"
                    class="input"
                  />
                </div>

                <div class="flex items-center justify-between">
                  <div class="flex items-center">
                    <input
                      type="checkbox"
                      [(ngModel)]="settings.syncEnabled"
                      name="syncEnabled"
                      id="syncEnabled"
                      class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <label for="syncEnabled" class="ml-2 text-sm text-gray-700">
                      Enable automatic sync
                    </label>
                  </div>
                </div>

                @if (settings.syncEnabled) {
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      Sync interval (minutes)
                    </label>
                    <input
                      type="number"
                      [(ngModel)]="settings.syncIntervalMinutes"
                      name="syncIntervalMinutes"
                      class="input w-32"
                      min="5"
                      max="1440"
                    />
                  </div>
                }
              }

              <div class="flex justify-end pt-4">
                <button type="submit" [disabled]="saving()" class="btn btn-primary">
                  @if (saving()) {
                    Saving...
                  } @else {
                    Save Changes
                  }
                </button>
              </div>
            </form>
          </div>

          <!-- Location / Move to Group (only for spaces that can be moved) -->
          @if (space()?.type === 'REPOSITORY' || (space()?.type === 'GROUP' && !space()?.parentId)) {
            <div class="card p-6 mb-6">
              <h2 class="font-semibold text-gray-900 mb-4">Location</h2>
              <p class="text-sm text-gray-600 mb-4">
                Move this {{ space()?.type === 'GROUP' ? 'group' : 'repository' }} to a different parent group.
              </p>

              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Parent Group</label>
                  <select [(ngModel)]="selectedParentId" class="input">
                    @if (space()?.type === 'GROUP') {
                      <option value="">Top Level (no parent)</option>
                    }
                    @for (group of availableGroups(); track group.id) {
                      <option [value]="group.id" [disabled]="group.id === space()?.id">
                        {{ group.fullPath }}
                      </option>
                    }
                  </select>
                </div>
                <button
                  (click)="moveToGroup()"
                  [disabled]="moving() || selectedParentId === (space()?.parentId || '')"
                  class="btn btn-secondary"
                >
                  @if (moving()) {
                    Moving...
                  } @else {
                    Move
                  }
                </button>
              </div>

              @if (space()?.parentId) {
                <p class="text-sm text-gray-500 mt-2">
                  Currently in: <strong>{{ space()?.parentSlug }}</strong>
                </p>
              } @else {
                <p class="text-sm text-gray-500 mt-2">
                  Currently at: <strong>Top Level</strong>
                </p>
              }
            </div>
          }

          <!-- Permissions -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4">Permissions</h2>

            @if (space()?.parentId) {
              <p class="text-sm text-gray-500 mb-4">
                <span class="material-icons text-sm align-middle">info</span>
                Permissions are inherited from the parent group. Add permissions here to override.
              </p>
            }

            @if (permissions().length === 0) {
              <p class="text-gray-600 text-sm">No direct permissions configured.</p>
            } @else {
              <div class="divide-y divide-gray-200">
                @for (perm of permissions(); track perm.id) {
                  <div class="flex items-center justify-between py-3">
                    <div>
                      <div class="font-medium text-gray-900">{{ perm.userName }}</div>
                      <div class="text-sm text-gray-500">{{ perm.userEmail }}</div>
                    </div>
                    <div class="flex items-center gap-4">
                      <select
                        [value]="perm.permissionLevel"
                        (change)="updatePermission(perm.userId, $event)"
                        class="input w-32 text-sm"
                      >
                        <option value="VIEW">View</option>
                        <option value="EDIT">Edit</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <button
                        (click)="removePermission(perm.userId)"
                        class="text-red-600 hover:text-red-700"
                      >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                }
              </div>
            }

            <!-- Add User -->
            <div class="mt-4 pt-4 border-t border-gray-200">
              <div class="flex gap-2">
                <select [(ngModel)]="newPermission.userId" class="input flex-1">
                  <option value="">Select a user...</option>
                  @for (user of availableUsers(); track user.id) {
                    <option [value]="user.id">{{ user.name }} ({{ user.email }})</option>
                  }
                </select>
                <select [(ngModel)]="newPermission.level" class="input w-32">
                  <option value="VIEW">View</option>
                  <option value="EDIT">Edit</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button
                  (click)="addPermission()"
                  [disabled]="!newPermission.userId"
                  class="btn btn-primary"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <!-- Auto-filing Rules -->
          @if (space()?.type === 'REPOSITORY') {
            <div class="card p-6 mb-6">
              <h2 class="font-semibold text-gray-900 mb-1">Auto-filing Rules</h2>
              <p class="text-sm text-gray-500 mb-4">Rules automatically route matching inbox notes to the right document.</p>

              @if (rules().length === 0) {
                <p class="text-sm text-gray-500 mb-4">No rules yet.</p>
              } @else {
                <div class="divide-y divide-gray-100 mb-4">
                  @for (rule of rules(); track rule.id) {
                    <div class="flex items-center justify-between py-3 gap-3">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="rule-type-badge">{{ rule.type }}</span>
                          <code class="rule-condition">{{ rule.condition }}</code>
                        </div>
                        <div class="text-xs text-gray-500">
                          → {{ rule.targetDocumentPath || rule.targetGroupPath || 'new document' }}
                          @if (rule.description) { · {{ rule.description }} }
                        </div>
                      </div>
                      <div class="flex items-center gap-3 flex-shrink-0">
                        <label class="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            [checked]="rule.autoFile"
                            (change)="toggleAutoFile(rule, $event)"
                          />
                          Auto-file
                        </label>
                        <button class="icon-btn" (click)="deleteRule(rule.id)" title="Delete rule">
                          <span class="material-icons" style="font-size:16px">delete_outline</span>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Add rule form -->
              <details class="add-rule-details">
                <summary class="text-sm font-medium text-gray-700 cursor-pointer mb-3">+ Add rule</summary>
                <div class="add-rule-form">
                  <div class="flex gap-2 flex-wrap">
                    <select [(ngModel)]="newRule.type" class="input input-sm">
                      <option value="CATEGORY">Category</option>
                      <option value="PATTERN">Pattern</option>
                    </select>
                    <input
                      type="text"
                      [(ngModel)]="newRule.condition"
                      class="input input-sm flex-1"
                      placeholder="e.g. meeting notes or #incident"
                    />
                    <select [(ngModel)]="newRule.actionType" class="input input-sm">
                      <option value="APPEND_TO_DOCUMENT">Append to doc</option>
                      <option value="CREATE_DOCUMENT">Create new doc</option>
                    </select>
                  </div>
                  <div class="flex gap-2 flex-wrap mt-2">
                    <input
                      type="text"
                      [(ngModel)]="newRule.targetDocumentPath"
                      class="input input-sm flex-1"
                      placeholder="Target document path (e.g. docs/meetings.md)"
                    />
                    <label class="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" [(ngModel)]="newRule.autoFile" />
                      Auto-file (no prompt)
                    </label>
                    <button
                      class="btn btn-primary btn-sm"
                      [disabled]="!newRule.condition"
                      (click)="addRule()"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>
              </details>
            </div>
          }

          <!-- Danger Zone -->
          <div class="card p-6 border-red-200">
            <h2 class="font-semibold text-red-600 mb-4">Danger Zone</h2>
            <p class="text-sm text-gray-600 mb-4">
              @if (space()?.type === 'GROUP') {
                Deleting this group will permanently remove all nested groups and repositories.
              } @else {
                Deleting this space will permanently remove all documents and settings.
              }
              This action cannot be undone.
            </p>
            <button
              (click)="deleteSpace()"
              class="btn btn-danger"
            >
              Delete {{ space()?.type === 'GROUP' ? 'Group' : 'Space' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .rule-type-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(111, 179, 184, 0.15);
      color: var(--primary-dark);
    }
    .rule-condition {
      font-size: 12px;
      background: var(--background);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'Monaco','Menlo',monospace;
      color: var(--text-primary);
    }
    .add-rule-details summary { list-style: none; }
    .add-rule-details summary::-webkit-details-marker { display: none; }
    .add-rule-form { margin-top: 10px; }
    .input-sm { padding: 5px 8px; font-size: 13px; }
    .icon-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; padding: 4px; border-radius: 4px; transition: color 0.15s; }
    .icon-btn:hover { color: #dc2626; }
  `]
})
export class SpaceSettingsComponent implements OnInit {
  space = signal<Space | null>(null);
  permissions = signal<SpacePermission[]>([]);
  availableUsers = signal<User[]>([]);
  availableGroups = signal<Space[]>([]);
  rules = signal<RoutingRule[]>([]);
  saving = signal(false);
  moving = signal(false);
  selectedParentId = '';

  newRule = {
    type: 'CATEGORY' as RuleType,
    condition: '',
    actionType: 'APPEND_TO_DOCUMENT' as RuleAction,
    targetDocumentPath: '',
    autoFile: false
  };

  settings = {
    name: '',
    description: '',
    branch: '',
    syncEnabled: true,
    syncIntervalMinutes: 15
  };

  newPermission = {
    userId: '',
    level: 'VIEW'
  };

  pendingLogoFile: File | null = null;
  pendingLogoRemoval = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private usersService: UsersService,
    private toastService: ToastService,
    private inboxService: InboxService
  ) {}

  ngOnInit(): void {
    // Get the full path from parent route params
    this.route.parent?.paramMap.subscribe(params => {
      const path1 = params.get('path1');
      const path2 = params.get('path2');
      const path3 = params.get('path3');

      const fullPath = [path1, path2, path3].filter(Boolean).join('/');
      if (fullPath) {
        this.loadSpaceByPath(fullPath);
      }
    });
    this.loadUsers();
    this.loadGroups();
  }

  loadSpaceByPath(fullPath: string): void {
    this.spacesService.getSpaceByPath(fullPath).subscribe({
      next: (space) => {
        this.space.set(space);
        this.selectedParentId = space.parentId || '';
        this.settings = {
          name: space.name,
          description: space.description || '',
          branch: space.branch,
          syncEnabled: space.syncEnabled,
          syncIntervalMinutes: space.syncIntervalMinutes
        };
        this.loadPermissions(space.id);
        if (space.type === 'REPOSITORY') {
          this.loadRules(space.id);
        }
      }
    });
  }

  loadRules(spaceId: string): void {
    this.inboxService.getRules(spaceId).subscribe({
      next: (rules) => this.rules.set(rules),
      error: () => this.rules.set([])
    });
  }

  addRule(): void {
    const space = this.space();
    if (!space || !this.newRule.condition) return;

    this.inboxService.createRule(space.id, {
      type: this.newRule.type,
      condition: this.newRule.condition,
      actionType: this.newRule.actionType,
      targetDocumentPath: this.newRule.targetDocumentPath || undefined,
      autoFile: this.newRule.autoFile
    }).subscribe({
      next: (rule) => {
        this.rules.update(rules => [...rules, rule]);
        this.newRule = { type: 'CATEGORY', condition: '', actionType: 'APPEND_TO_DOCUMENT', targetDocumentPath: '', autoFile: false };
        this.toastService.success('Rule added', 'Routing rule saved successfully.');
      },
      error: () => this.toastService.error('Error', 'Failed to add rule')
    });
  }

  toggleAutoFile(rule: RoutingRule, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.inboxService.updateRule(rule.spaceId, rule.id, { autoFile: checked }).subscribe({
      next: (updated) => {
        this.rules.update(rules => rules.map(r => r.id === updated.id ? updated : r));
      },
      error: () => this.toastService.error('Error', 'Failed to update rule')
    });
  }

  deleteRule(ruleId: string): void {
    const space = this.space();
    if (!space) return;

    this.inboxService.deleteRule(space.id, ruleId).subscribe({
      next: () => {
        this.rules.update(rules => rules.filter(r => r.id !== ruleId));
        this.toastService.success('Rule deleted', 'The routing rule has been removed.');
      },
      error: () => this.toastService.error('Error', 'Failed to delete rule')
    });
  }

  loadGroups(): void {
    // Load all groups to populate the "move to" dropdown
    this.spacesService.getSpaces().subscribe({
      next: (spaces) => {
        // Filter to only groups that can be parents (top-level groups and subgroups)
        const groups = spaces.filter(s => s.type === 'GROUP');
        this.availableGroups.set(groups);
      }
    });
  }

  moveToGroup(): void {
    const space = this.space();
    if (!space) return;

    const newParentId = this.selectedParentId || null;
    if (newParentId === (space.parentId || '')) return;

    this.moving.set(true);

    // Build the update payload
    const payload: any = {};
    if (newParentId) {
      payload.parentId = newParentId;
    } else {
      payload.clearParent = true;
    }

    this.spacesService.updateSpace(space.id, payload).subscribe({
      next: (updated) => {
        this.space.set(updated);
        this.moving.set(false);
        this.toastService.success('Moved', `${space.name} has been moved successfully.`);
        // Navigate to new location
        this.router.navigate(['/spaces', updated.fullPath, 'settings']);
      },
      error: (err) => {
        this.moving.set(false);
        this.toastService.error('Move Failed', err.error?.message || 'Failed to move space');
      }
    });
  }

  loadPermissions(spaceId: string): void {
    this.spacesService.getPermissions(spaceId).subscribe({
      next: (perms) => this.permissions.set(perms)
    });
  }

  loadUsers(): void {
    this.usersService.getUsers().subscribe({
      next: (users) => this.availableUsers.set(users)
    });
  }

  saveSettings(): void {
    const space = this.space();
    if (!space) return;

    this.saving.set(true);

    // First save settings
    this.spacesService.updateSpace(space.id, this.settings).subscribe({
      next: (updated) => {
        this.space.set(updated);

        // Then handle logo changes
        if (this.pendingLogoRemoval) {
          this.spacesService.deleteLogo(space.id).subscribe({
            next: (result) => {
              this.space.set(result);
              this.pendingLogoRemoval = false;
              this.saving.set(false);
            },
            error: () => this.saving.set(false)
          });
        } else if (this.pendingLogoFile) {
          this.spacesService.uploadLogo(space.id, this.pendingLogoFile).subscribe({
            next: (result) => {
              this.space.set(result);
              this.pendingLogoFile = null;
              this.saving.set(false);
            },
            error: () => this.saving.set(false)
          });
        } else {
          this.saving.set(false);
        }
      },
      error: () => {
        this.saving.set(false);
      }
    });
  }

  addPermission(): void {
    const space = this.space();
    if (!space || !this.newPermission.userId) return;

    this.spacesService.addPermission(
      space.id,
      this.newPermission.userId,
      this.newPermission.level
    ).subscribe({
      next: () => {
        this.loadPermissions(space.id);
        this.newPermission = { userId: '', level: 'VIEW' };
      }
    });
  }

  updatePermission(userId: string, event: Event): void {
    const space = this.space();
    if (!space) return;

    const level = (event.target as HTMLSelectElement).value;
    this.spacesService.addPermission(space.id, userId, level).subscribe();
  }

  removePermission(userId: string): void {
    const space = this.space();
    if (!space) return;

    if (confirm('Remove this user\'s access to the space?')) {
      this.spacesService.removePermission(space.id, userId).subscribe({
        next: () => this.loadPermissions(space.id)
      });
    }
  }

  onLogoSelected(file: File): void {
    this.pendingLogoFile = file;
    this.pendingLogoRemoval = false;
  }

  onLogoRemoved(): void {
    this.pendingLogoFile = null;
    this.pendingLogoRemoval = true;
  }

  deleteSpace(): void {
    const space = this.space();
    if (!space) return;

    if (confirm(`Are you sure you want to delete "${space.name}"? This cannot be undone.`)) {
      this.spacesService.deleteSpace(space.id).subscribe({
        next: () => this.router.navigate(['/dashboard'])
      });
    }
  }
}
