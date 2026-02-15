function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toCpuMark(raw) {
  const numeric = Number((raw || "").replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(numeric)) return null;
  return numeric;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toAbsoluteCpuUrl(href) {
  try {
    return new URL(href, "https://www.cpubenchmark.net/").toString();
  } catch {
    return `https://www.cpubenchmark.net/${String(href || "").replace(/^\//, "")}`;
  }
}

export function parseCpuTable(html) {
  const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  const cpus = [];
  const cpuLinkPattern = /<a[^>]*href="([^"]*(?:cpu_lookup\.php\?cpu=|cpu\.php\?cpu=|cpu\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/i;

  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 2) continue;

    const linkCellIndex = cells.findIndex((cell) => cpuLinkPattern.test(cell));
    if (linkCellIndex < 0) continue;

    const linkMatch = cells[linkCellIndex].match(cpuLinkPattern);
    if (!linkMatch) continue;

    const cpuName = decodeHtmlEntities(stripTags(linkMatch[2]));
    if (!cpuName) continue;

    const cpuUrl = toAbsoluteCpuUrl(decodeHtmlEntities(linkMatch[1]));
    let cpuMark = null;

    for (let i = linkCellIndex + 1; i < cells.length; i += 1) {
      const parsed = toCpuMark(stripTags(cells[i]));
      if (parsed !== null) {
        cpuMark = parsed;
        break;
      }
    }

    if (cpuMark === null) {
      for (let i = 0; i < cells.length; i += 1) {
        if (i === linkCellIndex) continue;
        const parsed = toCpuMark(stripTags(cells[i]));
        if (parsed !== null) {
          cpuMark = parsed;
          break;
        }
      }
    }

    if (cpuMark === null) continue;

    const rank = cpus.length + 1;
    const id = `${slugify(cpuName)}-${cpuMark}`;

    cpus.push({
      id,
      name: cpuName,
      cpuMark,
      rank,
      sourceUrl: cpuUrl,
    });
  }

  return cpus;
}

async function fetchPassmarkHtml(sourceUrl) {
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "passmark-api-worker/1.0 (+https://workers.dev)",
    },
  });

  if (!response.ok) {
    throw new Error(`PassMark scrape failed with status ${response.status}`);
  }

  return response.text();
}

async function fetchPassmarkHtmlWithBrowser(sourceUrl, env) {
  if (!env?.BROWSER) {
    throw new Error("Browser binding is not configured");
  }

  const puppeteerModule = await import("@cloudflare/puppeteer");
  const puppeteer = puppeteerModule.default;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let browser = null;
    try {
      browser = await puppeteer.launch(env.BROWSER, { keep_alive: 60000 });
      const page = await browser.newPage();
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
      return await page.content();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes("429") || message.toLowerCase().includes("rate limit");
      if (!isRateLimit || attempt === 3) break;
      const delayMs = 1200 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runBrowserProbe(env, probeUrl = "https://example.com") {
  if (!env?.BROWSER) {
    throw new Error("Browser binding is not configured");
  }

  const puppeteerModule = await import("@cloudflare/puppeteer");
  const puppeteer = puppeteerModule.default;
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 60000 });

  try {
    const page = await browser.newPage();
    await page.goto(probeUrl, { waitUntil: "domcontentloaded" });
    const title = await page.title();
    const html = await page.content();
    const diagnostics = await page.evaluate(() => {
      const cpuLinks = Array.from(document.querySelectorAll("a[href*='cpu']"))
        .slice(0, 12)
        .map((node) => node.getAttribute("href"));
      return {
        totalLinks: document.querySelectorAll("a").length,
        cpuLinksSample: cpuLinks,
      };
    });
    return { probeUrl, title, htmlLength: html.length, ...diagnostics };
  } finally {
    await browser.close();
  }
}

export async function scrapePassmarkScores(sourceUrl, env) {
  let html;
  let scrapeMethod = "fetch";
  let fetchError = null;

  try {
    html = await fetchPassmarkHtml(sourceUrl);
  } catch (error) {
    fetchError = error;
  }

  let cpus = html ? parseCpuTable(html) : [];
  if (html && !cpus.length) {
    fetchError = new Error("fetch response parsed 0 CPU rows");
  }

  if (!cpus.length) {
    try {
      html = await fetchPassmarkHtmlWithBrowser(sourceUrl, env);
      cpus = parseCpuTable(html);
      scrapeMethod = "browser";
    } catch (browserError) {
      const fetchMessage = fetchError instanceof Error ? fetchError.message : "unknown fetch error";
      const browserMessage = browserError instanceof Error ? browserError.message : "unknown browser error";
      throw new Error(
        `No CPU rows were parsed from PassMark response (fetch: ${fetchMessage}; browser: ${browserMessage})`,
      );
    }
  }

  if (!cpus.length) {
    throw new Error("No CPU rows were parsed from PassMark response");
  }

  return { cpus, scrapeMethod };
}
