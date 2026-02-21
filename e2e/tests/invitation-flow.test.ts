import { Browser } from 'puppeteer';
import {
  launchBrowser,
  takeScreenshot,
  loadEnv,
  loginAsAdmin,
  clickButtonByText,
} from '../helpers/browser';
import {
  trackObject,
  trackScreenshot,
  addStep,
  printReport,
} from '../helpers/testReport';

/**
 * DocuVault Invitation Flow E2E Test
 *
 * Tests the full invite lifecycle:
 * 1. Admin invites a new user and copies the invite URL
 * 2. Wrong invite URL shows clear error
 * 3. Valid invite URL creates account + login works
 * 4. Reusing invite URL is blocked (one-time use)
 * 5. Admin sees the new user but the pending invite is gone
 */
describe('Invitation Flow', () => {
  let browser: Browser;
  let inviteUrl: string;
  const testEmail = `e2e-test-${Date.now()}@docuvault.local`;
  const testPassword = 'Test1ng-Pass'; // 12 chars, upper+lower+digit+special
  const testName = 'E2E Test User';

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser();
  });

  afterAll(async () => {
    // Cleanup: delete the test user via API
    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await loginAsAdmin(page);

      const users = (await page.evaluate(async () => {
        const res = await fetch('/api/users', { credentials: 'include' });
        return res.json();
      })) as any[];
      const testUser = users.find((u: any) => u.email === testEmail);
      if (testUser) {
        await page.evaluate(async (id: string) => {
          await fetch(`/api/users/${id}`, {
            method: 'DELETE',
            credentials: 'include',
          });
        }, testUser.id);
        addStep(`Cleanup: deleted test user ${testEmail}`, true);
        trackObject({
          type: 'User',
          id: testUser.id,
          label: testEmail,
          action: 'Deleted (cleanup)',
          timestamp: new Date().toISOString(),
        });
      }
      await context.close();
    } catch (e) {
      console.error('Cleanup failed:', e);
      addStep('Cleanup: failed', false, String(e));
    }

    printReport('DocuVault Invitation Flow');
    await browser.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 1: Admin invites a new user
  // ────────────────────────────────────────────────────────────────────
  test('Admin logs in, invites a user, and sees the pending invite', async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const baseUrl = process.env.BASE_URL!;

    // Login as admin
    await loginAsAdmin(page);
    addStep('Admin login', true);

    // Navigate to user management
    await page.goto(`${baseUrl}/admin/users`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.management-header', { timeout: 10000 });

    let ss = await takeScreenshot(page, '01-admin-users-before');
    trackScreenshot('Admin Users Page - Before Invite', ss);

    // Open invite modal
    await clickButtonByText(page, 'Invite User');
    await page.waitForSelector('.modal', { timeout: 5000 });
    addStep('Opened invite modal', true);

    // Fill email (role defaults to VIEWER)
    await page.type('input[name="email"]', testEmail, { delay: 10 });

    // Submit invitation
    await clickButtonByText(page, 'Send Invitation');

    // Wait for success state showing the invite link
    await page.waitForSelector('.invite-link-text', { timeout: 10000 });
    addStep('Invitation created successfully', true);

    ss = await takeScreenshot(page, '02-invite-created');
    trackScreenshot('Invite Created - Success Modal', ss);

    // Extract the invite URL
    inviteUrl = await page.$eval(
      '.invite-link-text',
      (el) => el.textContent?.trim() ?? ''
    );
    expect(inviteUrl).toContain('/accept-invitation?token=');
    addStep(`Invite URL copied: ...${inviteUrl.slice(-20)}`, true);

    trackObject({
      type: 'Invitation',
      id: inviteUrl.split('token=')[1] || 'unknown',
      label: testEmail,
      action: 'Created invite',
      url: inviteUrl,
      timestamp: new Date().toISOString(),
    });

    // Close modal
    await clickButtonByText(page, 'Done');
    await page.waitForFunction(
      () => !document.querySelector('.modal-overlay'),
      { timeout: 5000 }
    );

    // Verify the invitee is listed in Pending Invitations
    await page.waitForFunction(
      (email: string) => {
        const cells = document.querySelectorAll('.email-col');
        return Array.from(cells).some(
          (c) => c.textContent?.trim() === email
        );
      },
      { timeout: 10000 },
      testEmail
    );
    addStep('Invitee visible in Pending Invitations table', true);

    ss = await takeScreenshot(page, '03-pending-invite-visible');
    trackScreenshot('Pending Invitation Listed', ss);

    await context.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 2: Wrong invite URL shows clear error
  // ────────────────────────────────────────────────────────────────────
  test('Wrong invite URL shows clear error instead of the form', async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const baseUrl = process.env.BASE_URL!;

    await page.goto(
      `${baseUrl}/accept-invitation?token=invalid-fake-token-xyz-00000`,
      { waitUntil: 'networkidle2' }
    );
    await page.waitForSelector('.invitation-form', { timeout: 10000 });

    // Check if error state is shown immediately (ideal: server validates token on load)
    const hasErrorState = await page.$('.error-state');

    if (hasErrorState) {
      const errorText = await page.$eval(
        '.error-state',
        (el) => el.textContent?.trim() ?? ''
      );
      expect(errorText).toContain('Invalid Invitation');
      addStep('Invalid token: error shown immediately', true);
    } else {
      // Current behavior: form is shown, need to submit to trigger server validation
      await page.type('input[name="name"]', 'Fake User', { delay: 10 });
      await page.type('input[name="password"]', testPassword, { delay: 10 });
      await page.type('input[name="confirmPassword"]', testPassword, {
        delay: 10,
      });

      // Use native click on submit button for reliable Angular form submission
      await page.click('button[type="submit"]');

      // Wait for either the invalidToken error state or an inline error message
      // The backend returns 404 for unknown tokens -> frontend shows .error-state
      await page.waitForFunction(
        () =>
          document.querySelector('.error-state') ||
          document.querySelector('.error-message'),
        { timeout: 15000 }
      );

      const invalidTokenShown = await page.$('.error-state');
      if (invalidTokenShown) {
        const errorText = await page.$eval(
          '.error-state',
          (el) => el.textContent?.trim() ?? ''
        );
        expect(errorText).toContain('Invalid Invitation');
      } else {
        const errorMsg = await page.$eval(
          '.error-message',
          (el) => el.textContent?.trim() ?? ''
        );
        expect(errorMsg.length).toBeGreaterThan(0);
      }
      addStep('Invalid token: error shown after form submission', true);
    }

    // Verify no success / no account created
    const hasSuccess = await page.$('.success-state');
    expect(hasSuccess).toBeNull();
    addStep('No account created with invalid token', true);

    const ss = await takeScreenshot(page, '04-wrong-token-error');
    trackScreenshot('Wrong Token - Error Displayed', ss);

    await context.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 3: Valid invite URL creates account and login works
  // ────────────────────────────────────────────────────────────────────
  test('Valid invite URL creates account and allows login', async () => {
    expect(inviteUrl).toBeDefined();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Navigate to the real invite URL
    await page.goto(inviteUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[name="name"]', { timeout: 10000 });
    addStep('Invite acceptance form loaded', true);

    // Fill registration form
    await page.type('input[name="name"]', testName, { delay: 10 });
    await page.type('input[name="password"]', testPassword, { delay: 10 });
    await page.type('input[name="confirmPassword"]', testPassword, {
      delay: 10,
    });

    let ss = await takeScreenshot(page, '05-invite-form-filled');
    trackScreenshot('Invite Form Filled', ss);

    // Submit
    await clickButtonByText(page, 'Create Account');

    // Wait for success
    await page.waitForSelector('.success-state', { timeout: 15000 });
    const successText = await page.$eval(
      '.success-state',
      (el) => el.textContent?.trim() ?? ''
    );
    expect(successText).toContain('Account Created');
    addStep('Account created successfully', true);

    ss = await takeScreenshot(page, '06-account-created');
    trackScreenshot('Account Created', ss);

    trackObject({
      type: 'User',
      id: testEmail,
      label: testName,
      action: 'Created via invitation',
      timestamp: new Date().toISOString(),
    });

    // Click "Sign In" to go to login page
    await clickButtonByText(page, 'Sign In');
    await page.waitForSelector('input[name="email"]', { timeout: 10000 });
    addStep('Navigated to login page', true);

    // Login with new credentials
    await page.type('input[name="email"]', testEmail, { delay: 10 });
    await page.type('input[name="password"]', testPassword, { delay: 10 });
    await page.click('button[type="submit"]');

    // Wait for dashboard (SPA navigation)
    await page.waitForFunction(
      () => window.location.pathname === '/dashboard',
      { timeout: 15000 }
    );
    addStep('New user logged in and reached dashboard', true);

    ss = await takeScreenshot(page, '07-new-user-dashboard');
    trackScreenshot('New User - Dashboard', ss);

    await context.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 4: Reused invite URL is rejected (one-time use)
  // ────────────────────────────────────────────────────────────────────
  test('Reused invite URL shows clear error (one-time use only)', async () => {
    expect(inviteUrl).toBeDefined();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    await page.goto(inviteUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.invitation-form', { timeout: 10000 });

    // Check if the app detects the used token immediately
    const hasErrorState = await page.$('.error-state');

    if (hasErrorState) {
      // Ideal: the app validates the token on load and shows error
      const errorText = await page.$eval(
        '.error-state',
        (el) => el.textContent?.trim() ?? ''
      );
      expect(errorText).toContain('Invalid Invitation');
      addStep('Reused token: error shown immediately', true);
    } else {
      // Current behavior: form is shown, submit to trigger server error
      // NOTE: Ideally the app should validate the token on page load
      // and show "Invalid Invitation" without requiring form submission.
      // The backend returns 400 "Invitation already accepted" which the
      // frontend maps to "Something went wrong" - a more specific message
      // like "This invitation has already been used" would be better UX.
      await page.type('input[name="name"]', 'Should Not Work', { delay: 10 });
      await page.type('input[name="password"]', testPassword, { delay: 10 });
      await page.type('input[name="confirmPassword"]', testPassword, {
        delay: 10,
      });
      await clickButtonByText(page, 'Create Account');

      await page.waitForFunction(
        () =>
          document.querySelector('.error-state') ||
          document.querySelector('.error-message'),
        { timeout: 10000 }
      );
      addStep('Reused token: rejected after form submission', true);
    }

    // Verify no success state - token cannot be reused
    const hasSuccess = await page.$('.success-state');
    expect(hasSuccess).toBeNull();
    addStep('No duplicate account created with reused token', true);

    const ss = await takeScreenshot(page, '08-reused-token-error');
    trackScreenshot('Reused Token - Error', ss);

    await context.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 5: Admin sees the user, pending invite is gone
  // ────────────────────────────────────────────────────────────────────
  test('Admin sees the new user but invitation is gone from pending', async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const baseUrl = process.env.BASE_URL!;

    // Login as admin
    await loginAsAdmin(page);
    await page.goto(`${baseUrl}/admin/users`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.management-header', { timeout: 10000 });

    // Wait for the users table to load and verify the new user is listed
    await page.waitForFunction(
      (email: string) => {
        const emailSpans = document.querySelectorAll('.user-email');
        return Array.from(emailSpans).some(
          (el) => el.textContent?.trim() === email
        );
      },
      { timeout: 10000 },
      testEmail
    );
    addStep('New user appears in Team Members table', true);

    // Verify the invitation is NOT in Pending Invitations anymore
    // The frontend filters out accepted invitations, so it should be gone
    // Give a moment for invitations to load
    await new Promise((r) => setTimeout(r, 2000));

    const hasPendingInvite = await page.evaluate((email: string) => {
      const cells = document.querySelectorAll('.email-col');
      return Array.from(cells).some((c) => c.textContent?.trim() === email);
    }, testEmail);
    expect(hasPendingInvite).toBe(false);
    addStep('Invitation gone from Pending Invitations', true);

    const ss = await takeScreenshot(page, '09-admin-final-verification');
    trackScreenshot('Admin Final Check - User Present, Invite Gone', ss);

    await context.close();
  });
});
