import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './shared/components/toast.component';
import { AuthService } from './core/auth/auth.service';
import { PushNotificationService } from './core/push/push-notification.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastComponent],
  template: `
    <router-outlet></router-outlet>
    <app-toast-container></app-toast-container>
  `
})
export class AppComponent {
  private auth = inject(AuthService);
  private push = inject(PushNotificationService);

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.push.initialize().catch(() => {});
      }
    });
  }
}
