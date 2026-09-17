import { Browser, Page } from 'puppeteer';
import { launchBrowser, loadEnv, loginAsAdmin, takeScreenshot } from '../helpers/browser';
import {
  SecondUser, TestSpace, api, createTestSpace, createViewer, deleteTestSpace, dismissChangelog, loginInNewContext,
} from '../helpers/api';

/**
 * Tasks: made by hand, suggested from a meeting, created by the assistant
 * (real OpenAI), and handed to someone else, who is told and may only move
 * the task along.
 */
describe('Tasks', () => {
  let browser: Browser;
  let page: Page;
  let space: TestSpace;
  let viewer: SecondUser | undefined;

  const base = () => process.env.BASE_URL!;
  const stamp = Date.now();

  async function clickButton(scope: string, label: string): Promise<void> {
    const clicked = await page.evaluate((sel: string, text: string) => {
      const button = Array.from(document.querySelectorAll(`${sel} button`)).find((b) => b.textContent?.trim().endsWith(text));
      (button as HTMLElement | undefined)?.click();
      return !!button;
    }, scope, label);
    if (!clicked) throw new Error(`No "${label}" button in ${scope}`);
  }

  async function rowTitles(scope: string): Promise<string[]> {
    return page.$$eval(`${scope} .task-title`, (els) => els.map((el) => el.textContent?.trim() ?? ''));
  }

  async function pickOption(selectName: string, label: string): Promise<void> {
    await page.click(`app-task-editor-dialog app-searchable-select[name="${selectName}"] .select-trigger`);
    await page.waitForSelector('.select-panel', { timeout: 5000 });
    // Options can still be loading when the panel opens.
    const option = await page.waitForFunction((text: string) => Array.from(document.querySelectorAll('.select-panel *')).find(
      (el) => el.children.length === 0 && el.textContent?.trim() === text
    ), { timeout: 10000 }, label);
    await (option as any).evaluate((el: HTMLElement) => el.click());
  }

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser();
    page = await browser.newPage();
    await loginAsAdmin(page);
    await dismissChangelog(page);
    space = await createTestSpace(page, 'Tasks', { 'README.md': '# Office\n\nHow the office runs.\n' });
  }, 120000);

  afterAll(async () => {
    if (viewer) await api(page, 'DELETE', `/api/users/${viewer.id}`);
    await deleteTestSpace(page, space);
    await browser?.close();
  });

  it('creates a task in a space, lists it under My tasks, and ticks it off', async () => {
    const title = `Water the plants ${stamp}`;
    await page.goto(`${base()}/spaces/${space.fullPath}/tasks`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('app-space-tasks', { timeout: 15000 });
    await clickButton('app-space-tasks', 'New task');
    await page.waitForSelector('app-task-editor-dialog input[name="title"]');
    await page.type('app-task-editor-dialog input[name="title"]', title);
    await page.waitForFunction(() => document.querySelectorAll('app-task-editor-dialog app-searchable-select[name="assignee"] .select-trigger:not([disabled])').length > 0);
    await pickOption('assignee', 'Local Admin');
    await page.$eval('app-task-editor-dialog input[name="dueDate"]', (el) => {
      (el as HTMLInputElement).value = '2026-10-01';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await takeScreenshot(page, 'tasks-01-new');
    await clickButton('app-task-editor-dialog .modal-footer', 'Create task');
    await page.waitForFunction((t: string) => Array.from(document.querySelectorAll('app-space-tasks .task-title')).some((e) => e.textContent?.trim() === t), { timeout: 10000 }, title);

    await page.goto(`${base()}/tasks`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('app-my-tasks app-task-list', { timeout: 15000 });
    expect(await rowTitles('app-my-tasks')).toContain(title);

    await page.evaluate((t: string) => {
      const row = Array.from(document.querySelectorAll('app-my-tasks .task-row')).find((r) => r.querySelector('.task-title')?.textContent?.trim() === t);
      (row?.querySelector('.task-check') as HTMLElement | undefined)?.click();
    }, title);
    await page.waitForFunction((t: string) => !Array.from(document.querySelectorAll('app-my-tasks .task-title')).some((e) => e.textContent?.trim() === t), { timeout: 10000 }, title);
    await takeScreenshot(page, 'tasks-02-done');

    const stored = await api<any[]>(page, 'GET', `/api/spaces/${space.spaceId}/tasks?status=DONE`);
    expect(stored.body.map((t) => t.title)).toContain(title);
    expect(stored.body.find((t) => t.title === title).dueDate).toBe('2026-10-01');
  }, 120000);

  it('turns meeting action items into suggestions that only count once confirmed', async () => {
    const invite = await api(page, 'POST', `/api/spaces/${space.spaceId}/meetings`, { label: `Weekly sync ${stamp}`, language: 'en' });
    expect(invite.status).toBe(201);
    const note = `<h1>Weekly sync ${stamp}</h1><h2>Action Items</h2><ul>`
      + `<li><input disabled="" type="checkbox"> Send the fruit order ${stamp} — Local Admin</li>`
      + `<li><input disabled="" type="checkbox"> Fix the printer ${stamp} — Somebody Unknown</li>`
      + `<li><input checked="" disabled="" type="checkbox"> Already done ${stamp} — Local Admin</li></ul>`;
    const submitted = await fetch(`${base()}/api/meetings/bot/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${invite.body.token}` },
      body: JSON.stringify({ notes: [note, '<p>Transcript</p>'], participants: 'Local Admin' }),
    });
    expect(submitted.status).toBe(200);

    await page.goto(`${base()}/tasks`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.task-row.suggested', { timeout: 15000 });
    const suggested = await page.$$eval('.task-row.suggested .task-title', (els) => els.map((e) => e.textContent?.trim()));
    expect(suggested).toEqual(expect.arrayContaining([`Send the fruit order ${stamp}`, `Fix the printer ${stamp}`]));
    expect(suggested).not.toContain(`Already done ${stamp}`);
    await takeScreenshot(page, 'tasks-03-suggested');

    // Nobody else sees a suggestion before it is confirmed.
    const openInSpace = await api<any[]>(page, 'GET', `/api/spaces/${space.spaceId}/tasks`);
    expect(openInSpace.body.filter((t) => t.status === 'SUGGESTED').length).toBe(2);

    const act = async (title: string, label: string) => page.evaluate((t: string, l: string) => {
      const row = Array.from(document.querySelectorAll('.task-row.suggested')).find((r) => r.querySelector('.task-title')?.textContent?.trim() === t);
      const button = Array.from(row?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === l);
      (button as HTMLElement | undefined)?.click();
    }, title, label);

    await act(`Send the fruit order ${stamp}`, 'Confirm');
    await page.waitForFunction((t: string) => Array.from(document.querySelectorAll('app-my-tasks .task-row:not(.suggested) .task-title')).some((e) => e.textContent?.trim() === t), { timeout: 10000 }, `Send the fruit order ${stamp}`);
    await act(`Fix the printer ${stamp}`, 'Dismiss');
    await page.waitForFunction(
      (s: string) => !Array.from(document.querySelectorAll('.task-row.suggested .task-title')).some((e) => e.textContent?.includes(s)),
      { timeout: 10000 },
      String(stamp)
    );

    const tasks = await api<any[]>(page, 'GET', `/api/spaces/${space.spaceId}/tasks`);
    const confirmed = tasks.body.find((t) => t.title === `Send the fruit order ${stamp}`);
    expect(confirmed.status).toBe('OPEN');
    expect(confirmed.assignee.name).toBe('Local Admin');
    expect(tasks.body.some((t) => t.title === `Fix the printer ${stamp}`)).toBe(false);

    // The meeting note in the inbox lists the task it produced.
    await page.goto(`${base()}/spaces/${space.fullPath}/inbox`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.note-card', { timeout: 15000 });
    await page.evaluate((s: string) => {
      const card = Array.from(document.querySelectorAll('.note-card')).find((c) => c.textContent?.includes(`Weekly sync ${s}`));
      (card as HTMLElement | undefined)?.click();
    }, String(stamp));
    await page.waitForFunction((t: string) => Array.from(document.querySelectorAll('.note-tasks .task-title')).some((e) => e.textContent?.trim() === t), { timeout: 10000 }, `Send the fruit order ${stamp}`);
    await takeScreenshot(page, 'tasks-04-inbox');
  }, 120000);

  it('lets the assistant create a task and report what is open', async () => {
    const title = `Order new chairs ${stamp}`;
    await page.goto(`${base()}/ask?space=${space.spaceId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('app-ask-composer textarea', { timeout: 15000 });
    await page.type('app-ask-composer textarea', `Create a task titled exactly "${title}" assigned to me, due 2026-10-15.`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.doc-links.created .links-label')).some((l) => l.textContent?.trim() === 'Tasks'),
      { timeout: 120000 }
    );
    await takeScreenshot(page, 'tasks-05-assistant');

    const tasks = await api<any[]>(page, 'GET', `/api/spaces/${space.spaceId}/tasks`);
    const created = tasks.body.find((t) => t.title === title);
    expect(created).toBeDefined();
    expect(created.assignee?.name).toBe('Local Admin');
    expect(created.dueDate).toBe('2026-10-15');
    expect(created.source.type).toBe('CONVERSATION');

    await page.type('app-ask-composer textarea', 'Which of my tasks are still open? List their titles.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('article.message.assistant:not(.live)').length >= 2, { timeout: 120000 });
    const answer = await page.$$eval('article.message.assistant:not(.live)', (els) => (els[els.length - 1] as HTMLElement).innerText);
    expect(answer).toContain(title);
  }, 300000);

  it('tells the assignee, who may move the task along but not rewrite it', async () => {
    viewer = await createViewer(page);
    const granted = await api(page, 'POST', `/api/spaces/${space.spaceId}/permissions`, { userId: viewer.id, permissionLevel: 'VIEW' });
    expect(granted.status).toBeLessThan(300);
    const created = await api(page, 'POST', `/api/spaces/${space.spaceId}/tasks`, { title: `Review the budget ${stamp}`, assigneeId: viewer.id });
    expect(created.status).toBe(201);

    const viewerPage = await loginInNewContext(browser, viewer.email, viewer.password);
    try {
      // A first login shows the release notes over the app.
      await viewerPage.waitForSelector('app-header-notifications .icon-btn', { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await dismissChangelog(viewerPage);
      await viewerPage.click('app-header-notifications .icon-btn');
      await viewerPage.waitForFunction(
        (t: string) => Array.from(document.querySelectorAll('.feed-item')).some((i) => i.textContent?.includes(t) && i.textContent?.includes('assigned to you')),
        { timeout: 10000 },
        `Review the budget ${stamp}`
      );
      await takeScreenshot(viewerPage, 'tasks-06-bell');

      const renamed = await api(viewerPage, 'PATCH', `/api/tasks/${created.body.id}`, { title: 'Not mine to rename' });
      expect(renamed.status).toBe(403);
      const moved = await api(viewerPage, 'PATCH', `/api/tasks/${created.body.id}`, { status: 'IN_PROGRESS' });
      expect(moved.status).toBe(200);
      expect(moved.body.status).toBe('IN_PROGRESS');
      const added = await api(viewerPage, 'POST', `/api/spaces/${space.spaceId}/tasks`, { title: 'Viewers cannot add tasks' });
      expect(added.status).toBe(403);
    } finally {
      await viewerPage.browserContext().close();
    }
  }, 120000);
});
