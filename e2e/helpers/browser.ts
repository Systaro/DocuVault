import puppeteer, { Browser, Page } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';

const screenshotsDir = path.join(__dirname, '..', 'screenshots');

export function loadEnv(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env file not found. Create e2e/.env with BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD.');
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export async function launchBrowser(): Promise<Browser> {
  const headless = process.env.HEADLESS !== 'false';
  return puppeteer.launch({
    headless: headless ? true : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });
}

export async function takeScreenshot(page: Page, name: string): Promise<string> {
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  const filepath = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

export async function loginAsAdmin(page: Page): Promise<void> {
  const baseUrl = process.env.BASE_URL!;
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]', { timeout: 10000 });

  // Use delay for Angular model binding
  await page.type('input[name="email"]', process.env.ADMIN_EMAIL!, { delay: 10 });
  await page.type('input[name="password"]', process.env.ADMIN_PASSWORD!, { delay: 10 });
  await page.click('button[type="submit"]');

  // SPA: wait for URL change to /dashboard
  await page.waitForFunction(
    () => window.location.pathname === '/dashboard',
    { timeout: 15000 }
  );
}

/**
 * Finds and clicks a button or link by its text content.
 * Searches both <button> and <a> elements.
 */
export async function clickButtonByText(page: Page, text: string): Promise<void> {
  const clicked = await page.evaluate((searchText) => {
    const elements = Array.from(document.querySelectorAll('button, a.btn, a[routerLink]'));
    for (const el of elements) {
      if (el.textContent?.trim().includes(searchText)) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, text);

  if (!clicked) {
    throw new Error(`Button/link with text "${text}" not found on the page`);
  }
}
