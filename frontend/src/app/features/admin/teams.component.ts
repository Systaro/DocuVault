import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { TeamsService, Team, TeamDetail, TeamMember } from '../../core/api/teams.service';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { UsersService } from '../../core/api/users.service';
import { User } from '../../core/auth/auth.service';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { SpacePermissionPickerComponent } from '../../shared/components/space-permission-picker.component';
import { ToastService } from '../../shared/services/toast.service';

const TEAM_COLORS = [
  '#6fb3b8', '#4a8a8f', '#7b1fa2', '#1976d2',
  '#388e3c', '#f57c00', '#d32f2f', '#616161'
];

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent, SpacePermissionPickerComponent],
  template: `
    <div class="teams-management">
      <div class="management-header">
        <div>
          <h1>Teams</h1>
          <p class="subtitle">Group users so access is granted once per team instead of once per person</p>
        </div>
        <button (click)="openCreate()" class="btn btn-primary">
          <span translate="no" class="material-icons">group_add</span>
          New Team
        </button>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-card-icon">
            <span translate="no" class="material-icons">groups</span>
          </div>
          <div class="stat-value">{{ teams().length }}</div>
          <div class="stat-label">Teams</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon active">
            <span translate="no" class="material-icons">person</span>
          </div>
          <div class="stat-value">{{ usersInTeams() }}</div>
          <div class="stat-label">Users in a Team</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon pending">
            <span translate="no" class="material-icons">folder_shared</span>
          </div>
          <div class="stat-value">{{ totalGrants() }}</div>
          <div class="stat-label">Space Grants</div>
        </div>
      </div>

      <!-- Teams Table -->
      <div class="table-container">
        <div class="table-header">
          <h2>All Teams</h2>
          <div class="search-box">
            <span translate="no" class="material-icons">search</span>
            <input type="text" [(ngModel)]="searchTerm" placeholder="Search teams..." />
          </div>
        </div>

        <div class="table">
          <div class="table-head">
            <div class="table-row">
              <div class="table-cell team-col">Team</div>
              <div class="table-cell count-col">Members</div>
              <div class="table-cell count-col">Spaces</div>
              <div class="table-cell actions-col">Actions</div>
            </div>
          </div>
          <div class="table-body">
            @for (team of filteredTeams(); track team.id) {
              <div class="table-row">
                <div class="table-cell team-col">
                  <div class="team-swatch" [style.background]="team.color || 'var(--primary)'">
                    <span translate="no" class="material-icons">groups</span>
                  </div>
                  <div class="team-details">
                    <span class="team-name">{{ team.name }}</span>
                    @if (team.description) {
                      <span class="team-description">{{ team.description }}</span>
                    } @else {
                      <span class="team-description muted">No description</span>
                    }
                  </div>
                </div>
                <div class="table-cell count-col">
                  <span class="count-pill">
                    <span translate="no" class="material-icons">person</span>
                    {{ team.memberCount }}
                  </span>
                </div>
                <div class="table-cell count-col">
                  <span class="count-pill">
                    <span translate="no" class="material-icons">folder</span>
                    {{ team.spaceCount }}
                  </span>
                </div>
                <div class="table-cell actions-col">
                  <button class="icon-btn" (click)="openEdit(team)" title="Edit team">
                    <span translate="no" class="material-icons">edit</span>
                  </button>
                  <button class="icon-btn" (click)="confirmDelete.set(team)" title="Delete team">
                    <span translate="no" class="material-icons">delete</span>
                  </button>
                </div>
              </div>
            } @empty {
              <div class="table-empty">
                <span translate="no" class="material-icons">groups</span>
                <p>No teams yet — create one to grant access in bulk</p>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Create / Edit Modal -->
      @if (showModal()) {
        <div class="modal-overlay" (click)="closeModal()">
          <div class="modal modal-wide" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>
                <span translate="no" class="material-icons">{{ editingTeam() ? 'edit' : 'group_add' }}</span>
                {{ editingTeam() ? 'Edit Team' : 'New Team' }}
              </h2>
              <button class="icon-btn" (click)="closeModal()">
                <span translate="no" class="material-icons">close</span>
              </button>
            </div>

            <div class="modal-body">
              <div class="edit-section">
                <div class="form-group">
                  <label class="form-label">Team name</label>
                  <div class="input-icon">
                    <span translate="no" class="material-icons">groups</span>
                    <input type="text" [(ngModel)]="form.name" class="input" placeholder="e.g. Engineering" />
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label">Description</label>
                  <input type="text" [(ngModel)]="form.description" class="input" placeholder="What this team is for (optional)" />
                </div>

                <div class="form-group">
                  <label class="form-label">Color</label>
                  <div class="color-swatches">
                    @for (color of teamColors; track color) {
                      <button type="button"
                              class="color-swatch"
                              [class.selected]="form.color === color"
                              [style.background]="color"
                              [attr.aria-label]="'Select color ' + color"
                              (click)="form.color = color">
                        @if (form.color === color) {
                          <span translate="no" class="material-icons">check</span>
                        }
                      </button>
                    }
                  </div>
                </div>
              </div>

              <!-- Members -->
              <div class="edit-section">
                <h3 class="section-title">
                  <span translate="no" class="material-icons">person_add</span>
                  Members
                </h3>
                <p class="section-hint">Everyone here inherits every space grant below.</p>

                <app-searchable-select
                  [options]="availableUserOptions()"
                  [ngModel]="''"
                  (ngModelChange)="addMember($event)"
                  placeholder="Add a user..."
                  searchPlaceholder="Search users..."
                />

                @if (memberIds().length > 0) {
                  <div class="member-chips">
                    @for (member of selectedMembers(); track member.id) {
                      <span class="member-chip">
                        <span class="chip-avatar">{{ getInitials(member.name) }}</span>
                        <span class="chip-name">{{ member.name }}</span>
                        <button type="button" class="chip-remove" (click)="removeMember(member.id)" [attr.aria-label]="'Remove ' + member.name">
                          <span translate="no" class="material-icons">close</span>
                        </button>
                      </span>
                    }
                  </div>
                } @else {
                  <p class="empty-hint">No members yet.</p>
                }
              </div>

              <!-- Space permissions -->
              <div class="edit-section">
                <h3 class="section-title">
                  <span translate="no" class="material-icons">security</span>
                  Space Permissions
                </h3>
                <p class="section-hint">
                  Granted to every member. Members keep any stronger access they hold personally.
                </p>

                <app-space-permission-picker
                  [spaces]="allSpaces()"
                  [permissions]="permissions"
                  [loading]="loadingDetail()"
                />
              </div>

              <div class="modal-footer">
                <button type="button" (click)="closeModal()" class="btn btn-secondary">Cancel</button>
                <button type="button" (click)="save()" [disabled]="saving() || !form.name.trim()" class="btn btn-primary">
                  @if (saving()) {
                    <span translate="no" class="material-icons animate-spin">sync</span>
                    Saving...
                  } @else {
                    <span translate="no" class="material-icons">save</span>
                    {{ editingTeam() ? 'Save Changes' : 'Create Team' }}
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Delete confirmation -->
      @if (confirmDelete(); as team) {
        <div class="modal-overlay" (click)="confirmDelete.set(null)">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>
                <span translate="no" class="material-icons danger-icon">warning</span>
                Delete Team
              </h2>
              <button class="icon-btn" (click)="confirmDelete.set(null)">
                <span translate="no" class="material-icons">close</span>
              </button>
            </div>
            <div class="modal-body">
              <p class="confirm-text">
                Delete <strong>{{ team.name }}</strong>? Its {{ team.memberCount }} member(s) lose the
                {{ team.spaceCount }} space grant(s) this team provides. Permissions granted to them
                directly are not affected.
              </p>
              <div class="modal-footer">
                <button type="button" (click)="confirmDelete.set(null)" class="btn btn-secondary">Cancel</button>
                <button type="button" (click)="deleteTeam(team)" [disabled]="deleting()" class="btn btn-danger">
                  @if (deleting()) {
                    <span translate="no" class="material-icons animate-spin">sync</span>
                    Deleting...
                  } @else {
                    <span translate="no" class="material-icons">delete</span>
                    Delete Team
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
    .teams-management {
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

    .table-container {
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

    .team-col {
      flex: 3;
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      min-width: 0;
    }

    .count-col {
      flex: 1;
    }

    .actions-col {
      flex: 0 0 120px;
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-xs);
    }

    .team-swatch {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .material-icons {
        font-size: 20px;
        color: #fff;
      }
    }

    .team-details {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .team-name {
      font-weight: 500;
      color: var(--text-primary);
      font-size: 14px;
    }

    .team-description {
      font-size: 12px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.muted {
        font-style: italic;
        opacity: 0.7;
      }
    }

    .count-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      background: var(--background);
      border: 1px solid var(--border);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);

      .material-icons {
        font-size: 14px;
        color: var(--text-muted);
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

        .danger-icon {
          color: var(--danger, #dc3545);
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

    .edit-section {
      margin-bottom: var(--spacing-lg);
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

    .color-swatches {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }

    .color-swatch {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md);
      border: 2px solid transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform var(--transition), border-color var(--transition);

      .material-icons {
        font-size: 18px;
        color: #fff;
      }

      &:hover {
        transform: scale(1.08);
      }

      &.selected {
        border-color: var(--text-primary);
      }
    }

    .member-chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin-top: var(--spacing-md);
    }

    .member-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 4px;
      border-radius: var(--radius-full);
      background: var(--background);
      border: 1px solid var(--border);
    }

    .chip-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary-light) 0%, var(--primary) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
    }

    .chip-name {
      font-size: 13px;
      color: var(--text-primary);
    }

    .chip-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--text-muted);
      padding: 0 2px;

      .material-icons {
        font-size: 16px;
      }

      &:hover {
        color: var(--danger, #dc3545);
      }
    }

    .empty-hint {
      margin-top: var(--spacing-md);
      font-size: 13px;
      color: var(--text-muted);
      font-style: italic;
    }

    .confirm-text {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-secondary);

      strong {
        color: var(--text-primary);
      }
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
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

      .team-col {
        flex: 1 1 100%;
        margin-bottom: var(--spacing-sm);
      }

      .search-box input {
        width: 120px;
      }
    }
  `]
})
export class TeamsComponent implements OnInit {
  teams = signal<Team[]>([]);
  users = signal<User[]>([]);
  allSpaces = signal<Space[]>([]);

  showModal = signal(false);
  editingTeam = signal<Team | null>(null);
  confirmDelete = signal<Team | null>(null);
  loadingDetail = signal(false);
  saving = signal(false);
  deleting = signal(false);

  searchTerm = '';
  memberIds = signal<string[]>([]);

  readonly teamColors = TEAM_COLORS;

  form = {
    name: '',
    description: '',
    color: TEAM_COLORS[0]
  };

  /** spaceId -> permission level, edited by the shared picker. */
  permissions: Record<string, string> = {};

  constructor(
    private teamsService: TeamsService,
    private usersService: UsersService,
    private spacesService: SpacesService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.loadTeams();
    this.usersService.getUsers().subscribe({
      next: (users) => this.users.set(users)
    });
    this.spacesService.getSpaces().subscribe({
      next: (spaces) => this.allSpaces.set([...spaces].sort((a, b) => a.fullPath.localeCompare(b.fullPath)))
    });
  }

  loadTeams(): void {
    this.teamsService.getTeams().subscribe({
      next: (teams) => this.teams.set(teams)
    });
  }

  filteredTeams(): Team[] {
    if (!this.searchTerm) return this.teams();
    const term = this.searchTerm.toLowerCase();
    return this.teams().filter(t =>
      t.name.toLowerCase().includes(term) ||
      (t.description || '').toLowerCase().includes(term)
    );
  }

  usersInTeams(): number {
    // Distinct across teams isn't available from the summary list, so this counts
    // memberships; close enough as a headline number and cheap to render.
    return this.teams().reduce((sum, t) => sum + t.memberCount, 0);
  }

  totalGrants(): number {
    return this.teams().reduce((sum, t) => sum + t.spaceCount, 0);
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }

  availableUserOptions(): SelectOption[] {
    const taken = new Set(this.memberIds());
    return this.users()
      .filter(u => !taken.has(u.id))
      .map(u => ({ value: u.id, label: u.name, sublabel: u.email }));
  }

  selectedMembers(): User[] {
    const byId = new Map(this.users().map(u => [u.id, u]));
    return this.memberIds()
      .map(id => byId.get(id))
      .filter((u): u is User => !!u)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  addMember(userId: string): void {
    if (!userId || this.memberIds().includes(userId)) return;
    this.memberIds.update(ids => [...ids, userId]);
  }

  removeMember(userId: string): void {
    this.memberIds.update(ids => ids.filter(id => id !== userId));
  }

  openCreate(): void {
    this.editingTeam.set(null);
    this.form = { name: '', description: '', color: TEAM_COLORS[0] };
    this.memberIds.set([]);
    this.permissions = {};
    this.showModal.set(true);
  }

  openEdit(team: Team): void {
    this.editingTeam.set(team);
    this.form = {
      name: team.name,
      description: team.description || '',
      color: team.color || TEAM_COLORS[0]
    };
    this.memberIds.set([]);
    this.permissions = {};
    this.loadingDetail.set(true);
    this.showModal.set(true);

    this.teamsService.getTeam(team.id).subscribe({
      next: (detail: TeamDetail) => {
        this.memberIds.set(detail.members.map((m: TeamMember) => m.userId));
        const next: Record<string, string> = {};
        detail.permissions.forEach(p => { next[p.spaceId] = p.permissionLevel; });
        this.permissions = next;
        this.loadingDetail.set(false);
      },
      error: () => {
        this.loadingDetail.set(false);
        this.toast.error('Could not load team', 'The team details failed to load. Close and try again.');
      }
    });
  }

  closeModal(): void {
    this.showModal.set(false);
    this.editingTeam.set(null);
    this.memberIds.set([]);
    this.permissions = {};
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) return;

    const payload = {
      name,
      description: this.form.description.trim() || undefined,
      color: this.form.color,
      memberIds: this.memberIds(),
      permissions: Object.entries(this.permissions).map(([spaceId, permissionLevel]) => ({
        spaceId,
        permissionLevel
      }))
    };

    this.saving.set(true);
    const existing = this.editingTeam();
    const request$ = existing
      ? this.teamsService.updateTeam(existing.id, payload)
      : this.teamsService.createTeam(payload);

    request$.subscribe({
      next: (team) => {
        this.saving.set(false);
        this.closeModal();
        this.loadTeams();
        this.toast.success(
          existing ? 'Team updated' : 'Team created',
          `${team.name} now has ${team.memberCount} member(s) and ${team.spaceCount} space grant(s).`
        );
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Save failed', 'The team could not be saved. Please try again.');
      }
    });
  }

  deleteTeam(team: Team): void {
    this.deleting.set(true);
    this.teamsService.deleteTeam(team.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.confirmDelete.set(null);
        this.loadTeams();
        this.toast.success('Team deleted', `${team.name} was removed.`);
      },
      error: () => {
        this.deleting.set(false);
        this.toast.error('Delete failed', `${team.name} could not be deleted.`);
      }
    });
  }
}
