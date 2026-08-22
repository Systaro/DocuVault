import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { LayoutComponent } from '../../shared/components/layout.component';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { SpaceComponent } from './space.component';
import { GroupComponent } from './group.component';

@Component({
  selector: 'app-space-router',
  standalone: true,
  imports: [CommonModule, RouterOutlet, LayoutComponent, SpaceComponent, GroupComponent],
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
    this.spacesService.getSpaceByPath(path).subscribe({
      next: (space) => {
        this.space.set(space);
        this.loading.set(false);
      },
      error: () => {
        this.space.set(null);
        this.loading.set(false);
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
