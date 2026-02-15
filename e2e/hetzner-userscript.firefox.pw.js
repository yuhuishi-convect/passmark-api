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

test('userscript can sort visible cards by cpu mark', async ({ page }) => {
  await page.route('https://passmark-api.dayeye2006.workers.dev/v1/cpus**', async (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get('query') || '').toLowerCase();

    let result;
    if (query.includes('i9-9999k')) {
      result = {
        id: 'intel-core-i9-9999k',
        name: 'Intel Core i9-9999K @ 3.60GHz',
        cpuMark: 8000,
      };
    } else {
      result = {
        id: 'intel-core-i7-6700',
        name: 'Intel Core i7-6700 @ 3.40GHz',
        cpuMark: 20000,
      };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 1,
        results: [result],
      }),
    });
  });

  await page.setContent(
    `
    <!doctype html>
    <html>
      <body>
        <ul class="product-list">
          <li class="border-card">
            <div class="row">
              <div class="col-lg-4 col-md-4">Intel Core i9-9999K @ 3.60GHz</div>
              <div class="col-lg-3 col-md-3">Price €250.00</div>
            </div>
          </li>
          <li class="border-card">
            <div class="row">
              <div class="col-lg-4 col-md-4">Intel Core i7-6700 @ 3.40GHz</div>
              <div class="col-lg-3 col-md-3">Price €30.00</div>
            </div>
          </li>
        </ul>
      </body>
    </html>
    `,
    { waitUntil: 'domcontentloaded' },
  );

  const userscriptPath = path.resolve('userscripts/hetzner-auction-passmark.user.js');
  const userscriptText = await fs.readFile(userscriptPath, 'utf8');
  await page.addScriptTag({ content: userscriptText });

  await expect(page.locator('.passmark-auction-box[data-state="ready"]')).toHaveCount(2);

  const sortSelect = page.locator('.passmark-sort-select');
  await expect(sortSelect).toBeVisible();
  await sortSelect.selectOption('cpu');

  const firstCard = page.locator('ul.product-list > li.border-card').first();
  await expect(firstCard.locator('.passmark-auction-box')).toContainText('Intel Core i7-6700 @ 3.40GHz');
});
