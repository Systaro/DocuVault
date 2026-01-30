import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SpacesService, Space, SpacePermission } from '../../core/api/spaces.service';
import { UsersService } from '../../core/api/users.service';
import { User } from '../../core/auth/auth.service';

@Component({
  selector: 'app-space-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-8">
      <div class="max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold text-gray-900 mb-8">Space Settings</h1>

        @if (space()) {
          <!-- General Settings -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4">General</h2>
            <form (ngSubmit)="saveSettings()" class="space-y-4">
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

          <!-- Permissions -->
          <div class="card p-6 mb-6">
            <h2 class="font-semibold text-gray-900 mb-4">Permissions</h2>

            @if (permissions().length === 0) {
              <p class="text-gray-600 text-sm">No permissions configured.</p>
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

          <!-- Danger Zone -->
          <div class="card p-6 border-red-200">
            <h2 class="font-semibold text-red-600 mb-4">Danger Zone</h2>
            <p class="text-sm text-gray-600 mb-4">
              Deleting a space will permanently remove all documents and settings.
              This action cannot be undone.
            </p>
            <button
              (click)="deleteSpace()"
              class="btn btn-danger"
            >
              Delete Space
            </button>
          </div>
        }
      </div>
    </div>
  `
})
export class SpaceSettingsComponent implements OnInit {
  space = signal<Space | null>(null);
  permissions = signal<SpacePermission[]>([]);
  availableUsers = signal<User[]>([]);
  saving = signal(false);

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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private usersService: UsersService
  ) {}

  ngOnInit(): void {
    this.route.parent?.paramMap.subscribe(params => {
      const slug = params.get('slug');
      if (slug) {
        this.loadSpace(slug);
      }
    });
    this.loadUsers();
  }

  loadSpace(slug: string): void {
    this.spacesService.getSpaceBySlug(slug).subscribe({
      next: (space) => {
        this.space.set(space);
        this.settings = {
          name: space.name,
          description: space.description || '',
          branch: space.branch,
          syncEnabled: space.syncEnabled,
          syncIntervalMinutes: space.syncIntervalMinutes
        };
        this.loadPermissions(space.id);
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
    this.spacesService.updateSpace(space.id, this.settings).subscribe({
      next: (updated) => {
        this.space.set(updated);
        this.saving.set(false);
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
