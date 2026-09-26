import { Injectable, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { ApiRequestService } from '../api/api-request.service';
import { HEX_COLOR, derivePalette, paletteCss } from './palette';

export interface Branding {
  appName: string;
  /** `#rrggbb`, or null for the stock palette. */
  primaryColor: string | null;
  /** Relative, cache-busted asset URLs; null when not uploaded. */
  logo: string | null;
  logoDark: string | null;
  favicon: string | null;
  customized: boolean;
}

/** Empty string resets a field to its default, null or absent leaves it unchanged. */
export interface UpdateBrandingRequest {
  appName?: string | null;
  primaryColor?: string | null;
}

export type BrandingAssetKind = 'logo' | 'logo-dark' | 'favicon';

export const DEFAULT_APP_NAME = 'DocuVault';

const DEFAULTS: Branding = {
  appName: DEFAULT_APP_NAME,
  primaryColor: null,
  logo: null,
  logoDark: null,
  favicon: null,
  customized: false
};

const PALETTE_STYLE_ID = 'branding-palette';
const FAVICON_SELECTOR = 'link[rel~="icon"], link[rel="apple-touch-icon"]';

@Injectable({ providedIn: 'root' })
export class BrandingService {
  private http = inject(HttpClient);
  private document = inject(DOCUMENT);
  private apiRequest = inject(ApiRequestService);
  private state = signal<Branding>(DEFAULTS);
  /** An unsaved colour shown app-wide while an admin is editing; undefined = none. */
  private previewColor: string | null | undefined;
  private defaultFavicons = new Map<HTMLLinkElement, { href: string; type: string | null; sizes: string | null }>();

  branding = this.state.asReadonly();
  appName = computed(() => this.state().appName);
  /** The instance runs under its own name, so the bundled product logo would be wrong. */
  customName = computed(() => this.state().appName !== DEFAULT_APP_NAME);

  /** Fetched once before the first render; an older backend without the endpoint keeps the defaults. */
  async load(): Promise<void> {
    try {
      this.update(await firstValueFrom(this.http.get<Branding>('/api/branding')));
    } catch {
      this.apply();
    }
  }

  /** Custom logo for the given background, falling back to the main one; null when none is uploaded. */
  logoFor(dark: boolean): string | null {
    const branding = this.state();
    return (dark ? branding.logoDark : null) ?? branding.logo;
  }

  update(branding: Branding): void {
    const assetUrl = (url: string | null | undefined) => (url ? this.apiRequest.url(url) : null);
    this.state.set({
      ...DEFAULTS,
      ...branding,
      appName: branding.appName || DEFAULT_APP_NAME,
      logo: assetUrl(branding.logo),
      logoDark: assetUrl(branding.logoDark),
      favicon: assetUrl(branding.favicon)
    });
    this.apply();
  }

  save(request: UpdateBrandingRequest): Observable<Branding> {
    return this.http.put<Branding>('/api/branding', request).pipe(tap(branding => this.update(branding)));
  }

  uploadAsset(kind: BrandingAssetKind, file: File): Observable<Branding> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<Branding>(`/api/branding/assets/${kind}`, formData).pipe(tap(branding => this.update(branding)));
  }

  deleteAsset(kind: BrandingAssetKind): Observable<Branding> {
    return this.http.delete<Branding>(`/api/branding/assets/${kind}`).pipe(tap(branding => this.update(branding)));
  }

  /** Shows a colour app-wide without saving it; `undefined` returns to the saved one. */
  preview(color: string | null | undefined): void {
    this.previewColor = color;
    this.applyPalette();
  }

  private apply(): void {
    this.applyPalette();
    this.applyFavicon();
  }

  private applyPalette(): void {
    const color = this.previewColor !== undefined ? this.previewColor : this.state().primaryColor;
    let style = this.document.getElementById(PALETTE_STYLE_ID);
    if (!color || !HEX_COLOR.test(color)) {
      style?.remove();
      return;
    }
    if (!style) {
      style = this.document.createElement('style');
      style.id = PALETTE_STYLE_ID;
    }
    style.textContent = paletteCss(derivePalette(color));
    // Last in <head>, so it wins over the stock theme rules of equal specificity.
    this.document.head.appendChild(style);
  }

  private applyFavicon(): void {
    const favicon = this.state().favicon;
    this.document.querySelectorAll<HTMLLinkElement>(FAVICON_SELECTOR).forEach(link => {
      if (!this.defaultFavicons.has(link)) {
        this.defaultFavicons.set(link, {
          href: link.getAttribute('href') ?? '',
          type: link.getAttribute('type'),
          sizes: link.getAttribute('sizes')
        });
      }
      const original = this.defaultFavicons.get(link)!;
      link.href = favicon ?? original.href;
      this.setOrRemove(link, 'type', favicon ? null : original.type);
      this.setOrRemove(link, 'sizes', favicon ? null : original.sizes);
    });
  }

  private setOrRemove(link: HTMLLinkElement, attribute: string, value: string | null): void {
    if (value === null) link.removeAttribute(attribute);
    else link.setAttribute(attribute, value);
  }
}
