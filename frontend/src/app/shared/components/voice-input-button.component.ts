import { Component, OnDestroy, inject, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { ToastService } from '../services/toast.service';

/** Longest recording, so a forgotten microphone does not run on. */
const MAX_RECORDING_MS = 3 * 60 * 1000;

/**
 * Speak instead of typing: the first click records, the second stops and
 * turns the recording into text on the server. Shown only where the browser
 * can record and the server can transcribe.
 */
@Component({
  selector: 'app-voice-input-button',
  standalone: true,
  template: `
    @if (available) {
      <button
        type="button"
        class="voice-btn"
        [class.recording]="state() === 'recording'"
        [disabled]="state() === 'transcribing'"
        [title]="state() === 'recording' ? 'Stop and insert text' : state() === 'transcribing' ? 'Turning speech into text' : 'Speak instead of typing'"
        [attr.aria-label]="state() === 'recording' ? 'Stop recording' : 'Start voice input'"
        [attr.aria-pressed]="state() === 'recording'"
        (click)="toggle()"
      >
        <span translate="no" class="material-icons">{{ state() === 'transcribing' ? 'hourglass_top' : state() === 'recording' ? 'stop_circle' : 'mic' }}</span>
        @if (state() === 'recording') {
          <span class="voice-time">{{ seconds() }}s</span>
        }
      </button>
    }
  `,
  styles: [`
    .voice-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 32px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;

      .material-icons { font-size: 20px; }
      &:hover:not(:disabled) { background: var(--background-darker); color: var(--primary-dark); }
      &:disabled { cursor: progress; }

      &.recording {
        background: color-mix(in srgb, var(--error) 14%, transparent);
        color: var(--error);
      }
    }

    .voice-time {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
  `]
})
export class VoiceInputButtonComponent implements OnDestroy {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private caps = inject(CapabilitiesService);

  /** The recognised text, ready to insert. */
  transcribed = output<string>();

  state = signal<'idle' | 'recording' | 'transcribing'>('idle');
  seconds = signal(0);

  readonly available = this.caps.capabilities().ai.voice === true
    && typeof MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;

  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private ticker?: number;
  private limit?: number;

  ngOnDestroy(): void {
    this.cleanup();
    this.recorder?.stream.getTracks().forEach(track => track.stop());
  }

  async toggle(): Promise<void> {
    if (this.state() === 'recording') {
      this.recorder?.stop();
      return;
    }
    if (this.state() !== 'idle') return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.toast.error('No microphone', 'Allow microphone access in your browser to speak a note.');
      return;
    }

    const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
    this.recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      this.cleanup();
      this.upload(new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' }));
    };
    this.recorder.start();
    this.state.set('recording');
    this.seconds.set(0);
    this.ticker = window.setInterval(() => this.seconds.update(s => s + 1), 1000);
    this.limit = window.setTimeout(() => this.recorder?.stop(), MAX_RECORDING_MS);
  }

  private upload(audio: Blob): void {
    if (!audio.size) {
      this.state.set('idle');
      return;
    }
    this.state.set('transcribing');
    const form = new FormData();
    const type = audio.type.split(';')[0];
    form.append('audio', new File([audio], `recording.${type.split('/')[1] || 'webm'}`, { type }));
    this.http.post<{ text: string }>('/api/ai/transcribe', form).subscribe({
      next: result => {
        this.state.set('idle');
        if (result.text) this.transcribed.emit(result.text);
        else this.toast.warning('Nothing recognised', 'The recording did not contain any words.');
      },
      error: () => {
        this.state.set('idle');
        this.toast.error('Voice input failed', 'The recording could not be turned into text.');
      }
    });
  }

  private cleanup(): void {
    clearInterval(this.ticker);
    clearTimeout(this.limit);
  }
}
