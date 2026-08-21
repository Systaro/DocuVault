import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { UsersService, UnsubscribeInfo } from '../../core/api/users.service';

@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="unsub-page">
      <div class="unsub-card">
        <div class="unsub-logo">
          <span translate="no" class="material-icons">notifications_off</span>
        </div>

        @if (loadingInfo()) {
          <p class="muted">Loading…</p>
        } @else if (invalid()) {
          <h1>Link expired</h1>
          <p class="muted">This unsubscribe link is no longer valid. You can manage notifications from your account.</p>
          <a class="btn btn-ghost" href="/account">Manage notifications</a>
        } @else if (done()) {
          <h1>Done</h1>
          <p class="muted">{{ done()!.message }}</p>
          @if (canStopAll()) {
            <button class="btn btn-danger" [disabled]="working()" (click)="stopAll()">
              Also stop all DocuVault emails
            </button>
          }
          <a class="btn btn-ghost" href="/account">Manage preferences</a>
        } @else {
          @if (info()!.spaceName) {
            <h1>Mute {{ info()!.spaceName }}?</h1>
            <p class="muted">
              You'll stop getting notification emails about <strong>{{ info()!.spaceName }}</strong>
              for <strong>{{ info()!.email }}</strong>. Other spaces are unaffected.
            </p>
            <button class="btn btn-primary" [disabled]="working()" (click)="confirm()">
              {{ working() ? 'Working…' : 'Mute this space' }}
            </button>
          } @else {
            <h1>Unsubscribe from all emails?</h1>
            <p class="muted">
              This turns off all DocuVault notification emails for <strong>{{ info()!.email }}</strong>.
            </p>
            <button class="btn btn-danger" [disabled]="working()" (click)="confirm()">
              {{ working() ? 'Working…' : 'Unsubscribe from all' }}
            </button>
          }
          <a class="btn btn-ghost" href="/account">Manage preferences instead</a>
        }

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .unsub-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f0f2f5;
      padding: 20px;
    }
    .unsub-card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
      padding: 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
    }
    .unsub-logo {
      width: 56px;
      height: 56px;
      margin: 0 auto 20px;
      border-radius: 14px;
      background: linear-gradient(135deg, #4a8a8f, #6fb3b8);
      display: flex;
      align-items: center;
      justify-content: center;

      .material-icons { color: #fff; font-size: 28px; }
    }
    h1 { font-size: 20px; font-weight: 700; color: #222; margin: 0 0 12px; }
    .muted { color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
    .error { color: #dc2626; font-size: 13px; margin: 16px 0 0; }
    .btn {
      display: block;
      width: 100%;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      margin-bottom: 10px;
      text-decoration: none;
      box-sizing: border-box;
    }
    .btn:last-child { margin-bottom: 0; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, #4a8a8f, #6fb3b8); color: #fff; }
    .btn-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
    .btn-ghost { background: none; color: #6fb3b8; }
  `]
})
export class UnsubscribeComponent implements OnInit {
  loadingInfo = signal(true);
  invalid = signal(false);
  info = signal<UnsubscribeInfo | null>(null);
  working = signal(false);
  done = signal<{ message: string } | null>(null);
  error = signal<string | null>(null);

  private token = '';
  private spaceId?: string;

  constructor(private route: ActivatedRoute, private usersService: UsersService) {}

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.token = params.get('t') ?? '';
    this.spaceId = params.get('s') ?? undefined;

    if (!this.token) {
      this.invalid.set(true);
      this.loadingInfo.set(false);
      return;
    }

    this.usersService.getUnsubscribeInfo(this.token, this.spaceId).subscribe({
      next: (info) => {
        this.info.set(info);
        this.loadingInfo.set(false);
      },
      error: () => {
        this.invalid.set(true);
        this.loadingInfo.set(false);
      }
    });
  }

  canStopAll(): boolean {
    // Offer the "stop all" follow-up only after a space-scoped mute, and only if email isn't already off.
    return !!this.spaceId && this.info()?.emailMode !== 'NONE';
  }

  confirm(): void {
    this.runUnsubscribe(this.spaceId);
  }

  stopAll(): void {
    this.runUnsubscribe(undefined);
  }

  private runUnsubscribe(spaceId?: string): void {
    this.working.set(true);
    this.error.set(null);
    this.usersService.unsubscribe(this.token, spaceId).subscribe({
      next: (result) => {
        this.done.set({ message: result.message });
        // Once email is fully off, hide the "stop all" follow-up.
        if (!spaceId) {
          const current = this.info();
          if (current) this.info.set({ ...current, emailMode: 'NONE' });
        }
        this.working.set(false);
      },
      error: () => {
        this.error.set('Something went wrong. Please try again.');
        this.working.set(false);
      }
    });
  }
}
