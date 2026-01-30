import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private static readonly STORAGE_KEY = 'docuvault-theme';
  readonly darkMode = signal(false);

  constructor() {
    const stored = localStorage.getItem(ThemeService.STORAGE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefersDark;
    this.setTheme(isDark);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(ThemeService.STORAGE_KEY)) {
        this.setTheme(e.matches);
      }
    });
  }

  toggle(): void {
    const newValue = !this.darkMode();
    localStorage.setItem(ThemeService.STORAGE_KEY, newValue ? 'dark' : 'light');
    this.setTheme(newValue);
  }

  private setTheme(dark: boolean): void {
    this.darkMode.set(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
}
