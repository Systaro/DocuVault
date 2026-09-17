import { Browser, Page } from 'puppeteer';
import { launchBrowser, loadEnv, loginAsAdmin, takeScreenshot } from '../helpers/browser';
import { TestSpace, api, createTestSpace, deleteTestSpace, dismissChangelog } from '../helpers/api';

/**
 * Drafts written from what happened in a space (real OpenAI): they stay in the
 * conversation until the user edits and saves them, and they are written from
 * the space's notes and tasks.
 */
describe('Drafts', () => {
  let browser: Browser;
  let page: Page;
  let space: TestSpace;

  const base = () => process.env.BASE_URL!;
  const meetingNote = '<h1>Team sync</h1><p>We decided to hold the team offsite on 2026-11-12 in Lisbon.</p>'
    + '<h2>Action Items</h2><ul><li>Book the venue — Local Admin</li></ul>';

  async function documentCount(): Promise<number> {
    const tree = await api<any[]>(page, 'GET', `/api/spaces/${space.spaceId}/documents/tree`);
    const count = (nodes: any[]): number => nodes.reduce((n, node) => n + (node.isDirectory ? count(node.children ?? []) : 1), 0);
    return count(tree.body);
  }

  async function writeDraft(templateLabel: string): Promise<string> {
    await page.goto(`${base()}/ask?space=${space.spaceId}&draft=1`, { waitUntil: 'networkidle2' });
    await dismissChangelog(page);
    await page.waitForSelector('app-draft-dialog .modal', { timeout: 15000 });
    await page.evaluate((label: string) => {
      const option = Array.from(document.querySelectorAll('app-draft-dialog .template-option')).find((o) => o.textContent?.includes(label));
      (option as HTMLElement | undefined)?.click();
    }, templateLabel);
    await page.waitForFunction(
      (name: string) => document.querySelector('app-draft-dialog app-searchable-select[name="space"] .trigger-label')?.textContent?.trim() === name,
      { timeout: 10000 },
      space.name
    );
    await page.click('app-draft-dialog button[type="submit"]');
    await page.waitForFunction(() => /^\/ask\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    await page.waitForSelector('article.message.assistant:not(.live) .answer', { timeout: 150000 });
    return page.$eval('article.message.assistant:not(.live) .answer', (el) => (el as HTMLElement).innerText);
  }

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser();
    page = await browser.newPage();
    await loginAsAdmin(page);
    await dismissChangelog(page);
    space = await createTestSpace(page, 'Drafts', { 'README.md': '# Team\n\nHow the team works.\n' });

    expect((await api(page, 'POST', `/api/spaces/${space.spaceId}/inbox/notes`, { content: meetingNote })).status).toBe(201);
    const venue = await api(page, 'POST', `/api/spaces/${space.spaceId}/tasks`, { title: 'Book the offsite venue', dueDate: '2026-10-20' });
    expect(venue.status).toBe(201);
    const invitations = await api(page, 'POST', `/api/spaces/${space.spaceId}/tasks`, { title: 'Send the offsite invitations' });
    expect((await api(page, 'PATCH', `/api/tasks/${invitations.body.id}`, { status: 'DONE' })).status).toBe(200);
  }, 120000);

  afterAll(async () => {
    await deleteTestSpace(page, space);
    await browser?.close();
  });

  it('writes a status report from the notes and tasks, and saves it only after editing', async () => {
    const before = await documentCount();
    const report = await writeDraft('Status report');
    await takeScreenshot(page, 'drafts-01-report');

    expect(report).toContain('Book the offsite venue');
    expect(report).toContain('Send the offsite invitations');
    expect(report.toLowerCase()).toContain('offsite');
    // A draft is not written anywhere by itself.
    expect(await page.$('.doc-links.created')).toBeNull();
    expect(await documentCount()).toBe(before);

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('article.message.assistant:not(.live) .message-actions button'));
      (buttons.find((b) => b.textContent?.includes('Save as document')) as HTMLElement | undefined)?.click();
    });
    await page.waitForSelector('app-save-answer-dialog textarea[name="body"]', { timeout: 10000 });
    await page.waitForFunction(() => !!document.querySelector('app-save-answer-dialog app-searchable-select .trigger-label')?.textContent?.trim(), { timeout: 10000 });
    await page.$eval('app-save-answer-dialog textarea[name="body"]', (el) => {
      const area = el as HTMLTextAreaElement;
      area.value = `Checked by the team lead.\n\n${area.value}`;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('app-save-answer-dialog input[name="path"]', (el) => {
      const input = el as HTMLInputElement;
      input.value = 'reports/offsite-status.md';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await takeScreenshot(page, 'drafts-02-save');
    await page.click('app-save-answer-dialog button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('app-save-answer-dialog'), { timeout: 15000 });

    const saved = await api(page, 'GET', `/api/spaces/${space.spaceId}/documents/reports/offsite-status.md`);
    expect(saved.status).toBe(200);
    expect(saved.body.content).toMatch(/^# .+\n\nChecked by the team lead\./);
    expect(saved.body.content).toContain('Book the offsite venue');
  }, 240000);

  it('writes a meeting protocol from the latest meeting note', async () => {
    const protocol = await writeDraft('Meeting protocol');
    await takeScreenshot(page, 'drafts-03-protocol');
    expect(protocol).toContain('2026-11-12');
    expect(protocol).toContain('Lisbon');
    expect(protocol.toLowerCase()).toContain('venue');
  }, 240000);
});
