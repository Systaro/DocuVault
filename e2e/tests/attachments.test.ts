import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Browser, Page } from 'puppeteer';
import { chooseAskSpace, launchBrowser, loadEnv, loginAsAdmin, takeScreenshot } from '../helpers/browser';
import { SecondUser, TestSpace, api, createTestSpace, createViewer, deleteTestSpace, dismissChangelog, loginInNewContext } from '../helpers/api';

/**
 * Files for the assistant (real OpenAI): a photo of a handwritten note, in
 * German, is read in Ask and in Quick Note; the file stays with its owner's
 * conversation; files the assistant cannot read are turned away.
 *
 * The photo is a handwriting font on lined paper, not real handwriting.
 */
describe('Attachments', () => {
  let browser: Browser;
  let page: Page;
  let space: TestSpace;
  let viewer: SecondUser | undefined;
  let attachmentId = '';

  const base = () => process.env.BASE_URL!;
  const photo = path.join(__dirname, '..', 'fixtures', 'handwritten-note.jpg');

  async function attach(scope: string, file: string, count = 1): Promise<void> {
    const input = await page.$(`${scope} input.file-input`);
    await input!.uploadFile(file);
    await page.waitForFunction(
      (s: string, n: number) => document.querySelectorAll(`${s} .chip`).length === n && !document.querySelector(`${s} .chip.uploading`),
      { timeout: 60000 },
      scope,
      count
    );
  }

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser();
    page = await browser.newPage();
    await loginAsAdmin(page);
    await dismissChangelog(page);
    space = await createTestSpace(page, 'Files', { 'README.md': '# Office\n\nThe office moves to the harbour on 2 October.\n' });
  }, 120000);

  afterAll(async () => {
    if (viewer) await api(page, 'DELETE', `/api/users/${viewer.id}`);
    await deleteTestSpace(page, space);
    await browser?.close();
  });

  it('answers a question about a photo of a handwritten note and keeps the photo with the conversation', async () => {
    await page.goto(`${base()}/dashboard`, { waitUntil: 'networkidle2' });
    await dismissChangelog(page);
    await page.waitForSelector('.dashboard-ask .space-trigger', { timeout: 15000 });
    await chooseAskSpace(page, space.name, '.dashboard-ask');
    await attach('.dashboard-ask', photo);
    await page.type('.dashboard-ask textarea', 'Wer soll laut meiner Notiz die Umzugsfirma anrufen?');
    await page.keyboard.press('Enter');

    await page.waitForFunction(() => /^\/ask\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('article.message.assistant:not(.live)').length >= 1, { timeout: 180000 });
    const answer = await page.$eval('article.message.assistant:not(.live) .answer', (el) => (el as HTMLElement).innerText);
    await takeScreenshot(page, 'attachments-01-answer');
    expect(answer).toContain('Mira');
    expect(await page.$('article.message.user app-message-attachments img')).not.toBeNull();

    const conversationId = page.url().split('/ask/')[1];
    const detail = await api(page, 'GET', `/api/ai/conversations/${conversationId}`);
    const sent = detail.body.messages[0].attachments;
    expect(sent.map((a: any) => a.fileName)).toEqual(['handwritten-note.jpg']);
    attachmentId = sent[0].id;
    const content = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/ai/attachments/${id}/content`, { credentials: 'include' });
      return { status: res.status, type: res.headers.get('content-type') };
    }, attachmentId);
    expect(content).toEqual({ status: 200, type: 'image/jpeg' });
  }, 300000);

  it('keeps the file away from everyone else', async () => {
    viewer = await createViewer(page);
    const viewerPage = await loginInNewContext(browser, viewer.email, viewer.password);
    try {
      const content = await viewerPage.evaluate(async (id: string) => (await fetch(`/api/ai/attachments/${id}/content`, { credentials: 'include' })).status, attachmentId);
      expect(content).toBe(404);
      expect((await api(viewerPage, 'POST', '/api/ai/attachments/read', { attachmentIds: [attachmentId] })).status).toBe(404);
    } finally {
      await viewerPage.browserContext().close();
    }
  }, 120000);

  it('turns away files it cannot read', async () => {
    const program = path.join(os.tmpdir(), `setup-${Date.now()}.exe`);
    fs.writeFileSync(program, Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    try {
      await page.goto(`${base()}/ask?space=${space.spaceId}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('app-ask-composer input.file-input', { timeout: 15000 });
      const input = await page.$('app-ask-composer input.file-input');
      await input!.uploadFile(program);
      await page.waitForFunction(() => document.body.innerText.includes('was not added'), { timeout: 10000 });
      expect(await page.$('app-ask-composer .chip')).toBeNull();
    } finally {
      fs.unlinkSync(program);
    }

    // The server checks the bytes too, whatever the name says.
    const disguised = await page.evaluate(async () => {
      const form = new FormData();
      form.append('files', new Blob([new Uint8Array([0, 1, 2, 3])]), 'notes.txt');
      return (await fetch('/api/ai/attachments', { method: 'POST', body: form, credentials: 'include' })).status;
    });
    expect(disguised).toBe(415);
  }, 60000);

  it('reads a photo of a note into a quick note', async () => {
    await page.goto(`${base()}/dashboard`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.quick-note-btn', { timeout: 15000 });
    await page.click('.quick-note-btn');
    await page.waitForSelector('app-quick-capture-modal .editor-content', { timeout: 5000 });
    await attach('app-quick-capture-modal', photo);
    await page.waitForFunction(
      () => /Added to the note|Could not be read|Nothing readable/.test(document.querySelector('app-quick-capture-modal .chip')?.textContent ?? ''),
      { timeout: 180000 }
    );
    await takeScreenshot(page, 'attachments-02-quick-note');
    const note = await page.$eval('app-quick-capture-modal .editor-content', (el) => (el as HTMLElement).innerText);
    expect(note).toContain('Umzugsfirma');
    expect(note).toContain('Teamrunde');
  }, 240000);
});
