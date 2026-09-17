import { Browser, Page } from 'puppeteer';
import { launchBrowser, loadEnv, loginAsAdmin, takeScreenshot } from '../helpers/browser';
import {
  SecondUser, TestSpace, api, createTestSpace, createViewer, deleteTestSpace, dismissChangelog, loginInNewContext, waitForIndexed,
} from '../helpers/api';

/**
 * The assistant, against the real OpenAI API (configured on the backend).
 *
 * Model wording varies from run to run, so the checks are about behaviour:
 * the fact asked for appears, the answer names its source, a change is only
 * written after Apply, and nobody reaches another user's conversations or a
 * space they cannot read.
 */
describe('Ask', () => {
  let browser: Browser;
  let page: Page;
  let space: TestSpace;
  let viewer: SecondUser | undefined;
  let conversationId = '';

  const TURN_TIMEOUT = 120000;
  const base = () => process.env.BASE_URL!;

  const fruitPolicy = '# Fruit policy\n\nThe office fruit of the quarter is PAPAYA.\n\nOrders go to the facilities team every Monday.\n';
  const checklist = '# Onboarding checklist\n\n1. Collect your badge at reception.\n2. Set up your laptop with IT.\n3. Book a lunch with your team.\n';

  async function readDocument(path: string): Promise<string> {
    const res = await api(page, 'GET', `/api/spaces/${space.spaceId}/documents/${path}`);
    return res.status === 200 ? res.body.content : '';
  }

  /** Watches for streamed text in the live message, which only exists while an answer is arriving. */
  async function watchForStreaming(): Promise<void> {
    await page.evaluate(() => {
      (window as any).__sawStreamedText = false;
      const observer = new MutationObserver(() => {
        const live = document.querySelector('article.message.live .answer');
        if (live && (live.textContent ?? '').trim().length > 0) (window as any).__sawStreamedText = true;
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }

  async function submitQuestion(text: string): Promise<void> {
    await page.waitForSelector('app-ask-composer textarea:not([disabled])', { timeout: 20000 });
    await page.click('app-ask-composer textarea');
    await page.type('app-ask-composer textarea', text);
    await page.keyboard.press('Enter');
  }

  /** The text of the last stored assistant message, once the answer has finished. */
  async function waitForAnswer(count: number): Promise<string> {
    await page.waitForFunction(
      (n: number) => document.querySelectorAll('article.message.assistant:not(.live)').length >= n,
      { timeout: TURN_TIMEOUT },
      count
    );
    return page.$$eval('article.message.assistant:not(.live)', (els) => (els[els.length - 1] as HTMLElement).innerText);
  }

  async function chooseSpace(name: string): Promise<void> {
    await page.click('app-ask-composer app-searchable-select .select-trigger');
    await page.waitForSelector('.select-panel', { timeout: 5000 });
    const search = await page.$('.select-panel input');
    if (search) await search.type(name);
    const picked = await page.evaluate((label: string) => {
      const option = Array.from(document.querySelectorAll('.select-panel *')).find(
        (el) => el.children.length === 0 && el.textContent?.trim() === label
      );
      (option as HTMLElement | undefined)?.click();
      return !!option;
    }, name);
    if (!picked) throw new Error(`Space "${name}" is not in the picker`);
  }

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser();
    page = await browser.newPage();
    await loginAsAdmin(page);
    await dismissChangelog(page);
    space = await createTestSpace(page, 'Ask', {
      'ops/fruit-policy.md': fruitPolicy,
      'ops/onboarding-checklist.md': checklist,
    });
    await waitForIndexed(page, space.spaceId, 'office fruit of the quarter', 'PAPAYA');
  }, 180000);

  afterAll(async () => {
    if (viewer) await api(page, 'DELETE', `/api/users/${viewer.id}`);
    // Conversations about the space go with it.
    await deleteTestSpace(page, space);
    await browser?.close();
  });

  it('answers a question from the dashboard, streamed, with its source', async () => {
    await page.goto(`${base()}/dashboard`, { waitUntil: 'networkidle2' });
    await dismissChangelog(page);
    await page.waitForSelector('app-ask-composer', { timeout: 15000 });
    await chooseSpace(space.name);
    await watchForStreaming();
    await submitQuestion('What is the office fruit this quarter?');

    await page.waitForFunction(() => /^\/ask\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    conversationId = page.url().split('/ask/')[1];

    const answer = await waitForAnswer(1);
    await takeScreenshot(page, 'ask-01-answer');
    expect(answer.toUpperCase()).toContain('PAPAYA');
    expect(await page.evaluate(() => (window as any).__sawStreamedText)).toBe(true);

    const sources = await page.$$eval('article.message.assistant:not(.live) .doc-links:not(.created) .doc-link', (els) =>
      els.map((el) => el.getAttribute('title') ?? el.textContent ?? '')
    );
    expect(sources.some((s) => s.includes('fruit-policy'))).toBe(true);

    const listed = await page.$$eval('.conversation-item', (els) => els.map((el) => (el as HTMLElement).innerText));
    expect(listed.some((text) => text.includes('office fruit') && text.includes(space.name))).toBe(true);

    // The conversation is stored: a reload shows the same exchange.
    await page.reload({ waitUntil: 'networkidle2' });
    const afterReload = await waitForAnswer(1);
    expect(afterReload.toUpperCase()).toContain('PAPAYA');
  }, 240000);

  it('proposes a change and writes it only when applied', async () => {
    await submitQuestion('Please change the fruit of the quarter in ops/fruit-policy.md from PAPAYA to MANGO.');
    await page.waitForSelector('app-proposal-card .status-pending', { timeout: TURN_TIMEOUT });
    await waitForAnswer(2);
    await takeScreenshot(page, 'ask-02-proposal');

    expect(await readDocument('ops/fruit-policy.md')).toContain('PAPAYA');
    const diff = await page.$eval('app-proposal-card .proposal-diff', (el) => (el as HTMLElement).innerText);
    expect(diff).toContain('MANGO');

    await page.click('app-proposal-card .btn-primary');
    await page.waitForSelector('app-proposal-card .status-applied', { timeout: 30000 });
    await takeScreenshot(page, 'ask-03-applied');

    const content = await readDocument('ops/fruit-policy.md');
    expect(content).toContain('MANGO');
    expect(content).not.toContain('PAPAYA');
    const history = await api<any[]>(page, 'GET', `/api/spaces/${space.spaceId}/document-history?path=ops/fruit-policy.md`);
    expect(history.body[0].message).toContain('via AI assistant');

    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('app-proposal-card .status-applied', { timeout: 20000 });
  }, 240000);

  it('creates a new document when asked for one', async () => {
    await submitQuestion('Create a new document at ops/visitor-guide.md with two short rules for visitors.');
    await page.waitForSelector('.doc-links.created .doc-link', { timeout: TURN_TIMEOUT });
    await waitForAnswer(3);
    await takeScreenshot(page, 'ask-04-created');

    const doc = await api(page, 'GET', `/api/spaces/${space.spaceId}/documents/ops/visitor-guide.md`);
    expect(doc.status).toBe(200);
    expect(doc.body.content.trim().length).toBeGreaterThan(20);
  }, 240000);

  it('asks about one document from the editor', async () => {
    await page.goto(`${base()}/spaces/${space.fullPath}/doc?path=${encodeURIComponent('ops/onboarding-checklist.md')}`, { waitUntil: 'networkidle2' });
    await dismissChangelog(page);
    await page.waitForSelector('button.ai-fab', { timeout: 20000 });
    await page.click('button.ai-fab');
    await page.waitForSelector('app-ask-composer .scope-chip.doc', { timeout: 15000 });
    const chip = await page.$eval('app-ask-composer .scope-chip.doc', (el) => (el as HTMLElement).innerText);
    expect(chip).toContain('ops/onboarding-checklist.md');

    await submitQuestion('What is the second item on this checklist?');
    await page.waitForFunction(() => /^\/ask\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    const answer = await waitForAnswer(1);
    await takeScreenshot(page, 'ask-05-document');
    expect(answer.toLowerCase()).toContain('laptop');

    const docTag = await page.$eval('.conversation-item.active .doc-tag', (el) => el.textContent?.trim());
    expect(docTag).toBe('onboarding-checklist.md');
  }, 240000);

  it('renames, finds and deletes conversations', async () => {
    const title = `Fruit of the quarter ${Date.now()}`;
    await page.goto(`${base()}/ask/${conversationId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.conversation-item.active button[title="Rename"]', { timeout: 15000 });

    await page.click('.conversation-item.active button[title="Rename"]');
    await page.waitForSelector('.rename-input');
    await page.click('.rename-input', { clickCount: 3 });
    await page.type('.rename-input', title);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (t: string) => document.querySelector('.ask-header h1')?.textContent?.trim() === t,
      { timeout: 10000 },
      title
    );
    expect(await page.title()).toContain(title);
    expect((await api(page, 'GET', `/api/ai/conversations/${conversationId}`)).body.conversation.title).toBe(title);

    // Search reaches every conversation, whatever space it is about.
    await page.type('.sidebar-search input', title);
    await page.waitForFunction(
      (id: string) => {
        const links = Array.from(document.querySelectorAll('.conversation-link')).map((a) => a.getAttribute('href') ?? '');
        return links.length === 1 && links[0].endsWith(id);
      },
      { timeout: 10000 },
      conversationId
    );

    await page.click('.conversation-item.active button[title="Delete"]');
    await page.waitForSelector('.modal .btn-danger', { timeout: 5000 });
    await takeScreenshot(page, 'ask-06-delete');
    await page.click('.modal .btn-danger');
    await page.waitForFunction(() => window.location.pathname === '/ask', { timeout: 10000 });
    expect(await page.$(`.conversation-link[href$="${conversationId}"]`)).toBeNull();
    expect((await api(page, 'GET', `/api/ai/conversations/${conversationId}`)).status).toBe(404);
  }, 120000);

  it('starts a question from the command palette', async () => {
    await page.goto(`${base()}/dashboard`, { waitUntil: 'networkidle2' });
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await page.waitForSelector('app-command-palette input', { timeout: 5000 });
    await page.type('app-command-palette input', 'Which team receives the fruit orders?');
    await page.waitForFunction(
      () => document.querySelector('app-command-palette .palette-item.selected')?.textContent?.includes('Ask:'),
      { timeout: 5000 }
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^\/ask\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    const answer = await waitForAnswer(1);
    expect(answer.toLowerCase()).toContain('facilities');
  }, 240000);

  it('keeps conversations and spaces away from someone without access', async () => {
    const own = await api<any[]>(page, 'GET', '/api/ai/conversations');
    const adminConversation = own.body[0];
    expect(adminConversation).toBeDefined();

    viewer = await createViewer(page);
    const viewerPage = await loginInNewContext(browser, viewer.email, viewer.password);
    try {
      expect((await api(viewerPage, 'GET', `/api/ai/conversations/${adminConversation.id}`)).status).toBe(404);
      expect((await api<any[]>(viewerPage, 'GET', '/api/ai/conversations')).body).toEqual([]);
      const continued = await api(viewerPage, 'POST', '/api/ai/conversations/turns', {
        conversationId: adminConversation.id, message: 'What did we talk about?',
      });
      expect(continued.status).toBe(404);
      const asked = await api(viewerPage, 'POST', '/api/ai/conversations/turns', {
        spaceId: space.spaceId, message: 'What is the office fruit?',
      });
      expect(asked.status).toBe(404);
      expect((await api(viewerPage, 'POST', '/api/search/semantic', { query: 'fruit', spaceId: space.spaceId })).status).toBe(403);

      await viewerPage.goto(`${base()}/ask/${adminConversation.id}`, { waitUntil: 'networkidle2' });
      await viewerPage.waitForFunction(() => window.location.pathname === '/ask', { timeout: 10000 });
      expect(await viewerPage.$('article.message')).toBeNull();
    } finally {
      await viewerPage.browserContext().close();
    }
  }, 120000);
});
