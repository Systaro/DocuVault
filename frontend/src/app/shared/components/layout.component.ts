import { Component, signal, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { ChangelogService, ChangelogRelease, compareVersions } from '../../core/api/changelog.service';
import { GlobalSearchComponent } from './global-search.component';
import { HeaderSearchComponent } from './header-search.component';
import { HeaderNotificationsComponent } from './header-notifications.component';
import { ChangelogModalComponent } from './changelog-modal.component';
import { QuickCaptureModalComponent } from '../../features/inbox/quick-capture-modal.component';
import { APP_VERSION } from '../version';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, GlobalSearchComponent, HeaderSearchComponent, HeaderNotificationsComponent, ChangelogModalComponent, QuickCaptureModalComponent],
  template: `
    <div class="app-container">
      <!-- Header -->
      <header class="app-header">
        <div class="app-logo">
          <a routerLink="/dashboard" class="logo-link">
            <img [src]="themeService.darkMode() ? 'assets/logo_horiz_dark.png' : 'assets/logo_horiz.png'" alt="DocuVault" class="logo-img" />
          </a>
          <button class="app-version" (click)="openChangelog()" [title]="'Release notes for DocuVault ' + appVersion">{{ appVersion }}</button>
        </div>

        <nav class="header-nav">
          <a
            routerLink="/dashboard"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
            class="nav-link"
          >
            <span class="material-icons">dashboard</span>
            Dashboard
          </a>
          @if (authService.isAdmin()) {
            <a
              routerLink="/admin"
              routerLinkActive="active"
              class="nav-link"
            >
              <span class="material-icons">admin_panel_settings</span>
              Admin
            </a>
          }
        </nav>

        <div class="header-actions">
          <app-header-search class="desktop-search" />
          <button class="quick-note-btn" title="Quick Note (⌘K)" (click)="showCapture.set(true)">
            <span class="material-icons">add</span>
            Quick Note
          </button>
          <button class="icon-btn mobile-search-btn" title="Search" (click)="showSearch.set(true)">
            <span class="material-icons">search</span>
          </button>
          <app-header-notifications />
          <button class="icon-btn" (click)="themeService.toggle()" [title]="themeService.darkMode() ? 'Light mode' : 'Dark mode'">
            <span class="material-icons">{{ themeService.darkMode() ? 'light_mode' : 'dark_mode' }}</span>
          </button>
          @if (authService.isAdmin()) {
            <a routerLink="/admin/settings" class="icon-btn" title="Settings">
              <span class="material-icons">settings</span>
            </a>
          }
          <div class="header-user">
            <a routerLink="/account" class="avatar" [title]="authService.user()?.name || ''">
              {{ getInitials(authService.user()?.name) }}
            </a>
            <button (click)="authService.logout()" class="btn btn-ghost">
              <span class="material-icons">logout</span>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <!-- Impersonation Banner -->
      @if (authService.isImpersonating()) {
        <div class="impersonation-banner">
          <span class="material-icons">swap_horiz</span>
          <span>Viewing as <strong>{{ authService.user()?.name }}</strong></span>
          <button class="stop-btn" (click)="authService.stopImpersonation()">
            Stop Impersonating
          </button>
        </div>
      }

      <!-- Main content -->
      <main class="app-main">
        <ng-content></ng-content>
      </main>

      @if (showSearch()) {
        <app-global-search (close)="showSearch.set(false)" />
      }

      @if (showCapture()) {
        <app-quick-capture-modal (close)="showCapture.set(false)" />
      }

      @if (showChangelog()) {
        <app-changelog-modal [releases]="changelogReleases()" (dismiss)="dismissChangelog()" />
      }
    </div>
  `,
  styles: [`
    .app-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--background-darker);
    }

    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--spacing-xl);
      height: 64px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .app-logo {
      position: relative;
      display: flex;
      align-items: center;
      text-decoration: none;
      flex-shrink: 0;

      .logo-link {
        display: flex;
        align-items: center;
        text-decoration: none;
      }

      .logo-img {
        height: 40px;
        width: auto;
        object-fit: contain;
      }

      .app-version {
        position: absolute;
        top: -2px;
        right: -8px;
        transform: translateX(100%);
        font-size: 10px;
        font-weight: 500;
        line-height: 1;
        color: var(--text-secondary);
        opacity: 0.7;
        letter-spacing: 0.02em;
        white-space: nowrap;
        background: none;
        border: 0;
        padding: 0;
        font-family: inherit;
        cursor: pointer;
        transition: opacity var(--transition-fast);

        &:hover {
          opacity: 1;
          text-decoration: underline;
        }
      }
    }

    .header-nav {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      margin-left: var(--spacing-xl);
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-sm) var(--spacing-md);
      color: var(--text-primary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      border-radius: var(--radius-md);
      transition: all var(--transition);

      .material-icons {
        font-size: 20px;
      }

      &:hover {
        color: var(--primary-dark);
        background: var(--background);
      }

      &.active {
        color: var(--primary-dark);
        background: rgba(111, 179, 184, 0.15);
      }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }

    /* Inline search on desktop; icon-button + modal on small screens */
    .mobile-search-btn {
      display: none;
    }

    .quick-note-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 14px 6px 10px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition);
      font-family: inherit;

      .material-icons { font-size: 16px; }

      &:hover { background: var(--primary-dark); }
    }

    .header-user {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      margin-left: var(--spacing-sm);
      padding-left: var(--spacing-md);
      border-left: 1px solid var(--border);
    }

    .impersonation-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-xl);
      background: #f59e0b;
      color: #78350f;
      font-size: 14px;
      font-weight: 500;
      position: sticky;
      top: 64px;
      z-index: 99;

      .material-icons {
        font-size: 18px;
      }

      strong {
        font-weight: 700;
      }
    }

    .stop-btn {
      margin-left: var(--spacing-md);
      padding: 4px 12px;
      background: rgba(120, 53, 15, 0.15);
      color: #78350f;
      border: 1px solid rgba(120, 53, 15, 0.3);
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition);

      &:hover {
        background: rgba(120, 53, 15, 0.25);
      }
    }

    .app-main {
      flex: 1;
    }

    @media (max-width: 768px) {
      .app-header {
        padding: 0 var(--spacing-md);
      }

      .header-nav {
        display: none;
      }

      .header-user .btn {
        display: none;
      }

      .desktop-search {
        display: none;
      }

      .mobile-search-btn {
        display: flex;
      }
    }
  `]
})
export class LayoutComponent implements OnInit {
  private changelogService = inject(ChangelogService);

  showSearch = signal(false);
  showCapture = signal(false);
  showChangelog = signal(false);
  changelogReleases = signal<ChangelogRelease[]>([]);
  appVersion = APP_VERSION;

  constructor(public authService: AuthService, public themeService: ThemeService) {}

  ngOnInit(): void {
    const user = this.authService.user();
    if (!user) return;
    this.changelogService.unseenReleases(user.changelogSeenVersion).subscribe(releases => {
      if (!releases.length) return;
      this.changelogReleases.set(releases);
      this.showChangelog.set(true);
    });
  }

  /** Opening the log on purpose shows every shipped release, not just new ones. */
  openChangelog(): void {
    this.changelogService.allReleases().subscribe(releases => {
      this.changelogReleases.set(releases);
      this.showChangelog.set(true);
    });
  }

  dismissChangelog(): void {
    this.showChangelog.set(false);

    const newest = this.changelogReleases()[0]?.version;
    if (!newest) return;

    // Reopening an already-acknowledged log should not cost a round trip.
    const seen = this.authService.user()?.changelogSeenVersion;
    if (seen && compareVersions(newest, seen) <= 0) return;

    this.changelogService.markSeen(newest).subscribe({
      next: () => this.authService.patchUser({ changelogSeenVersion: newest }),
      error: () => {}
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      if (this.showCapture()) {
        this.showCapture.set(false);
      } else {
        this.showCapture.set(true);
      }
    }
  }

  getInitials(name: string | undefined): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }
}
