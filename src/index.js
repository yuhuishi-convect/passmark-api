import { fuzzySearch } from "./lib/fuzzy.js";
import { runBrowserProbe, scrapePassmarkScores } from "./lib/passmark.js";

const LATEST_KEY = "snapshots/latest.json";

function getSnapshotKey(dateString) {
  return `snapshots/${dateString}.json`;
}

function getDateString(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

async function writeSnapshot(env, payload) {
  const body = JSON.stringify(payload);
  const dateString = payload.generatedAt.slice(0, 10);

  await Promise.all([
    env.PASSMARK_BUCKET.put(getSnapshotKey(dateString), body, {
      httpMetadata: {
        contentType: "application/json",
      },
    }),
    env.PASSMARK_BUCKET.put(LATEST_KEY, body, {
      httpMetadata: {
        contentType: "application/json",
      },
    }),
  ]);
}

async function readSnapshot(env, key) {
  const object = await env.PASSMARK_BUCKET.get(key);
  if (!object) return null;

  const body = await object.text();
  return JSON.parse(body);
}

async function ingestSnapshot(env, scheduledTime = Date.now()) {
  const sourceUrl = env.PASSMARK_SOURCE_URL || "https://www.cpubenchmark.net/cpu_list.php";
  const { cpus, scrapeMethod } = await scrapePassmarkScores(sourceUrl, env);
  const generatedAt = new Date(scheduledTime).toISOString();

  const payload = {
    generatedAt,
    date: getDateString(scheduledTime),
    sourceUrl,
    scrapeMethod,
    total: cpus.length,
    cpus,
  };

  await writeSnapshot(env, payload);
  return payload;
}

async function getLatestSnapshotOrError(env) {
  const latest = await readSnapshot(env, LATEST_KEY);
  if (!latest) {
    return jsonResponse(
      {
        error: "No data available yet. Wait for the first scheduled scrape or trigger a manual scrape via /v1/admin/scrape.",
      },
      404,
    );
  }

  return latest;
}

function parseLimit(value, fallback = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

function isAdminAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return true;
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  return bearerToken === env.ADMIN_TOKEN;
}

async function handleApiRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "passmark-api" });
  }

  if (url.pathname === "/v1/admin/scrape" && request.method === "POST") {
    if (!isAdminAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const payload = await ingestSnapshot(env, Date.now());
    return jsonResponse({
      ok: true,
      scraped: payload.total,
      generatedAt: payload.generatedAt,
      scrapeMethod: payload.scrapeMethod,
    });
  }

  if (url.pathname === "/v1/admin/browser-check" && request.method === "GET") {
    if (!isAdminAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const target = url.searchParams.get("url") || "https://example.com";
    const result = await runBrowserProbe(env, target);
    return jsonResponse({ ok: true, ...result });
  }

  if (url.pathname === "/v1/admin/browser-check" && request.method === "POST") {
    if (!isAdminAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const target = url.searchParams.get("url") || "https://example.com";
    const result = await runBrowserProbe(env, target);
    return jsonResponse({ ok: true, ...result });
  }

  if (url.pathname === "/v1/admin/scrape" && request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  if (url.pathname === "/v1/admin/browser-check" && request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use GET or POST." }, 405);
  }

  if (url.pathname === "/v1/snapshots/latest") {
    const latest = await getLatestSnapshotOrError(env);
    if (latest instanceof Response) return latest;
    return jsonResponse(latest);
  }

  if (url.pathname.startsWith("/v1/snapshots/")) {
    const date = url.pathname.replace("/v1/snapshots/", "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ error: "Snapshot date must use YYYY-MM-DD" }, 400);
    }

    const snapshot = await readSnapshot(env, getSnapshotKey(date));
    if (!snapshot) return jsonResponse({ error: "Snapshot not found" }, 404);
    return jsonResponse(snapshot);
  }

  if (url.pathname === "/v1/cpus") {
    const latest = await getLatestSnapshotOrError(env);
    if (latest instanceof Response) return latest;

    const query = url.searchParams.get("query") || "";
    if (!query.trim()) {
      return jsonResponse({ error: "Missing required query parameter: query" }, 400);
    }

    const limit = parseLimit(url.searchParams.get("limit"), 5);
    const matches = fuzzySearch(latest.cpus || [], query, limit);

    return jsonResponse({
      query,
      total: matches.length,
      generatedAt: latest.generatedAt,
      results: matches,
    });
  }

  if (url.pathname.startsWith("/v1/cpus/")) {
    const latest = await getLatestSnapshotOrError(env);
    if (latest instanceof Response) return latest;

    const id = decodeURIComponent(url.pathname.replace("/v1/cpus/", "").trim());
    const cpu = (latest.cpus || []).find((item) => item.id === id);

    if (!cpu) return jsonResponse({ error: "CPU not found" }, 404);

    return jsonResponse({ generatedAt: latest.generatedAt, cpu });
  }

  return jsonResponse(
    {
      error: "Route not found",
      routes: [
        "GET /health",
        "GET /v1/snapshots/latest",
        "GET /v1/snapshots/:date",
        "GET /v1/cpus?query=<name>&limit=5",
        "GET /v1/cpus/:id",
        "GET /v1/admin/browser-check?url=https://example.com",
        "POST /v1/admin/scrape",
      ],
    },
    404,
  );
}

export default {
  async fetch(request, env) {
    try {
      return await handleApiRequest(request, env);
    } catch (error) {
      return jsonResponse(
        {
          error: "Internal error",
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(ingestSnapshot(env, controller.scheduledTime));
  },
};
