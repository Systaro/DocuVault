import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { Space } from '../../core/api/spaces.service';
import { DraftTemplate } from '../../core/api/ai.service';
import { rememberedSpaceId } from './ask-composer.component';

export interface DraftSubmission {
  spaceId: string;
  template: DraftTemplate;
  days: number;
  message: string;
}

/** Starts a conversation that writes a draft from what happened in a space. */
@Component({
  selector: 'app-draft-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="modal-overlay" (click)="cancelled.emit()">
      <form class="modal draft-modal" role="dialog" aria-labelledby="draft-title" (click)="$event.stopPropagation()" (ngSubmit)="submit()">
        <div class="modal-header">
          <h2 id="draft-title"><span translate="no" class="material-icons">edit_document</span>Write a draft</h2>
          <button type="button" class="icon-btn" (click)="cancelled.emit()" title="Close">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-hint intro">The draft is written from the notes, meeting notes, tasks and changed documents of the period. Nothing is saved until you save it.</p>

          <div class="field">
            <span class="field-label">What</span>
            <div class="template-options" role="radiogroup" aria-label="Kind of draft">
              @for (option of templates; track option.value) {
                <label class="template-option" [class.selected]="template() === option.value">
                  <input type="radio" name="template" [value]="option.value" [checked]="template() === option.value" (change)="template.set(option.value)" />
                  <span translate="no" class="material-icons">{{ option.icon }}</span>
                  <span class="option-text">
                    <span class="option-title">{{ option.label }}</span>
                    <span class="option-sub">{{ option.hint }}</span>
                  </span>
                </label>
              }
            </div>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">Space</span>
              <app-searchable-select name="space" [options]="spaceOptions()" [ngModel]="spaceId()" (ngModelChange)="spaceId.set($event)" placeholder="Choose a space" />
            </label>
            <label class="field period">
              <span class="field-label">Period</span>
              <app-searchable-select name="days" [options]="periodOptions" [ngModel]="days()" (ngModelChange)="days.set($event)" [searchable]="false" />
            </label>
          </div>

          <label class="field">
            <span class="field-label">{{ template() === 'CUSTOM' ? 'What should it be?' : 'Anything to add (optional)' }}</span>
            <textarea class="input" name="instructions" rows="3" [(ngModel)]="instructions"
              [placeholder]="template() === 'CUSTOM' ? 'e.g. A short update for the customer about the move to the new office' : 'e.g. Keep it under a page, in German'"></textarea>
          </label>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
            <span translate="no" class="material-icons">auto_awesome</span>Write draft
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .draft-modal { width: 600px; }

    .intro { margin: 0 0 var(--spacing-md); }

    .field {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      margin-bottom: var(--spacing-md);

      textarea { resize: vertical; font: inherit; }
    }

    .field-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

    .field-row {
      display: flex;
      gap: var(--spacing-md);

      .period { flex: 0 0 170px; }
      @media (max-width: 520px) { flex-direction: column; gap: 0; .period { flex: 1; } }
    }

    .template-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--spacing-sm);
    }

    .template-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      cursor: pointer;

      input { position: absolute; opacity: 0; pointer-events: none; }
      .material-icons { font-size: 20px; color: var(--primary-dark); }
      &.selected { border-color: var(--primary-dark); background: var(--background-darker); }
      &:focus-within { outline: 2px solid var(--primary); outline-offset: 1px; }
    }

    .option-text { display: flex; flex-direction: column; gap: 2px; }
    .option-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .option-sub { font-size: 12px; color: var(--text-muted); }
  `]
})
export class DraftDialogComponent {
  spaces = input<Space[]>([]);
  initialSpaceId = input<string | null>(null);

  submitted = output<DraftSubmission>();
  cancelled = output<void>();

  template = signal<DraftTemplate>('STATUS_REPORT');
  spaceId = signal<string | null>(null);
  days = signal(7);
  instructions = '';

  readonly templates: { value: DraftTemplate; label: string; hint: string; icon: string }[] = [
    { value: 'STATUS_REPORT', label: 'Status report', hint: 'What happened, done, open, next', icon: 'summarize' },
    { value: 'MEETING_PROTOCOL', label: 'Meeting protocol', hint: 'From the latest meeting note', icon: 'groups' },
    { value: 'CUSTOM', label: 'Something else', hint: 'Describe it below', icon: 'edit_note' }
  ];

  readonly periodOptions: SelectOption[] = [
    { value: 7, label: 'Last 7 days' },
    { value: 14, label: 'Last 14 days' },
    { value: 30, label: 'Last 30 days' }
  ];

  spaceOptions = computed<SelectOption[]>(() => {
    const byId = new Map(this.spaces().map(s => [s.id, s]));
    return this.spaces()
      .filter(s => s.type === 'REPOSITORY')
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      .map(s => ({ value: s.id, label: s.name, group: s.parentId ? byId.get(s.parentId)?.name : undefined }));
  });

  constructor() {
    // The page may still be loading its spaces when the dialog opens.
    effect(() => {
      const repositories = this.spaces().filter(s => s.type === 'REPOSITORY');
      if (!repositories.length || untracked(this.spaceId)) return;
      const wanted = [this.initialSpaceId(), rememberedSpaceId()].find(id => id && repositories.some(s => s.id === id));
      this.spaceId.set(wanted ?? repositories[0].id);
    }, { allowSignalWrites: true });
  }

  canSubmit(): boolean {
    return !!this.spaceId() && (this.template() !== 'CUSTOM' || this.instructions.trim().length > 0);
  }

  submit(): void {
    const space = this.spaces().find(s => s.id === this.spaceId());
    if (!space || !this.canSubmit()) return;
    const extra = this.instructions.trim();
    const period = `the last ${this.days()} days`;
    const base = {
      STATUS_REPORT: `Write a status report for ${space.name} covering ${period}.`,
      MEETING_PROTOCOL: `Write a protocol of the latest meeting in ${space.name}.`,
      CUSTOM: `${extra} (Use what happened in ${space.name} over ${period}.)`
    }[this.template()];
    const message = this.template() !== 'CUSTOM' && extra ? `${base} ${extra}` : base;
    this.submitted.emit({ spaceId: space.id, template: this.template(), days: this.days(), message });
  }
}
