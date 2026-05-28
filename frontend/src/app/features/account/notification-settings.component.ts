import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsersService, NotificationPreferences, SpaceNotificationPref } from '../../core/api/users.service';

interface EmailModeOption {
  value: string;
  label: string;
  hint: string;
}

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <div class="card-header">
        <span class="material-icons card-icon">notifications</span>
        <div>
          <h2>Notifications</h2>
          <p>Choose how often you hear about document changes, and mute spaces you don't follow</p>
        </div>
      </div>
      <div class="card-body">
        @if (loading()) {
          <div class="loading-state">
            <span class="material-icons animate-spin">sync</span>
            Loading preferences...
          </div>
        } @else if (prefs()) {
          <!-- Email cadence -->
          <div class="setting-block">
            <label class="setting-label">Email digest</label>
            <div class="segmented">
              @for (opt of emailModes; track opt.value) {
                <button
                  type="button"
                  class="segment"
                  [class.active]="prefs()!.emailMode === opt.value"
                  [disabled]="saving()"
                  (click)="setEmailMode(opt.value)"
                  [title]="opt.hint"
                >{{ opt.label }}</button>
              }
            </div>
          </div>

          <!-- Push -->
          <div class="setting-block">
            <label class="setting-label">Push notifications</label>
            <label class="switch-row">
              <input
                type="checkbox"
                [checked]="prefs()!.pushMode === 'INSTANT'"
                [disabled]="saving()"
                (change)="togglePush()"
              />
              <span>Send a push notification for new activity</span>
            </label>
          </div>

          @if (allOff()) {
            <div class="info-banner">
              <span class="material-icons">info</span>
              All notifications are off. You won't receive emails or push for any space.
            </div>
          }

          <!-- Per-space overrides -->
          @if (prefs()!.spaces.length > 0) {
            <div class="setting-block">
              <label class="setting-label">Per-space</label>
              <p class="setting-hint">
                You're subscribed to every space by default. Turn one off to mute it — muting a group mutes the
                repositories inside it.
              </p>
              <div class="space-list">
                @for (space of prefs()!.spaces; track space.spaceId) {
                  <div class="space-row" [style.--depth]="depthOf(space)">
                    <span class="material-icons space-icon">{{ space.type === 'GROUP' ? 'folder' : 'description' }}</span>
                    <span class="space-name">{{ space.name }}</span>
                    @if (space.override !== null) {
                      <button type="button" class="reset-link" (click)="resetSpace(space)" [disabled]="saving()">reset</button>
                    } @else {
                      <span class="inherited-tag">default</span>
                    }
                    <label class="switch">
                      <input
                        type="checkbox"
                        [checked]="space.enabled"
                        [disabled]="saving()"
                        (change)="toggleSpace(space)"
                      />
                      <span class="slider"></span>
                    </label>
                  </div>
                }
              </div>
            </div>
          }

          @if (error()) {
            <div class="form-error">{{ error() }}</div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: var(--spacing-lg);
      overflow: hidden;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-lg) var(--spacing-xl);
      border-bottom: 1px solid var(--border);

      .card-icon { font-size: 24px; color: var(--primary); }
      h2 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0 0 2px; }
      p { font-size: 13px; color: var(--text-secondary); margin: 0; }
    }
    .card-body { padding: var(--spacing-xl); }

    .setting-block { margin-bottom: var(--spacing-xl); }
    .setting-block:last-child { margin-bottom: 0; }

    .setting-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: var(--spacing-sm);
    }
    .setting-hint {
      font-size: 13px;
      color: var(--text-secondary);
      margin: 0 0 var(--spacing-md);
      line-height: 1.5;
    }

    .segmented {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .segment {
      padding: 8px 16px;
      border: none;
      background: var(--background);
      color: var(--text-secondary);
      font-size: 14px;
      cursor: pointer;
      border-right: 1px solid var(--border);
      transition: all var(--transition);
    }
    .segment:last-child { border-right: none; }
    .segment:hover:not(:disabled) { color: var(--text-primary); }
    .segment.active { background: var(--primary); color: #fff; }
    .segment:disabled { opacity: 0.6; cursor: not-allowed; }

    .switch-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 14px;
      color: var(--text-primary);
      cursor: pointer;
    }

    .info-banner {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      background: rgba(111, 179, 184, 0.08);
      border: 1px solid rgba(111, 179, 184, 0.2);
      border-radius: var(--radius-md);
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: var(--spacing-xl);

      .material-icons { font-size: 18px; color: var(--primary); }
    }

    .space-list {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .space-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: 10px 16px;
      padding-left: calc(12px + var(--depth, 0) * 20px);
      border-bottom: 1px solid var(--border);
    }
    .space-row:last-child { border-bottom: none; }
    .space-icon { font-size: 18px; color: var(--text-secondary); }
    .space-name { flex: 1; font-size: 14px; color: var(--text-primary); }

    .inherited-tag {
      font-size: 11px;
      color: var(--text-secondary);
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .reset-link {
      background: none;
      border: none;
      color: var(--primary);
      font-size: 12px;
      cursor: pointer;
      padding: 0;
    }
    .reset-link:disabled { opacity: 0.5; cursor: not-allowed; }

    .switch { position: relative; display: inline-block; width: 38px; height: 22px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0; cursor: pointer;
      background: var(--border); border-radius: 22px; transition: background var(--transition);
    }
    .slider::before {
      content: ''; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px;
      background: #fff; border-radius: 50%; transition: transform var(--transition);
    }
    .switch input:checked + .slider { background: var(--primary); }
    .switch input:checked + .slider::before { transform: translateX(16px); }
    .switch input:disabled + .slider { opacity: 0.6; cursor: not-allowed; }

    .loading-state {
      display: flex; align-items: center; justify-content: center;
      gap: var(--spacing-sm); padding: var(--spacing-xl);
      color: var(--text-secondary); font-size: 14px;
    }
    .form-error { color: var(--danger); font-size: 13px; margin-top: var(--spacing-md); }
    .animate-spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `]
})
export class NotificationSettingsComponent implements OnInit {
  prefs = signal<NotificationPreferences | null>(null);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);

  emailModes: EmailModeOption[] = [
    { value: 'NONE', label: 'Off', hint: 'No emails' },
    { value: 'INSTANT', label: 'Instant', hint: 'An email per change' },
    { value: 'HOURLY', label: 'Hourly', hint: 'Hourly digest' },
    { value: 'DAILY', label: 'Daily', hint: 'Daily digest' }
  ];

  constructor(private usersService: UsersService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.usersService.getNotificationPreferences().subscribe({
      next: (prefs) => {
        this.prefs.set(prefs);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load notification preferences');
        this.loading.set(false);
      }
    });
  }

  allOff(): boolean {
    const p = this.prefs();
    return !!p && p.emailMode === 'NONE' && p.pushMode === 'NONE';
  }

  depthOf(space: SpaceNotificationPref): number {
    return Math.max(0, space.fullPath.split('/').length - 1);
  }

  setEmailMode(mode: string): void {
    const p = this.prefs();
    if (!p || p.emailMode === mode) return;
    this.persist(p.pushMode, mode);
  }

  togglePush(): void {
    const p = this.prefs();
    if (!p) return;
    const next = p.pushMode === 'INSTANT' ? 'NONE' : 'INSTANT';
    this.persist(next, p.emailMode);
  }

  private persist(pushMode: string, emailMode: string): void {
    const p = this.prefs();
    if (!p) return;
    this.saving.set(true);
    this.error.set(null);
    // Optimistic update so the UI reacts immediately.
    this.prefs.set({ ...p, pushMode, emailMode });
    this.usersService.updateNotificationPreferences(pushMode, emailMode).subscribe({
      next: () => this.saving.set(false),
      error: () => {
        this.prefs.set(p);
        this.error.set('Failed to save preferences');
        this.saving.set(false);
      }
    });
  }

  toggleSpace(space: SpaceNotificationPref): void {
    const next = !space.enabled;
    this.saving.set(true);
    this.error.set(null);
    this.usersService.setSpaceNotification(space.spaceId, next).subscribe({
      next: () => {
        this.updateSpace(space.spaceId, { enabled: next, override: next });
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Failed to update space');
        this.saving.set(false);
      }
    });
  }

  resetSpace(space: SpaceNotificationPref): void {
    this.saving.set(true);
    this.error.set(null);
    this.usersService.clearSpaceNotification(space.spaceId).subscribe({
      next: () => {
        // Effective state can depend on a parent group override, so reload for accuracy.
        this.usersService.getNotificationPreferences().subscribe({
          next: (prefs) => {
            this.prefs.set(prefs);
            this.saving.set(false);
          },
          error: () => this.saving.set(false)
        });
      },
      error: () => {
        this.error.set('Failed to reset space');
        this.saving.set(false);
      }
    });
  }

  private updateSpace(spaceId: string, patch: Partial<SpaceNotificationPref>): void {
    const p = this.prefs();
    if (!p) return;
    this.prefs.set({
      ...p,
      spaces: p.spaces.map((s) => (s.spaceId === spaceId ? { ...s, ...patch } : s))
    });
  }
}
