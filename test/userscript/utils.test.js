import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeCpuQuery,
  parseEuroPriceFromText,
  pickCpuLineFromText,
  scorePerEuro,
} from "../../src/lib/hetznerUserscriptUtils.js";

test("normalizeCpuQuery normalizes spaces and casing", () => {
  assert.equal(normalizeCpuQuery("  Intel   Core I7-6700  "), "intel core i7-6700");
});

test("parseEuroPriceFromText extracts monthly euro price", () => {
  const text = "Price €39.00 Setup €0.00";
  assert.equal(parseEuroPriceFromText(text), 39);
});

test("pickCpuLineFromText selects likely cpu line", () => {
  const text = `
    AuctionID: 12345
    Intel Core i7-6700 @ 3.40GHz
    64 GB DDR4 ECC
    Price €39.00
  `;

  assert.equal(pickCpuLineFromText(text), "Intel Core i7-6700 @ 3.40GHz");
});

test("scorePerEuro computes division", () => {
  assert.equal(scorePerEuro(8037, 39).toFixed(2), "206.08");
});
