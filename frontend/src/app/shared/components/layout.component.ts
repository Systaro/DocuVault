import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <div class="app-container">
      <!-- Header -->
      <header class="app-header">
        <a routerLink="/dashboard" class="app-logo">
          <img src="assets/logo_horiz.png" alt="DocuVault" class="logo-img" />
        </a>

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
          <button class="icon-btn" title="Search">
            <span class="material-icons">search</span>
          </button>
          <button class="icon-btn" title="Notifications">
            <span class="material-icons">notifications</span>
          </button>
          @if (authService.isAdmin()) {
            <a routerLink="/admin/settings" class="icon-btn" title="Settings">
              <span class="material-icons">settings</span>
            </a>
          }
          <div class="header-user">
            <div class="avatar" [title]="authService.user()?.name || ''">
              {{ getInitials(authService.user()?.name) }}
            </div>
            <button (click)="authService.logout()" class="btn btn-ghost">
              <span class="material-icons">logout</span>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <!-- Main content -->
      <main class="app-main">
        <ng-content></ng-content>
      </main>
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
      display: flex;
      align-items: center;
      text-decoration: none;
      flex-shrink: 0;

      .logo-img {
        height: 40px;
        width: auto;
        object-fit: contain;
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

    .header-user {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      margin-left: var(--spacing-sm);
      padding-left: var(--spacing-md);
      border-left: 1px solid var(--border);
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
    }
  `]
})
export class LayoutComponent {
  constructor(public authService: AuthService) {}

  getInitials(name: string | undefined): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }
}
