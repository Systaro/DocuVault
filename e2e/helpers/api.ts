import { Browser, Page } from 'puppeteer';

/**
 * Calls the DocuVault API from inside the page, with the page's session, so
 * test setup goes through the same permission checks as the UI.
 */
export async function api<T = any>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async (m: string, u: string, b: string | null) => {
      const res = await fetch(u, {
        method: m,
        credentials: 'include',
        headers: b ? { 'Content-Type': 'application/json' } : {},
        body: b ?? undefined,
      });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: res.status, body: parsed as any };
    },
    method,
    url,
    body === undefined ? null : JSON.stringify(body)
  );
}

export interface TestSpace {
  groupId: string;
  spaceId: string;
  fullPath: string;
  name: string;
}

/** A fresh group with one repository, so a test never depends on or disturbs existing content. */
export async function createTestSpace(page: Page, label: string, documents: Record<string, string>): Promise<TestSpace> {
  const stamp = Date.now();
  const group = await api(page, 'POST', '/api/spaces', { name: `E2E ${label} ${stamp}`, slug: `e2e-${label.toLowerCase()}-${stamp}`, type: 'GROUP' });
  // Unique, because the space picker lists repositories by name.
  const name = `${label} Docs ${stamp}`;
  const space = await api(page, 'POST', '/api/spaces', {
    name,
    slug: `e2e-${label.toLowerCase()}-docs-${stamp}`,
    type: 'REPOSITORY',
    parentId: group.body.id,
  });
  if (space.status >= 300) throw new Error(`Could not create the test space: ${space.status} ${JSON.stringify(space.body)}`);
  for (const [path, content] of Object.entries(documents)) {
    const doc = await api(page, 'POST', `/api/spaces/${space.body.id}/documents`, { path, content, autoCommit: true });
    if (doc.status >= 300) throw new Error(`Could not create ${path}: ${doc.status}`);
  }
  return { groupId: group.body.id, spaceId: space.body.id, fullPath: space.body.fullPath, name };
}

export async function deleteTestSpace(page: Page, space: TestSpace | undefined): Promise<void> {
  if (!space) return;
  await api(page, 'DELETE', `/api/spaces/${space.spaceId}`);
  await api(page, 'DELETE', `/api/spaces/${space.groupId}`);
}

/** Embeddings are written asynchronously; waits until semantic search finds [needle] in the space. */
export async function waitForIndexed(page: Page, spaceId: string, query: string, needle: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api<any[]>(page, 'POST', '/api/search/semantic', { query, spaceId, limit: 5 });
    if (res.status === 200 && res.body.some((hit) => String(hit.content).includes(needle))) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`"${needle}" was not indexed within ${timeoutMs} ms`);
}

/** Dismisses the release notes a new version shows over the app on first login. */
export async function dismissChangelog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dismiss = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Got it');
    (dismiss as HTMLElement | undefined)?.click();
  });
}

export interface SecondUser {
  email: string;
  password: string;
  id: string;
}

/** Invites and registers a viewer with no space access, for checking what someone else cannot reach. */
export async function createViewer(adminPage: Page): Promise<SecondUser> {
  const email = `e2e-viewer-${Date.now()}@local.test`;
  const password = 'E2e-Viewer-Pass1!';
  const invite = await api(adminPage, 'POST', '/api/users/invite', { email, role: 'VIEWER' });
  if (invite.status !== 201) throw new Error(`Invite failed: ${invite.status}`);
  // Accepting signs the new user in, so it must not run in the admin's browser session.
  const response = await fetch(`${process.env.BASE_URL}/api/users/accept-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invite.body.token, name: 'E2E Viewer', password }),
  });
  if (!response.ok) throw new Error(`Accepting the invitation failed: ${response.status}`);
  const user = (await response.json()) as { id: string };
  return { email, password, id: user.id };
}

/** A separate browser context, so the second user's session does not replace the admin's. */
export async function loginInNewContext(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(`${process.env.BASE_URL}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]', { timeout: 10000 });
  await page.type('input[name="email"]', email, { delay: 10 });
  await page.type('input[name="password"]', password, { delay: 10 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 15000 });
  return page;
}
