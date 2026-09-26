import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { BrandingService } from './branding.service';

/**
 * The single place that writes the browser tab title: most specific part
 * first, the instance's app name last, so a rename shows up in every tab.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleService {
  private branding = inject(BrandingService);
  private parts = signal<string[]>([]);

  readonly title = computed(() => [...this.parts(), this.branding.appName()].join(' – '));

  constructor() {
    const titleService = inject(Title);
    effect(() => titleService.setTitle(this.title()));
  }

  /** Empty or missing parts are skipped; no parts leaves just the app name. */
  set(...parts: (string | null | undefined)[]): void {
    this.parts.set(parts.filter((part): part is string => !!part));
  }
}
