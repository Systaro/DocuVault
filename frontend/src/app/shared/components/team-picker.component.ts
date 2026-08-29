import { Component, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchableSelectComponent, SelectOption } from './searchable-select.component';
import { Team } from '../../core/api/teams.service';

/** Soft tint of a team's colour, for chips and badges. */
export function teamTint(color?: string): string {
  if (!color) return 'rgba(111, 179, 184, 0.12)';
  return `color-mix(in srgb, ${color} 14%, transparent)`;
}

/**
 * Picks the teams a person belongs to: a search field that only offers teams
 * they are not in yet, and a chip per team already chosen.
 *
 * Shared by the two places that assign teams — inviting someone and editing
 * them afterwards — because "which teams is this person in" should not look or
 * behave differently depending on whether the person has accepted yet.
 */
@Component({
  selector: 'app-team-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <app-searchable-select
      [options]="availableOptions()"
      [ngModel]="''"
      (ngModelChange)="add($event)"
      [placeholder]="placeholder()"
      searchPlaceholder="Search teams..."
    />

    @if (chosen().length > 0) {
      <div class="team-chips">
        @for (team of chosen(); track team.id) {
          <span class="team-chip" [style.background]="tint(team.color)">
            <span class="chip-dot" [style.background]="team.color || 'var(--primary)'"></span>
            <span class="chip-name">{{ team.name }}</span>
            <button
              type="button"
              class="chip-remove"
              (click)="remove(team.id)"
              [attr.aria-label]="'Remove from ' + team.name"
            >
              <span translate="no" class="material-icons">close</span>
            </button>
          </span>
        }
      </div>
    } @else {
      <p class="empty-hint">{{ emptyHint() }}</p>
    }
  `,
  styles: [`
    .team-chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin-top: var(--spacing-md);
    }

    .team-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: var(--radius-full);
      border: 1px solid var(--border);
    }

    .chip-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .chip-name {
      font-size: 13px;
      color: var(--text-primary);
    }

    .chip-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--text-muted);
      padding: 0 2px;

      .material-icons {
        font-size: 16px;
      }

      &:hover {
        color: var(--danger, #dc3545);
      }
    }

    .empty-hint {
      margin-top: var(--spacing-md);
      font-size: 13px;
      color: var(--text-muted);
      font-style: italic;
    }
  `]
})
export class TeamPickerComponent {
  teams = input.required<Team[]>();
  /** Ids of the teams currently chosen. */
  selected = model<string[]>([]);
  placeholder = input('Add to a team...');
  emptyHint = input('Not a member of any team.');

  /** A team was just added — the host may need to react, e.g. load its grants. */
  readonly added = output<string>();

  readonly tint = teamTint;

  availableOptions(): SelectOption[] {
    const taken = new Set(this.selected());
    return this.teams()
      .filter((team) => !taken.has(team.id))
      .map((team) => ({
        value: team.id,
        label: team.name,
        sublabel: `${team.spaceCount} space grant(s)`
      }));
  }

  chosen(): Team[] {
    const byId = new Map(this.teams().map((team) => [team.id, team]));
    return this.selected()
      .map((id) => byId.get(id))
      .filter((team): team is Team => !!team)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  add(teamId: string): void {
    if (!teamId || this.selected().includes(teamId)) return;
    this.selected.update((ids) => [...ids, teamId]);
    this.added.emit(teamId);
  }

  remove(teamId: string): void {
    this.selected.update((ids) => ids.filter((id) => id !== teamId));
  }
}
