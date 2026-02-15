import fs from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from '@playwright/test';

test.setTimeout(120000);

test('real journey: user opens Hetzner auction and sees PassMark metrics', async ({ page }) => {
  const userscriptPath = path.resolve('userscripts/hetzner-auction-passmark.user.js');
  const userscriptText = await fs.readFile(userscriptPath, 'utf8');
  await page.addInitScript(userscriptText);

  await page.goto('https://www.hetzner.com/sb/', { waitUntil: 'domcontentloaded' });

  const card = page.locator('ul.product-list > li.border-card').first();
  await expect(card).toBeVisible({ timeout: 60000 });

  const readyBox = page.locator('.passmark-auction-box[data-state="ready"]').first();
  await expect(readyBox).toBeVisible({ timeout: 90000 });

  await expect(readyBox).toContainText('CPU Mark');
  await expect(readyBox).toContainText('Score / €');
});
