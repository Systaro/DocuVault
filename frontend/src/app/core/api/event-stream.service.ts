import { Injectable, NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiRequestService } from './api-request.service';

/** One server-sent event: its `event:` name and its parsed JSON `data:`. */
export interface ServerEvent {
  name: string;
  data: any;
}

/** The server answered with an error status before any stream started. */
export class StreamRejectedError extends Error {
  constructor(readonly status: number, readonly body: { message?: string } | null) {
    super(body?.message || `The request failed (${status}).`);
  }
}

/**
 * Reads server-sent events from a POST. HttpClient cannot hand out a body while
 * it is still arriving, so this reads the stream with fetch.
 */
@Injectable({ providedIn: 'root' })
export class EventStreamService {
  private zone = inject(NgZone);
  private apiRequest = inject(ApiRequestService);

  /**
   * POSTs `body` to `url` and emits the events of the answer as they arrive. An
   * error status errors with StreamRejectedError, a dropped connection with the
   * underlying error. Unsubscribing stops reading; the server still finishes.
   */
  post(url: string, body: unknown): Observable<ServerEvent> {
    return new Observable<ServerEvent>(subscriber => {
      const abort = new AbortController();

      (async () => {
        const response = await fetch(this.apiRequest.url(url), this.apiRequest.fetchInit({
          method: 'POST',
          // JSON as well, so an error answered before the stream carries its message.
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
          body: JSON.stringify(body),
          signal: abort.signal
        }));
        if (!response.ok || !response.body) {
          throw new StreamRejectedError(response.status, await response.json().catch(() => null));
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let boundary: number;
          while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const event = parseServerEvent(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
            if (event) this.zone.run(() => subscriber.next(event));
          }
        }
      })()
        .then(() => this.zone.run(() => subscriber.complete()))
        .catch(error => {
          if (!abort.signal.aborted) this.zone.run(() => subscriber.error(error));
        });

      return () => abort.abort();
    });
  }
}

/** One `event:` / `data:` block of a stream; comments (keep-alives) yield nothing. */
export function parseServerEvent(block: string): ServerEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return data.length ? { name, data: JSON.parse(data.join('\n')) } : null;
}
