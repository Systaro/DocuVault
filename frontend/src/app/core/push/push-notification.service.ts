import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed
} from '@capacitor/push-notifications';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from '../platform/platform.service';

interface RegisterPushTokenRequest {
  platform: 'ios' | 'android';
  token: string;
  deviceName: string;
}

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private http = inject(HttpClient);
  private platform = inject(PlatformService);
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized || !this.platform.isNative()) {
      return;
    }
    this.initialized = true;

    const permission = await PushNotifications.checkPermissions();
    let granted = permission.receive === 'granted';

    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      const result = await PushNotifications.requestPermissions();
      granted = result.receive === 'granted';
    }

    if (!granted) {
      return;
    }

    PushNotifications.addListener('registration', (token: Token) => {
      this.sendTokenToBackend(token.value).catch(err => {
        console.error('Failed to register push token with backend', err);
      });
    });

    PushNotifications.addListener('registrationError', err => {
      console.error('Push registration error', err);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('Push received', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('Push action performed', action);
    });

    await PushNotifications.register();
  }

  private async sendTokenToBackend(token: string): Promise<void> {
    const deviceName = await this.platform.deviceLabel();
    const platform = this.platform.platform() as 'ios' | 'android';
    const body: RegisterPushTokenRequest = { platform, token, deviceName };
    await firstValueFrom(
      this.http.post('/api/users/me/push-tokens', body)
    );
  }
}
