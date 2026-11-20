import { Component, computed, input, output } from '@angular/core';
import { LivePeer } from '../../core/live/live-socket.service';
import { avatarGradient, getInitials, presenceColor } from '../utils/user-utils';

/** One person in a document, however many tabs they have it open in. */
export interface PresenceGroup {
  userId: string;
  name: string;
  editing: boolean;
  /** Where they are: their editing tab's heading, else a reading tab's. */
  section: string | null;
  /** The tab to jump to: an editing one with a cursor when there is one. */
  lead: LivePeer;
}

/** Collapses tabs into people: editors first, then by name. */
export function groupPeers(peers: LivePeer[]): PresenceGroup[] {
  const byUser = new Map<string, LivePeer[]>();
  for (const peer of peers) byUser.set(peer.userId, [...(byUser.get(peer.userId) ?? []), peer]);
  return [...byUser.values()]
    .map(tabs => {
      const lead = tabs.find(t => t.mode === 'edit' && t.clientId !== null)
        ?? tabs.find(t => t.mode === 'edit')
        ?? tabs.find(t => t.section)
        ?? tabs[0];
      return {
        userId: lead.userId,
        name: lead.name,
        editing: tabs.some(t => t.mode === 'edit'),
        section: lead.section ?? tabs.find(t => t.section)?.section ?? null,
        lead
      };
    })
    .sort((a, b) => Number(b.editing) - Number(a.editing) || a.name.localeCompare(b.name));
}

/**
 * The people in the open document besides you, as avatar chips: a pencil on
 * those editing, a tooltip with where they are, and a click that takes you there.
 */
@Component({
  selector: 'app-live-avatars',
  standalone: true,
  template: `
    @if (groups().length) {
      <div class="live-avatars" role="group" [attr.aria-label]="label()">
        @for (g of shown(); track g.userId) {
          <button
            type="button"
            class="live-avatar"
            [class.editing]="g.editing"
            [style.--presence]="ring(g.userId)"
            [style.background]="background(g.userId)"
            [title]="tooltip(g)"
            [attr.aria-label]="tooltip(g)"
            (click)="jump.emit(g)"
          >
            {{ initials(g.name) }}
            @if (g.editing) {
              <span translate="no" class="material-icons live-avatar-badge" aria-hidden="true">edit</span>
            }
          </button>
        }
        @if (hiddenCount() > 0) {
          <span class="live-avatar live-avatar-more" [title]="hiddenNames()">+{{ hiddenCount() }}</span>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: inline-flex; }

    .live-avatars {
      display: flex;
      align-items: center;
      padding-left: 6px;
    }

    .live-avatar {
      position: relative;
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      margin-left: -6px;
      border-radius: 9999px;
      border: 2px solid var(--surface);
      box-shadow: 0 0 0 2px transparent;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: transform 0.12s ease;

      &:hover { transform: translateY(-1px); z-index: 1; }
      &:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

      &.editing { box-shadow: 0 0 0 2px var(--presence); }
    }

    .live-avatar-badge {
      position: absolute;
      right: -4px;
      bottom: -4px;
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: var(--presence);
      border: 1.5px solid var(--surface);
      color: #fff;
      font-size: 9px;
      line-height: 11px;
      text-align: center;
    }

    .live-avatar-more {
      background: var(--text-muted);
      font-size: 10px;
      cursor: default;
    }
  `]
})
export class LiveAvatarsComponent {
  /** The people to show, grouped already (see groupPeers). */
  readonly people = input<PresenceGroup[]>([]);
  readonly max = input(5);
  readonly jump = output<PresenceGroup>();

  protected readonly groups = this.people;
  protected readonly shown = computed(() => this.groups().slice(0, this.max()));
  protected readonly hiddenCount = computed(() => Math.max(0, this.groups().length - this.max()));
  protected readonly hiddenNames = computed(() => this.groups().slice(this.max()).map(g => g.name).join(', '));
  protected readonly label = computed(() => {
    const n = this.groups().length;
    return n === 1 ? '1 other person in this document' : `${n} other people in this document`;
  });

  protected initials = getInitials;
  protected background = avatarGradient;
  protected ring = (userId: string) => presenceColor(userId);

  protected tooltip(g: PresenceGroup): string {
    const doing = g.editing ? 'editing' : 'reading';
    return g.section ? `${g.name} · ${doing} · ${g.section}` : `${g.name} · ${doing}`;
  }
}
