import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { LayoutComponent } from '../../shared/components/layout.component';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { SpaceComponent } from './space.component';
import { GroupComponent } from './group.component';

@Component({
  selector: 'app-space-router',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, LayoutComponent, SpaceComponent, GroupComponent],
  template: `
    @if (loading()) {
      <app-layout>
        <div class="loading-container">
          <span translate="no" class="material-icons animate-spin">sync</span>
          <p>Loading...</p>
        </div>
      </app-layout>
    } @else if (space()) {
      @if (space()!.type === 'GROUP') {
        @if (childRoute()) {
          <app-layout>
            <router-outlet></router-outlet>
          </app-layout>
        } @else {
          <app-group [space]="space()!" [fullPath]="fullPath()"></app-group>
        }
      } @else {
        <app-space [space]="space()!" [fullPath]="fullPath()"></app-space>
      }
    } @else if (noAccess()) {
      <app-layout>
        <div class="error-container access-state">
          <span translate="no" class="material-icons access-icon">lock</span>
          <h2>You don't have access</h2>
          <p>
            <strong>{{ fullPath() }}</strong> exists, but your account can't open it.
            Ask the people who look after it to let you in.
          </p>

          @if (requestState() === 'form') {
            <textarea
              class="access-note"
              [(ngModel)]="requestMessage"
              rows="3"
              maxlength="1000"
              placeholder="Add a note (optional) — say why you need it"
            ></textarea>
            <div class="access-actions">
              <button class="btn btn-primary" (click)="requestAccess()" [disabled]="requesting()">
                <span translate="no" class="material-icons">{{ requesting() ? 'hourglass_empty' : 'lock_open' }}</span>
                {{ requesting() ? 'Sending…' : 'Request access' }}
              </button>
              <button class="btn" (click)="goToDashboard()">Go to Dashboard</button>
            </div>
          } @else {
            <p class="access-result" [class.access-warn]="requestState() === 'warn'">
              <span translate="no" class="material-icons">{{ requestState() === 'warn' ? 'info' : 'check_circle' }}</span>
              {{ requestResult() }}
            </p>
            <button class="btn" (click)="goToDashboard()">
              <span translate="no" class="material-icons">home</span>
              Go to Dashboard
            </button>
          }
        </div>
      </app-layout>
    } @else {
      <app-layout>
        <div class="error-container">
          <span translate="no" class="material-icons">error_outline</span>
          <h2>Not Found</h2>
          <p>The requested workspace could not be found.</p>
          <button class="btn btn-primary" (click)="goToDashboard()">
            <span translate="no" class="material-icons">home</span>
            Go to Dashboard
          </button>
        </div>
      </app-layout>
    }
  `,
  styles: [`
    /* Not an error: no access is a state to act on, so it keeps the accent
       colour rather than the danger red this container applies by default. */
    .error-container.access-state .material-icons { color: var(--primary); }

    /* The container sizes its one hero icon at 48px; icons sitting inline in a
       button or a status line have to opt out of that and of its margin. */
    .error-container.access-state .btn .material-icons,
    .error-container.access-state .access-result .material-icons {
      font-size: 18px;
      margin-bottom: 0;
    }

    .error-container.access-state .btn .material-icons { color: inherit; }

    .access-note {
      width: min(100%, 420px);
      margin: 4px 0 4px;
      padding: 10px 12px;
      font: inherit;
      font-size: 13px;
      color: var(--text-primary);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      resize: vertical;

      &:focus { outline: none; border-color: var(--primary); }
    }

    .access-actions { display: flex; gap: 8px; align-items: center; }

    .access-result {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--primary-dark);

      .material-icons { font-size: 18px; }
    }

    .access-result.access-warn { color: var(--text-secondary); }

    .loading-container, .error-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: calc(100vh - 64px);
      text-align: center;

      .material-icons {
        font-size: 48px;
        color: var(--primary);
        margin-bottom: var(--spacing-md);
      }

      h2 {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: var(--spacing-sm);
      }

      p {
        color: var(--text-muted);
        margin-bottom: var(--spacing-lg);
      }
    }

    .error-container .material-icons {
      color: var(--danger, #dc3545);
    }
  `]
})
export class SpaceRouterComponent implements OnInit {
  space = signal<Space | null>(null);
  loading = signal(true);
  /** The space exists but this account cannot open it — a 403, not a 404. */
  noAccess = signal(false);
  requestState = signal<'form' | 'done' | 'warn'>('form');
  requestResult = signal('');
  requesting = signal(false);
  requestMessage = '';
  fullPath = signal<string>('');
  childRoute = signal<string | null>(null);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(() => {
      this.loadSpace();
    });

    this.updateChildRoute();
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.updateChildRoute());
  }

  private updateChildRoute(): void {
    const childPath = this.route.firstChild?.snapshot.url[0]?.path || null;
    this.childRoute.set(childPath);
  }

  private loadSpace(): void {
    const path = this.buildFullPath();
    this.fullPath.set(path);

    if (!path) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.noAccess.set(false);
    this.requestState.set('form');
    this.requestMessage = '';
    this.spacesService.getSpaceByPath(path).subscribe({
      next: (space) => {
        this.space.set(space);
        this.loading.set(false);
      },
      error: (err) => {
        // 403 means it is there and they simply cannot see it — worth saying so,
        // and worth offering a way in, rather than claiming it does not exist.
        this.noAccess.set(err?.status === 403);
        this.space.set(null);
        this.loading.set(false);
      }
    });
  }

  requestAccess(): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    this.spacesService.requestAccess(this.fullPath(), this.requestMessage.trim() || undefined)
      .subscribe({
        next: (res) => {
          this.requesting.set(false);
          this.requestResult.set(res.message);
          // Anything but a clean send is worth showing differently: the request
          // may have reached nobody, and silently looking successful would leave
          // someone waiting for an answer that is never coming.
          this.requestState.set(res.status === 'SENT' ? 'done' : 'warn');
        },
        error: () => {
          this.requesting.set(false);
          this.requestResult.set('The request could not be sent. Please try again, or ask an administrator directly.');
          this.requestState.set('warn');
        }
      });
  }

  private buildFullPath(): string {
    const snapshot = this.route.snapshot;
    const parts: string[] = [];

    if (snapshot.params['path1']) parts.push(snapshot.params['path1']);
    if (snapshot.params['path2']) parts.push(snapshot.params['path2']);
    if (snapshot.params['path3']) parts.push(snapshot.params['path3']);

    return parts.join('/');
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
