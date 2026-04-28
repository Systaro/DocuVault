import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'docuvault.native.token';

@Injectable({ providedIn: 'root' })
export class NativeTokenStore {
  private cached: string | null = null;
  private hydrated = false;

  async load(): Promise<string | null> {
    if (this.hydrated) {
      return this.cached;
    }
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    this.cached = value ?? null;
    this.hydrated = true;
    return this.cached;
  }

  get(): string | null {
    return this.cached;
  }

  async set(token: string): Promise<void> {
    this.cached = token;
    this.hydrated = true;
    await Preferences.set({ key: TOKEN_KEY, value: token });
  }

  async clear(): Promise<void> {
    this.cached = null;
    this.hydrated = true;
    await Preferences.remove({ key: TOKEN_KEY });
  }
}
