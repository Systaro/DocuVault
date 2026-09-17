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
import { CommandPaletteComponent } from '../../features/ask/command-palette.component';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { APP_VERSION } from '../version';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, GlobalSearchComponent, HeaderSearchComponent, HeaderNotificationsComponent, ChangelogModalComponent, QuickCaptureModalComponent, CommandPaletteComponent],
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
            <span translate="no" class="material-icons">dashboard</span>
            Dashboard
          </a>
          @if (caps.aiChat()) {
            <a routerLink="/ask" routerLinkActive="active" class="nav-link">
              <span translate="no" class="material-icons">auto_awesome</span>
              Ask
            </a>
          }
          @if (authService.isAdmin()) {
            <a
              routerLink="/admin"
              routerLinkActive="active"
              class="nav-link"
            >
              <span translate="no" class="material-icons">admin_panel_settings</span>
              Admin
            </a>
          }
        </nav>

        <div class="header-actions">
          <app-header-search class="desktop-search" />
          <button class="quick-note-btn" title="Quick Note" (click)="openCapture('')">
            <span translate="no" class="material-icons">add</span>
            <span class="quick-note-label">Quick Note</span>
          </button>
          <button class="icon-btn mobile-search-btn" title="Search" (click)="showSearch.set(true)">
            <span translate="no" class="material-icons">search</span>
          </button>
          <app-header-notifications />
          <button class="icon-btn" (click)="themeService.toggle()" [title]="themeService.darkMode() ? 'Light mode' : 'Dark mode'">
            <span translate="no" class="material-icons">{{ themeService.darkMode() ? 'light_mode' : 'dark_mode' }}</span>
          </button>
          @if (authService.isAdmin()) {
            <a routerLink="/admin/settings" class="icon-btn" title="Settings">
              <span translate="no" class="material-icons">settings</span>
            </a>
          }
          <div class="header-user">
            <a routerLink="/account" class="avatar" [title]="authService.user()?.name || ''">
              {{ getInitials(authService.user()?.name) }}
            </a>
            <button (click)="authService.logout()" class="btn btn-ghost">
              <span translate="no" class="material-icons">logout</span>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <!-- Impersonation Banner -->
      @if (authService.isImpersonating()) {
        <div class="impersonation-banner">
          <span translate="no" class="material-icons">swap_horiz</span>
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
        <app-quick-capture-modal [initialText]="captureText()" (close)="showCapture.set(false)" />
      }

      @if (showPalette()) {
        <app-command-palette (closed)="showPalette.set(false)" (note)="openCapture($event)" />
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

      /* Reads as a chip rather than a passive label — it opens the full release
         log, which nobody discovers if it looks like static version text. */
      .app-version {
        position: absolute;
        top: -5px;
        right: -11px;
        transform: translateX(100%);
        font-size: 10px;
        font-weight: 500;
        line-height: 1;
        color: var(--text-secondary);
        opacity: 0.85;
        letter-spacing: 0.02em;
        white-space: nowrap;
        background: var(--background);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 3px 8px;
        font-family: inherit;
        cursor: pointer;
        transition: color var(--transition-fast), border-color var(--transition-fast),
                    opacity var(--transition-fast);

        &:hover {
          opacity: 1;
          color: var(--primary);
          border-color: var(--primary);
        }
      }
    }

    .header-nav {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      margin-left: var(--spacing-xl);
    }

    /* Every label in this bar stays on one line. Browser page translation
       (Chrome's "Translate this page") makes them noticeably longer — "Quick
       Note" becomes "Kurzer Hinweis" — and a wrapped label breaks the fixed
       64px header instead of just taking more width. */
    .nav-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-sm) var(--spacing-md);
      white-space: nowrap;
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
      white-space: nowrap;
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

      .btn {
        white-space: nowrap;
      }
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

    // The bar is one fixed 64px row and nothing in it shrinks, so on a phone it
    // simply ran past the viewport — 375px of actions in 244px of room — and
    // made the *whole page* pan sideways. That is why a document appeared to
    // scroll horizontally as a whole: the header, not the document, was too
    // wide. Everything below is about getting the row under the viewport width;
    // nothing is dropped that has no other way in, because .header-nav is
    // already gone here and admin settings would otherwise be unreachable.
    @media (max-width: 768px) {
      .app-header {
        padding: 0 10px;
        gap: var(--spacing-xs);
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

      // The wordmark is the one element with slack: it is a horizontal lockup
      // and reads fine smaller, while every icon next to it is already at the
      // floor of a comfortable tap target.
      .logo-img {
        max-width: 88px;
        height: auto;
      }

      .header-actions {
        gap: var(--spacing-xs);
      }

      // Icon only. The label is the single biggest item in the row (114px of
      // 375) and the icon plus the title attribute carry the same meaning.
      .quick-note-btn {
        width: 36px;
        height: 36px;
        padding: 0;
        gap: 0;
        justify-content: center;
      }

      .quick-note-label {
        display: none;
      }

      .header-user {
        margin-left: var(--spacing-xs);
        padding-left: var(--spacing-sm);
      }

      .avatar {
        width: 32px;
        height: 32px;
      }
    }

    // A second tier for the narrow end of the range (320-400px). Same idea,
    // one notch tighter — measured at 320px, which is where the first tier
    // still ran 19px over.
    @media (max-width: 400px) {
      .app-header {
        padding: 0 var(--spacing-sm);
      }

      .logo-img {
        max-width: 68px;
      }

      .header-actions {
        gap: 2px;
      }

      .quick-note-btn {
        width: 32px;
        height: 32px;
      }

      .header-user {
        margin-left: 2px;
        padding-left: 6px;
      }
    }
  `]
})
export class LayoutComponent implements OnInit {
  private changelogService = inject(ChangelogService);

  showSearch = signal(false);
  showCapture = signal(false);
  captureText = signal('');
  showPalette = signal(false);
  caps = inject(CapabilitiesService);
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

  /** Cmd+K toggles the command palette, which can also start a quick note. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.showCapture.set(false);
      this.showPalette.update(open => !open);
    }
  }

  openCapture(text: string): void {
    this.showPalette.set(false);
    this.captureText.set(text);
    this.showCapture.set(true);
  }

  getInitials(name: string | undefined): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }
}
