// ==UserScript==
// @name         Hetzner Auction PassMark Overlay
// @namespace    https://github.com/dayeye2006/passmark-api
// @version      0.2.1
// @description  Show CPU Mark and CPU Mark per Euro on Hetzner Server Auction cards.
// @author       passmark-api
// @match        https://www.hetzner.com/sb
// @match        https://www.hetzner.com/sb/*
// @updateURL    https://raw.githubusercontent.com/yuhuishi-convect/passmark-api/main/userscripts/hetzner-auction-passmark.user.js
// @downloadURL  https://raw.githubusercontent.com/yuhuishi-convect/passmark-api/main/userscripts/hetzner-auction-passmark.user.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PASSMARK_API_BASE = "https://passmark-api.dayeye2006.workers.dev";
  const STYLE_ID = "passmark-auction-style";
  const BOX_CLASS = "passmark-auction-box";
  const SORT_BAR_CLASS = "passmark-sortbar";
  const SORT_SELECT_CLASS = "passmark-sort-select";
  const CARD_SELECTOR = "ul.product-list > li.border-card";
  const SORT_STORAGE_KEY = "passmark_hetzner_sort_mode";
  const SORT_DEFAULT = "default";
  const SORT_CPU = "cpu";
  const SORT_SPE = "score_per_euro";

  const requestCache = new Map();
  let refreshTimer = null;
  let currentSortMode = SORT_DEFAULT;
  let observer = null;
  let isRefreshing = false;

  function normalizeCpuQuery(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildCpuQueryCandidates(input) {
    const raw = String(input || "").trim();
    if (!raw) return [];

    const candidates = [];
    const add = (value) => {
      const normalized = String(value || "").replace(/\s+/g, " ").trim();
      if (!normalized) return;
      if (!candidates.includes(normalized)) candidates.push(normalized);
    };

    add(raw);
    add(raw.replace(/\s*@\s*[0-9]+(?:[.,][0-9]+)?\s*ghz\b/gi, ""));
    add(raw.replace(/\b(v)(\d)\b/gi, "$1 $2"));
    add(raw.replace(/\b(\w+-\d+)(v\d)\b/gi, "$1 $2"));
    add(
      raw
        .replace(/\s*@\s*[0-9]+(?:[.,][0-9]+)?\s*ghz\b/gi, "")
        .replace(/\b(\w+-\d+)(v\d)\b/gi, "$1 $2"),
    );

    return candidates;
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
      .${SORT_BAR_CLASS} {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        margin: 8px 0 12px;
        font-size: 13px;
        color: #16324a;
      }
      .${SORT_SELECT_CLASS} {
        border: 1px solid #c7d9ea;
        border-radius: 4px;
        padding: 4px 6px;
        background: #fff;
        color: #16324a;
      }
    `;

    document.head.appendChild(style);
  }

  function getSortMode() {
    if (currentSortMode === SORT_CPU || currentSortMode === SORT_SPE || currentSortMode === SORT_DEFAULT) {
      return currentSortMode;
    }

    try {
      const mode = localStorage.getItem(SORT_STORAGE_KEY) || SORT_DEFAULT;
      if (mode === SORT_CPU || mode === SORT_SPE || mode === SORT_DEFAULT) {
        currentSortMode = mode;
        return mode;
      }
      currentSortMode = SORT_DEFAULT;
      return currentSortMode;
    } catch (error) {
      currentSortMode = SORT_DEFAULT;
      return SORT_DEFAULT;
    }
  }

  function setSortMode(mode) {
    if (mode === SORT_CPU || mode === SORT_SPE || mode === SORT_DEFAULT) {
      currentSortMode = mode;
    }

    try {
      localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch (error) {
      // ignore
    }
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function ensureSortControls() {
    const list = document.querySelector("ul.product-list");
    if (!list || !list.parentElement) return;

    let bar = list.parentElement.querySelector(`.${SORT_BAR_CLASS}`);
    if (!bar) {
      bar = document.createElement("div");
      bar.className = SORT_BAR_CLASS;
      bar.innerHTML = `
        <span>Sort By</span>
        <select class="${SORT_SELECT_CLASS}">
          <option value="${SORT_DEFAULT}">Hetzner Default</option>
          <option value="${SORT_CPU}">CPU Mark (High → Low)</option>
          <option value="${SORT_SPE}">Score / € (High → Low)</option>
        </select>
      `;
      list.parentElement.insertBefore(bar, list);
    }

    const select = bar.querySelector(`.${SORT_SELECT_CLASS}`);
    if (!select) return;

    select.value = getSortMode();
    if (select.dataset.bound === "1") return;

    select.dataset.bound = "1";
    select.addEventListener("change", () => {
      setSortMode(select.value);
      applySortToVisibleCards();
    });
  }

  function ensureOriginalOrder(cards) {
    cards.forEach((card, index) => {
      if (!card.dataset.passmarkOriginalOrder) {
        card.dataset.passmarkOriginalOrder = String(index + 1);
      }
    });
  }

  function getCardsFromList(list) {
    return Array.from(list.querySelectorAll("li.border-card")).filter((card) => card.parentElement === list);
  }

  function applySortToVisibleCards() {
    const list = document.querySelector("ul.product-list");
    if (!list) return;

    const cards = getCardsFromList(list);
    if (!cards.length) return;

    ensureOriginalOrder(cards);

    const mode = getSortMode();
    const getOriginal = (card) => Number(card.dataset.passmarkOriginalOrder || 0);
    const getValue = (card) => {
      if (mode === SORT_CPU) return toNumber(card.dataset.passmarkCpuMark);
      if (mode === SORT_SPE) return toNumber(card.dataset.passmarkScorePerEuro);
      return null;
    };

    cards.sort((a, b) => {
      if (mode === SORT_DEFAULT) return getOriginal(a) - getOriginal(b);

      const aValue = getValue(a);
      const bValue = getValue(b);

      if (aValue === null && bValue === null) return getOriginal(a) - getOriginal(b);
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (bValue !== aValue) return bValue - aValue;
      return getOriginal(a) - getOriginal(b);
    });

    cards.forEach((card) => list.appendChild(card));
  }

  async function fetchTopCpuMatch(cpuQuery) {
    const queryCandidates = buildCpuQueryCandidates(cpuQuery);
    const cacheKey = queryCandidates.map(normalizeCpuQuery).join("|");
    if (!cacheKey) return null;

    if (requestCache.has(cacheKey)) {
      return requestCache.get(cacheKey);
    }

    const promise = (async () => {
      const maxAttempts = 3;

      for (const candidate of queryCandidates) {
        const url = `${PASSMARK_API_BASE}/v1/cpus?query=${encodeURIComponent(candidate)}&limit=1`;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const response = await fetch(url, {
              method: "GET",
              headers: { accept: "application/json" },
            });

            if (!response.ok) {
              const shouldRetry = response.status === 429 || response.status >= 500;
              if (shouldRetry && attempt < maxAttempts) {
                const backoff = 350 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 150);
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => setTimeout(resolve, backoff));
                continue;
              }
              throw new Error(`API ${response.status}`);
            }

            const payload = await response.json();
            const result = payload?.results?.[0] || null;
            if (!result || typeof result.cpuMark !== "number") break;
            return result;
          } catch (error) {
            if (attempt >= maxAttempts) throw error;
            const backoff = 350 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 150);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }
      }

      return null;
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
        card.dataset.passmarkCpuMark = "";
        card.dataset.passmarkScorePerEuro = "";
        setBoxState(box, "error", `<div class="passmark-row"><span class="passmark-label">PassMark</span><span class="passmark-value">No CPU match</span></div>`);
        return;
      }

      const cpuMark = Number(match.cpuMark);
      const spe = scorePerEuro(cpuMark, monthlyPrice);
      card.dataset.passmarkCpuMark = Number.isFinite(cpuMark) ? String(cpuMark) : "";
      card.dataset.passmarkScorePerEuro = Number.isFinite(spe) ? String(spe) : "";
      renderScore(box, match, monthlyPrice);
    } catch (error) {
      card.dataset.passmarkCpuMark = "";
      card.dataset.passmarkScorePerEuro = "";
      const message = error instanceof Error ? error.message : "Lookup failed";
      setBoxState(
        box,
        "error",
        `<div class="passmark-row"><span class="passmark-label">PassMark</span><span class="passmark-value">Lookup failed (${message})</span></div>`,
      );
    }
  }

  async function refreshAllCards() {
    ensureStyles();
    ensureSortControls();
    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      // eslint-disable-next-line no-await-in-loop
      await enhanceCard(card);
    }
    applySortToVisibleCards();
  }

  function scheduleRefresh(delayMs = 250) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (isRefreshing) return;
      isRefreshing = true;

      if (observer) observer.disconnect();

      refreshAllCards()
        .catch(() => {})
        .finally(() => {
          if (observer) {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
            });
          }
          isRefreshing = false;
        });
    }, delayMs);
  }

  function boot() {
    scheduleRefresh(50);

    observer = new MutationObserver((mutations) => {
      if (isRefreshing) return;

      const relevant = mutations.some((mutation) => {
        const targetElement = mutation.target instanceof Element ? mutation.target : null;
        if (!targetElement) return true;
        if (targetElement.closest(`.${BOX_CLASS}`)) return false;
        if (targetElement.closest(`.${SORT_BAR_CLASS}`)) return false;
        return true;
      });

      if (relevant) scheduleRefresh(250);
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
