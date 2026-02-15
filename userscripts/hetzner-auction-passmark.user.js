// ==UserScript==
// @name         Hetzner Auction PassMark Overlay
// @namespace    https://github.com/dayeye2006/passmark-api
// @version      0.1.0
// @description  Show CPU Mark and CPU Mark per Euro on Hetzner Server Auction cards.
// @author       passmark-api
// @match        https://www.hetzner.com/sb/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PASSMARK_API_BASE = "https://passmark-api.dayeye2006.workers.dev";
  const STYLE_ID = "passmark-auction-style";
  const BOX_CLASS = "passmark-auction-box";
  const CARD_SELECTOR = "ul.product-list > li.border-card";

  const requestCache = new Map();
  let refreshTimer = null;

  function normalizeCpuQuery(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseEuroPriceFromText(text) {
    const input = String(text || "").replace(/\s+/g, " ");
    if (!input) return null;

    const patterns = [
      /€\s*([0-9]+(?:[.,][0-9]{1,2})?)/gi,
      /([0-9]+(?:[.,][0-9]{1,2})?)\s*€/gi,
      /([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:eur|euro)\b/gi,
    ];

    const matches = [];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const raw = match[1].replace(",", ".");
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) matches.push(value);
      }
    }

    if (!matches.length) return null;
    const likelyMonthly = matches.find((value) => value >= 20 && value <= 1000);
    return likelyMonthly ?? matches[0];
  }

  function isCpuCandidate(line) {
    const normalized = String(line || "").trim();
    if (!normalized || normalized.length < 6) return false;

    const hasBrandLike =
      /(intel|amd|xeon|epyc|ryzen|core\s+i\d|atom|opteron|apple|ampere|celeron|pentium|threadripper)/i.test(
        normalized,
      );
    const hasModelLike = /\d{3,5}[a-z]{0,3}|x3d|ghz|@/i.test(normalized);

    if (!(hasBrandLike || hasModelLike)) return false;

    if (/price|setup|traffic|auctionid|support|details|vat|location|buy/i.test(normalized)) {
      return false;
    }

    return true;
  }

  function pickCpuLineFromText(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const candidates = lines.filter(isCpuCandidate);
    if (!candidates.length) return null;

    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  }

  function scorePerEuro(score, euroPrice) {
    const scoreNumber = Number(score);
    const euroNumber = Number(euroPrice);
    if (!Number.isFinite(scoreNumber) || !Number.isFinite(euroNumber) || euroNumber <= 0) return null;
    return scoreNumber / euroNumber;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${BOX_CLASS} {
        margin-top: 8px;
        padding: 8px;
        border: 1px solid #d7e4ef;
        border-radius: 6px;
        background: #f8fbfe;
        font-size: 12px;
        line-height: 1.35;
        color: #16324a;
      }
      .${BOX_CLASS} .passmark-row {
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }
      .${BOX_CLASS} .passmark-label {
        opacity: 0.8;
      }
      .${BOX_CLASS} .passmark-value {
        font-weight: 600;
      }
      .${BOX_CLASS}[data-state="loading"] .passmark-value,
      .${BOX_CLASS}[data-state="error"] .passmark-value {
        font-weight: 500;
      }
    `;

    document.head.appendChild(style);
  }

  async function fetchTopCpuMatch(cpuQuery) {
    const cacheKey = normalizeCpuQuery(cpuQuery);
    if (!cacheKey) return null;

    if (requestCache.has(cacheKey)) {
      return requestCache.get(cacheKey);
    }

    const promise = (async () => {
      const url = `${PASSMARK_API_BASE}/v1/cpus?query=${encodeURIComponent(cpuQuery)}&limit=1`;
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }

      const payload = await response.json();
      const result = payload?.results?.[0] || null;
      if (!result || typeof result.cpuMark !== "number") return null;
      return result;
    })();

    requestCache.set(cacheKey, promise);

    try {
      return await promise;
    } catch (error) {
      requestCache.delete(cacheKey);
      throw error;
    }
  }

  function getOrCreateInfoBox(card) {
    let box = card.querySelector(`.${BOX_CLASS}`);
    if (box) return box;

    box = document.createElement("div");
    box.className = BOX_CLASS;

    const actionColumn = card.querySelector(".col-lg-3, .col-md-3");
    if (actionColumn) {
      actionColumn.appendChild(box);
    } else {
      card.appendChild(box);
    }

    return box;
  }

  function setBoxState(box, state, html) {
    box.dataset.state = state;
    box.innerHTML = html;
  }

  function renderScore(box, cpuMatch, priceEur) {
    const cpuMark = cpuMatch.cpuMark;
    const spe = scorePerEuro(cpuMark, priceEur);

    const cpuMarkFormatted = Number(cpuMark).toLocaleString("en-US");
    const priceFormatted = Number(priceEur).toFixed(2);

    setBoxState(
      box,
      "ready",
      `
      <div class="passmark-row"><span class="passmark-label">CPU Mark</span><span class="passmark-value">${cpuMarkFormatted}</span></div>
      <div class="passmark-row"><span class="passmark-label">Price</span><span class="passmark-value">€${priceFormatted}</span></div>
      <div class="passmark-row"><span class="passmark-label">Score / €</span><span class="passmark-value">${spe ? spe.toFixed(2) : "-"}</span></div>
      <div class="passmark-row"><span class="passmark-label">Matched CPU</span><span class="passmark-value">${cpuMatch.name}</span></div>
    `,
    );
  }

  async function enhanceCard(card) {
    const cardText = card.innerText || "";
    const cpuName = pickCpuLineFromText(cardText);
    const monthlyPrice = parseEuroPriceFromText(cardText);

    if (!cpuName || !monthlyPrice) return;

    const signature = `${normalizeCpuQuery(cpuName)}|${monthlyPrice}`;
    if (card.dataset.passmarkSignature === signature) return;

    card.dataset.passmarkSignature = signature;

    const box = getOrCreateInfoBox(card);
    setBoxState(box, "loading", `<div class="passmark-row"><span class="passmark-label">PassMark</span><span class="passmark-value">Loading...</span></div>`);

    try {
      const match = await fetchTopCpuMatch(cpuName);
      if (!match) {
        setBoxState(box, "error", `<div class="passmark-row"><span class="passmark-label">PassMark</span><span class="passmark-value">No CPU match</span></div>`);
        return;
      }

      renderScore(box, match, monthlyPrice);
    } catch (error) {
      setBoxState(box, "error", `<div class="passmark-row"><span class="passmark-label">PassMark</span><span class="passmark-value">Lookup failed</span></div>`);
    }
  }

  async function refreshAllCards() {
    ensureStyles();
    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      // eslint-disable-next-line no-await-in-loop
      await enhanceCard(card);
    }
  }

  function scheduleRefresh(delayMs = 250) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshAllCards().catch(() => {});
    }, delayMs);
  }

  function boot() {
    scheduleRefresh(50);

    const observer = new MutationObserver(() => {
      scheduleRefresh(250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
