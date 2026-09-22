import { Component, computed, input } from '@angular/core';

export interface SpaceAvatarSource {
  name: string;
  logoUrl?: string | null;
  type?: 'REPOSITORY' | 'GROUP' | string;
}

/**
 * A space as the dashboard shows it: its logo, else a folder tile for a group
 * or the first letter for a repository.
 */
@Component({
  selector: 'app-space-avatar',
  standalone: true,
  host: { '[class]': '"size-" + size()' },
  template: `
    @if (space().logoUrl) {
      <img class="avatar logo" [src]="space().logoUrl" alt="" />
    } @else if (space().type === 'GROUP') {
      <span class="avatar group" aria-hidden="true">
        <span translate="no" class="material-icons">folder</span>
      </span>
    } @else {
      <span class="avatar letter" aria-hidden="true">{{ letter() }}</span>
    }
  `,
  styles: [`
    :host {
      --avatar-size: 24px;
      display: inline-flex;
      flex-shrink: 0;
    }
    :host(.size-sm) { --avatar-size: 20px; }
    :host(.size-lg) { --avatar-size: 32px; }

    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--avatar-size);
      height: var(--avatar-size);
      border-radius: calc(var(--avatar-size) * 0.28);
      overflow: hidden;
      color: #fff;
    }

    .logo { object-fit: cover; background: var(--surface); }

    .group {
      background: linear-gradient(135deg, var(--accent-400, #f0ad4e) 0%, var(--accent-500, #ec971f) 100%);
      .material-icons { font-size: calc(var(--avatar-size) * 0.62); }
    }

    .letter {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      font-size: calc(var(--avatar-size) * 0.5);
      font-weight: 700;
      line-height: 1;
    }
  `]
})
export class SpaceAvatarComponent {
  space = input.required<SpaceAvatarSource>();
  size = input<'sm' | 'md' | 'lg'>('md');

  letter = computed(() => this.space().name.trim().charAt(0).toUpperCase() || '?');
}
