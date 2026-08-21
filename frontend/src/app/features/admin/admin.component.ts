import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LayoutComponent } from '../../shared/components/layout.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, LayoutComponent],
  template: `
    <app-layout>
      <div class="admin-container">
        <!-- Breadcrumb -->
        <div class="breadcrumb-bar">
          <div class="breadcrumb">
            <span class="breadcrumb-item">
              <span translate="no" class="material-icons">home</span>
            </span>
            <span translate="no" class="material-icons breadcrumb-sep">chevron_right</span>
            <span class="breadcrumb-item active">Administration</span>
          </div>
        </div>

        <div class="admin-content">
          <div class="admin-layout">
            <!-- Sidebar Navigation -->
            <nav class="admin-sidebar">
              <div class="sidebar-section">
                <span class="sidebar-label">General</span>
                <a
                  routerLink="users"
                  routerLinkActive="active"
                  class="sidebar-link"
                >
                  <span translate="no" class="material-icons">group</span>
                  User Management
                </a>
                <a
                  routerLink="teams"
                  routerLinkActive="active"
                  class="sidebar-link"
                >
                  <span translate="no" class="material-icons">groups</span>
                  Teams
                </a>
                <a
                  routerLink="settings"
                  routerLinkActive="active"
                  class="sidebar-link"
                >
                  <span translate="no" class="material-icons">settings</span>
                  Settings
                </a>
              </div>
              <div class="sidebar-section">
                <span class="sidebar-label">Integrations</span>
                <a
                  routerLink="settings"
                  fragment="git"
                  routerLinkActive="active"
                  class="sidebar-link"
                >
                  <span translate="no" class="material-icons">cloud_sync</span>
                  Git Configuration
                </a>
                <a
                  routerLink="settings"
                  fragment="ai"
                  routerLinkActive="active"
                  class="sidebar-link"
                >
                  <span translate="no" class="material-icons">auto_awesome</span>
                  AI Settings
                </a>
              </div>
            </nav>

            <!-- Content -->
            <div class="admin-main">
              <router-outlet></router-outlet>
            </div>
          </div>
        </div>
      </div>
    </app-layout>
  `,
  styles: [`
    .admin-container {
      min-height: calc(100vh - 64px);
    }

    .breadcrumb-bar {
      padding: var(--spacing-md) var(--spacing-xl);
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 13px;
      color: var(--text-muted);
    }

    .breadcrumb-item {
      display: flex;
      align-items: center;

      .material-icons {
        font-size: 16px;
      }

      &.active {
        color: var(--text-primary);
        font-weight: 500;
      }
    }

    .breadcrumb-sep {
      font-size: 16px;
      color: var(--text-muted);
    }

    .admin-content {
      padding: var(--spacing-xl);
      max-width: 1400px;
      margin: 0 auto;
    }

    .admin-layout {
      display: flex;
      gap: var(--spacing-xl);
    }

    .admin-sidebar {
      width: 240px;
      flex-shrink: 0;
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      padding: var(--spacing-md);
      height: fit-content;
      position: sticky;
      top: 88px;
    }

    .sidebar-section {
      margin-bottom: var(--spacing-lg);

      &:last-child {
        margin-bottom: 0;
      }
    }

    .sidebar-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      padding: var(--spacing-sm) var(--spacing-md);
      margin-bottom: var(--spacing-xs);
    }

    .sidebar-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      border-radius: var(--radius-md);
      transition: all var(--transition);
      margin-bottom: 2px;

      .material-icons {
        font-size: 20px;
      }

      &:hover {
        color: var(--text-primary);
        background: var(--background);
      }

      &.active {
        color: var(--primary);
        background: rgba(111, 179, 184, 0.1);
      }
    }

    .admin-main {
      flex: 1;
      min-width: 0;
    }

    @media (max-width: 768px) {
      .admin-content {
        padding: var(--spacing-md);
      }

      .admin-layout {
        flex-direction: column;
      }

      .admin-sidebar {
        width: 100%;
        position: static;
      }
    }
  `]
})
export class AdminComponent {}
