// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const SS_DIR = path.join(__dirname, 'screenshots');

test.describe('ClickLaboral landing — smoke', () => {

  test('page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors, `JS errors:\n${errors.join('\n')}`).toHaveLength(0);
    await expect(page).toHaveTitle(/ClickLaboral|Cumplimiento/i);
  });

  test('nav links present', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const links = page.locator('nav a');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('hero CTA visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Primary hero CTA — WhatsApp button in hero
    const heroCta = page.locator('.hero-ctas a, .hero-ctas button').first();
    await expect(heroCta).toBeVisible();
  });

  test('pricing cards link to checkout, not WhatsApp', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const pricingCtas = page.locator('.precio-cta-main');
    const count = await pricingCtas.count();
    expect(count).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < count; i++) {
      const href = await pricingCtas.nth(i).getAttribute('href');
      expect(href, `Plan ${i} CTA`).toMatch(/checkout\.html/);
      expect(href, `Plan ${i} not WhatsApp`).not.toMatch(/wa\.me/);
    }
  });

  test('WhatsApp FAB is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const fab = page.locator('.wa-fab');
    await expect(fab).toBeVisible();

    const href = await fab.getAttribute('href');
    expect(href).toMatch(/wa\.me/);
  });

  test('FAQ accordion opens', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const firstItem = page.locator('.faq-item').first();
    await firstItem.scrollIntoViewIfNeeded();

    const question = firstItem.locator('.faq-q');
    await question.click();
    await page.waitForTimeout(350); // let animation finish

    // After opening, faq-item should have class 'open'
    await expect(firstItem).toHaveClass(/open/);

    // Close
    await question.click();
    await page.waitForTimeout(350);
    await expect(firstItem).not.toHaveClass(/open/);
  });

  // ── Screenshots ───────────────────────────────────────────────────────────

  test('screenshot: desktop hero', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // reveal animations

    await page.screenshot({
      path: `${SS_DIR}/desktop-hero.png`,
    });
  });

  test('screenshot: desktop pricing', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const pricing = page.locator('#precios').first();
    await pricing.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    await page.screenshot({
      path: `${SS_DIR}/desktop-pricing.png`,
    });
  });

  test('screenshot: mobile hero', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'mobile') return;

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: `${SS_DIR}/mobile-hero.png`,
    });
  });

  test('screenshot: mobile pricing', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'mobile') return;

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const pricing = page.locator('#precios').first();
    await pricing.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    await page.screenshot({
      path: `${SS_DIR}/mobile-pricing.png`,
    });
  });
});
