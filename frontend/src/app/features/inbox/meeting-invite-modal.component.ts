import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { MeetingService, MeetingInvite, meetingPhaseLabel } from '../../core/api/meeting.service';
import { ToastService } from '../../shared/services/toast.service';

/**
 * Creates and manages meeting transcription invites for a space. Each invite
 * hands the DocuVault meeting bot a one-time token; the bot joins a call,
 * transcribes it, and files the notes into this space's inbox.
 */
@Component({
  selector: 'app-meeting-invite-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal-box" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <h3>
            <span class="material-icons">graphic_eq</span>
            Meeting transkribieren
          </h3>
          <button class="icon-btn" (click)="close.emit()">
            <span class="material-icons">close</span>
          </button>
        </div>

        <p class="intro">
          Erzeuge ein Einmal-Token, gib es dem DocuVault-Bot in Discord
          (<code>/transcribe</code>), und das Protokoll landet danach in der Inbox dieses Spaces.
        </p>

        <!-- Create form -->
        <div class="create-row">
          <input
            type="text"
            class="input"
            [(ngModel)]="labelInput"
            placeholder="Meeting-Bezeichnung, z. B. Sprint Planning"
            (keyup.enter)="create()"
          />
          <button class="btn btn-primary" [disabled]="creating() || !labelInput.trim()" (click)="create()">
            <span class="material-icons">add</span>
            {{ creating() ? 'Erzeuge…' : 'Token erzeugen' }}
          </button>
        </div>

        <!-- Freshly created token -->
        @if (createdInvite(); as inv) {
          <div class="token-box">
            <div class="token-box-head">
              <span class="material-icons">vpn_key</span>
              Token für „{{ inv.label }}" — nur jetzt sichtbar
            </div>
            <div class="token-line">
              <code class="token">{{ inv.token }}</code>
              <button class="btn btn-ghost btn-sm" (click)="copy(inv.token!)">
                <span class="material-icons">content_copy</span>
              </button>
            </div>
            <div class="cmd-hint">
              In Discord eingeben:
              <code>/transcribe token:{{ inv.token }}</code>
              <button class="btn btn-ghost btn-sm" (click)="copy('/transcribe token:' + inv.token)">
                <span class="material-icons">content_copy</span>
              </button>
            </div>
          </div>
        }

        <!-- Invite history -->
        <div class="history">
          <div class="history-head">Letzte Meetings</div>
          @if (loading()) {
            <div class="muted">Lade…</div>
          } @else if (invites().length === 0) {
            <div class="muted">Noch keine Meeting-Invites in diesem Space.</div>
          } @else {
            @for (inv of invites(); track inv.id) {
              <div class="invite-row">
                <div class="invite-main">
                  <span class="invite-label">{{ inv.label }}</span>
                  <span class="invite-sub">
                    {{ inv.createdAt | date:'d. MMM, HH:mm' }}
                    @if (inv.noteCount > 0) { · {{ inv.noteCount }} Notizen }
                    @if (inv.participants) { · {{ inv.participants }} }
                  </span>
                  @if (inv.status === 'ACTIVE') {
                    <div class="live-progress">
                      <span class="material-icons spinning">graphic_eq</span>
                      <span class="live-text">{{ phaseLabel(inv) }}</span>
                      @if (inv.progressTotal) {
                        <span class="live-count">{{ inv.progressCurrent ?? 0 }}/{{ inv.progressTotal }}</span>
                        <span class="live-bar">
                          <span class="live-bar-fill" [style.width.%]="progressPct(inv)"></span>
                        </span>
                      }
                    </div>
                  }
                  @if (inv.error) {
                    <span class="invite-error">{{ inv.error }}</span>
                  }
                </div>
                <span class="status" [class]="'status-' + inv.status.toLowerCase()">
                  {{ statusLabel(inv.status) }}
                </span>
                @if (inv.status === 'PENDING') {
                  <button class="btn btn-ghost btn-sm" (click)="cancel(inv)" title="Token zurückziehen">
                    <span class="material-icons">delete_outline</span>
                  </button>
                }
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 300;
    }
    .modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl, 12px);
      padding: 22px;
      width: 540px; max-width: 95vw;
      max-height: 88vh; overflow-y: auto;
      display: flex; flex-direction: column; gap: 14px;
    }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between;
    }
    .modal-head h3 {
      display: flex; align-items: center; gap: 8px;
      font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0;
    }
    .modal-head .material-icons { color: var(--primary); }
    .icon-btn {
      border: none; background: transparent; cursor: pointer;
      color: var(--text-muted); display: flex;
    }
    .intro { font-size: 13px; color: var(--text-secondary); line-height: 1.55; margin: 0; }
    .intro code, .cmd-hint code {
      background: var(--surface-raised, rgba(0,0,0,0.05));
      padding: 1px 5px; border-radius: 4px; font-size: 12px;
    }
    .create-row { display: flex; gap: 8px; }
    .create-row .input { flex: 1; }

    .token-box {
      background: rgba(111, 179, 184, 0.08);
      border: 1px solid var(--primary);
      border-radius: var(--radius-lg, 8px);
      padding: 12px 14px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .token-box-head {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: var(--primary-dark);
    }
    .token-box-head .material-icons { font-size: 15px; }
    .token-line { display: flex; align-items: center; gap: 6px; }
    .token {
      flex: 1; font-size: 12px; word-break: break-all;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; padding: 6px 8px;
    }
    .cmd-hint {
      font-size: 11px; color: var(--text-secondary);
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }

    .history { display: flex; flex-direction: column; gap: 6px; }
    .history-head {
      font-size: 12px; font-weight: 600; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.04em;
      border-top: 1px solid var(--border); padding-top: 12px;
    }
    .muted { font-size: 13px; color: var(--text-muted); padding: 6px 0; }

    .invite-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 8px);
    }
    .invite-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .invite-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .invite-sub { font-size: 11px; color: var(--text-muted); }
    .invite-error { font-size: 11px; color: #dc2626; }

    .live-progress {
      display: flex; align-items: center; gap: 6px;
      margin-top: 4px;
      font-size: 11px; font-weight: 600; color: var(--primary-dark);
    }
    .live-progress .material-icons { font-size: 14px; color: var(--primary); }
    .live-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .live-count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .live-bar {
      flex: 1; min-width: 40px; max-width: 120px; height: 4px;
      background: var(--surface-raised, rgba(0,0,0,0.08));
      border-radius: 999px; overflow: hidden;
    }
    .live-bar-fill {
      display: block; height: 100%;
      background: var(--primary);
      border-radius: 999px;
      transition: width var(--transition, 0.2s) ease;
    }
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .status {
      font-size: 11px; font-weight: 600;
      padding: 2px 9px; border-radius: 999px; white-space: nowrap;
    }
    .status-pending { background: rgba(245,158,11,0.14); color: #b45309; }
    .status-active { background: rgba(59,130,246,0.14); color: #1d4ed8; }
    .status-completed { background: rgba(34,197,94,0.14); color: #15803d; }
    .status-failed { background: rgba(220,38,38,0.12); color: #dc2626; }
    .status-cancelled { background: var(--surface-raised, rgba(0,0,0,0.05)); color: var(--text-muted); }
  `]
})
export class MeetingInviteModalComponent implements OnInit, OnDestroy {
  @Input() spaceId = '';
  @Output() close = new EventEmitter<void>();

  labelInput = '';
  loading = signal(false);
  creating = signal(false);
  invites = signal<MeetingInvite[]>([]);
  createdInvite = signal<MeetingInvite | null>(null);

  private streamSub?: Subscription;

  constructor(
    private meetingService: MeetingService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadInvites();
    if (this.spaceId) {
      this.streamSub = this.meetingService
        .streamInvites(this.spaceId)
        .subscribe((invite) => this.mergeInvite(invite));
    }
  }

  ngOnDestroy(): void {
    this.streamSub?.unsubscribe();
  }

  loadInvites(): void {
    if (!this.spaceId) return;
    this.loading.set(true);
    this.meetingService.listInvites(this.spaceId).subscribe({
      next: (invites) => {
        this.invites.set(invites);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Folds a live invite update into the list, replacing or prepending it. */
  private mergeInvite(updated: MeetingInvite): void {
    this.invites.update((list) => {
      const idx = list.findIndex((i) => i.id === updated.id);
      if (idx === -1) return [updated, ...list];
      const next = [...list];
      next[idx] = { ...next[idx], ...updated };
      return next;
    });
  }

  phaseLabel(invite: MeetingInvite): string {
    return meetingPhaseLabel(invite);
  }

  progressPct(invite: MeetingInvite): number {
    if (!invite.progressTotal) return 0;
    return Math.round(((invite.progressCurrent ?? 0) / invite.progressTotal) * 100);
  }

  create(): void {
    const label = this.labelInput.trim();
    if (!label || this.creating()) return;

    this.creating.set(true);
    this.meetingService.createInvite(this.spaceId, label).subscribe({
      next: (invite) => {
        this.createdInvite.set(invite);
        this.labelInput = '';
        this.creating.set(false);
        this.loadInvites();
      },
      error: () => {
        this.toastService.error('Fehler', 'Meeting-Token konnte nicht erstellt werden.');
        this.creating.set(false);
      },
    });
  }

  cancel(invite: MeetingInvite): void {
    this.meetingService.cancelInvite(this.spaceId, invite.id).subscribe({
      next: () => {
        this.toastService.success('Zurückgezogen', 'Das Meeting-Token wurde deaktiviert.');
        if (this.createdInvite()?.id === invite.id) this.createdInvite.set(null);
        this.loadInvites();
      },
      error: () => this.toastService.error('Fehler', 'Token konnte nicht zurückgezogen werden.'),
    });
  }

  copy(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toastService.success('Kopiert', 'In die Zwischenablage kopiert.'),
      () => this.toastService.error('Fehler', 'Kopieren nicht möglich.'),
    );
  }

  statusLabel(status: MeetingInvite['status']): string {
    switch (status) {
      case 'PENDING': return 'Wartet';
      case 'ACTIVE': return 'Läuft';
      case 'COMPLETED': return 'Fertig';
      case 'FAILED': return 'Fehler';
      case 'CANCELLED': return 'Abgebrochen';
    }
  }
}
