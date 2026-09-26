import { Component, computed, inject, input } from '@angular/core';
import { BrandingService } from '../../core/branding/branding.service';

/**
 * The instance's logo. Shows the uploaded logo (the dark-background variant on
 * dark surfaces), a text wordmark when the instance was renamed without a
 * logo, and the bundled product artwork otherwise.
 *
 * Size is set by the parent through `--brand-logo-max-height` and
 * `--brand-logo-max-width` (uploaded logo),
 * `--brand-mark-width` (bundled mark) and `--brand-text-size`; text and the
 * fallback icon take the parent's `color`.
 */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  template: `
    @if (customLogo(); as src) {
      <img class="custom" [src]="src" [alt]="branding.appName()" />
    } @else if (branding.customName()) {
      <span class="wordmark">{{ branding.appName() }}</span>
    } @else if (variant() === 'wordmark') {
      <img class="bundled-wordmark" [src]="onDark() ? 'assets/logo_horiz_dark.png' : 'assets/logo_horiz.png'" [alt]="branding.appName()" />
    } @else if (onDark()) {
      <img class="bundled-mark" src="assets/logo.png" [alt]="branding.appName()" />
    } @else {
      <span translate="no" class="material-icons">menu_book</span>
      <span class="wordmark">{{ branding.appName() }}</span>
    }
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
      min-width: 0;
    }

    .custom {
      display: block;
      max-height: var(--brand-logo-max-height, 32px);
      max-width: min(var(--brand-logo-max-width, 220px), 100%);
    }

    .bundled-wordmark {
      display: block;
      max-height: 40px;
      max-width: 100%;
    }

    .bundled-mark {
      display: block;
      width: var(--brand-mark-width, 200px);
      max-width: 100%;
      height: auto;
    }

    .wordmark {
      font-size: var(--brand-text-size, 20px);
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .material-icons {
      font-size: calc(var(--brand-text-size, 20px) * 1.5);
    }
  `]
})
export class BrandLogoComponent {
  protected branding = inject(BrandingService);

  /** `wordmark` for the app header, `mark` for auth panels and public pages. */
  variant = input<'wordmark' | 'mark'>('mark');
  /** Whether the logo sits on a dark background. */
  onDark = input(false);

  protected customLogo = computed(() => this.branding.logoFor(this.onDark()));
}
