import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { APP_VERSION } from '../../shared/version';

/** One row of assets/changelog/index.json. */
export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
}

export interface ChangelogRelease extends ChangelogEntry {
  /** Raw markdown from assets/changelog/<version>.md. */
  body: string;
}

/**
 * Compares `vX.Y.Z` strings numerically. Anything unparseable sorts lowest, so a
 * malformed entry can never mask a real release.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa.length || !pb.length) return pa.length ? 1 : pb.length ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Release notes for the what's-new dialog.
 *
 * The entries ship as frontend assets — one markdown file per release — so a
 * self-hosted install always shows the notes belonging to the version it is
 * actually running. Only the "user has seen up to X" marker lives server-side.
 */
@Injectable({ providedIn: 'root' })
export class ChangelogService {
  private http = inject(HttpClient);

  /**
   * Releases this user has not acknowledged yet, newest first, never newer than
   * the running build. A user who has never seen the dialog gets the current
   * release only rather than the entire history at once.
   */
  unseenReleases(seenVersion: string | null | undefined): Observable<ChangelogRelease[]> {
    return this.index().pipe(
      map(entries => {
        const shipped = entries.filter(e => compareVersions(e.version, APP_VERSION) <= 0);
        return seenVersion
          ? shipped.filter(e => compareVersions(e.version, seenVersion) > 0)
          : shipped.slice(0, 1);
      }),
      switchMap(entries => this.load(entries))
    );
  }

  /** Every shipped release, newest first — for opening the log on purpose. */
  allReleases(): Observable<ChangelogRelease[]> {
    return this.index().pipe(
      map(entries => entries.filter(e => compareVersions(e.version, APP_VERSION) <= 0)),
      switchMap(entries => this.load(entries))
    );
  }

  markSeen(version: string): Observable<{ changelogSeenVersion: string }> {
    return this.http.post<{ changelogSeenVersion: string }>(
      '/api/users/me/changelog-seen',
      { version }
    );
  }

  private index(): Observable<ChangelogEntry[]> {
    return this.http.get<ChangelogEntry[]>('assets/changelog/index.json').pipe(
      // Sort rather than trusting the file, so a hand-added entry lands right.
      map(entries => [...entries].sort((a, b) => compareVersions(b.version, a.version))),
      catchError(() => of([]))
    );
  }

  private load(entries: ChangelogEntry[]): Observable<ChangelogRelease[]> {
    if (!entries.length) return of([]);
    return forkJoin(entries.map(entry => this.body(entry))).pipe(
      map(releases => releases.filter(r => r.body.trim().length > 0))
    );
  }

  private body(entry: ChangelogEntry): Observable<ChangelogRelease> {
    // The version doubles as a filename — refuse anything that is not a plain
    // version string rather than letting it reach the URL.
    if (!/^v\d+\.\d+\.\d+$/.test(entry.version)) return of({ ...entry, body: '' });
    return this.http
      .get(`assets/changelog/${entry.version}.md`, { responseType: 'text' })
      .pipe(
        map(body => ({ ...entry, body })),
        catchError(() => of({ ...entry, body: '' }))
      );
  }
}
