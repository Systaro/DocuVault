import { Component, inject } from '@angular/core';
import { BackendHealthService } from '../../core/services/backend-health.service';

@Component({
  selector: 'app-backend-status-banner',
  standalone: true,
  template: `
    @if (health.isDown()) {
      <div class="backend-banner" role="alert" aria-live="assertive">
        <svg class="backend-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span class="backend-banner__text">
          DocuVault is having trouble reaching the server &mdash; it may be down for maintenance. We&rsquo;ll be right back.
        </span>
      </div>
    }
  `,
  styles: [`
    .backend-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 10px 16px;
      background: var(--error);
      color: #ffffff;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.3;
      text-align: center;
      box-shadow: var(--shadow-md);
      animation: backendBannerDrop 0.25s ease;
    }

    @keyframes backendBannerDrop {
      from {
        transform: translateY(-100%);
      }
      to {
        transform: translateY(0);
      }
    }

    .backend-banner__icon {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
    }

    .backend-banner__text {
      min-width: 0;
    }
  `]
})
export class BackendStatusBannerComponent {
  health = inject(BackendHealthService);
}
