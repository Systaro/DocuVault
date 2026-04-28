import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

@Injectable({ providedIn: 'root' })
export class PlatformService {
  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  platform(): 'ios' | 'android' | 'web' {
    return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
  }

  async deviceLabel(): Promise<string> {
    if (!this.isNative()) {
      return 'Web';
    }
    const info = await Device.getInfo();
    const model = info.model || info.name || 'Device';
    const platform = info.platform.charAt(0).toUpperCase() + info.platform.slice(1);
    return `${platform} ${model}`.trim();
  }
}
