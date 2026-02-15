import fs from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from '@playwright/test';

test('userscript renders cpu mark and score-per-euro on auction card', async ({ page }) => {
  await page.route('https://passmark-api.dayeye2006.workers.dev/v1/cpus**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'Intel Core i7-6700 @ 3.40GHz',
        total: 1,
        generatedAt: '2026-02-15T11:29:33.510Z',
        results: [
          {
            id: 'intel-core-i7-6700-3-40ghz-8037',
            name: 'Intel Core i7-6700 @ 3.40GHz',
            cpuMark: 8037,
            rank: 3267,
            sourceUrl: 'https://www.cpubenchmark.net/cpu_lookup.php?cpu=Intel+Core+i7-6700+%40+3.40GHz&id=2598',
            matchScore: 0.97,
          },
        ],
      }),
    });
  });

  const fixturePath = path.resolve('test/userscript/fixture-hetzner.html');
  const fixtureHtml = await fs.readFile(fixturePath, 'utf8');

  await page.setContent(fixtureHtml, { waitUntil: 'domcontentloaded' });

  const userscriptPath = path.resolve('userscripts/hetzner-auction-passmark.user.js');
  const userscriptText = await fs.readFile(userscriptPath, 'utf8');
  await page.addScriptTag({ content: userscriptText });

  const card = page.locator('ul.product-list > li.border-card').first();
  const box = card.locator('.passmark-auction-box');

  await expect(box).toBeVisible();
  await expect(box).toContainText('CPU Mark');
  await expect(box).toContainText('8,037');
  await expect(box).toContainText('Price');
  await expect(box).toContainText('€39.00');
  await expect(box).toContainText('Score / €');
  await expect(box).toContainText('206.08');
  await expect(box).toContainText('Intel Core i7-6700 @ 3.40GHz');
});
