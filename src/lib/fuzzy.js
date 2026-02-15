function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[a.length][b.length];
}

const GENERIC_ALPHA_TOKENS = new Set(["amd", "intel", "core", "cpu", "processor"]);

function tokenType(token) {
  const hasAlpha = /[a-z]/.test(token);
  const hasDigit = /\d/.test(token);
  if (hasAlpha && hasDigit) return "mixed";
  if (hasDigit) return "numeric";
  return "alpha";
}

function parseMixedToken(token) {
  return {
    alpha: (token.match(/[a-z]+/g) || []).join(""),
    numeric: (token.match(/\d+/g) || []).join(""),
  };
}

function tokenWeight(token) {
  const type = tokenType(token);
  if (type === "mixed") return 2.6;
  if (type === "numeric") return 2.0;
  if (GENERIC_ALPHA_TOKENS.has(token)) return 0.4;
  return 1.2;
}

function alphaSimilarity(query, target) {
  if (query === target) return 1;
  if (target.startsWith(query) || query.startsWith(target)) return 0.85;
  if (target.includes(query) || query.includes(target)) return 0.65;
  if (Math.min(query.length, target.length) >= 4 && levenshteinDistance(query, target) === 1) return 0.7;
  return 0;
}

function mixedSimilarity(query, target, targetType) {
  const q = parseMixedToken(query);

  if (targetType === "mixed") {
    const t = parseMixedToken(target);
    if (q.alpha === t.alpha && q.numeric === t.numeric) return 1;
    if (q.numeric === t.numeric && (t.alpha.startsWith(q.alpha) || q.alpha.startsWith(t.alpha))) return 0.9;
    if (q.numeric === t.numeric) return 0.25;
    if (q.alpha && t.alpha && (q.alpha === t.alpha || q.alpha.startsWith(t.alpha) || t.alpha.startsWith(q.alpha))) {
      return 0.45;
    }
    return 0;
  }

  if (targetType === "numeric") {
    return q.numeric && q.numeric === target ? 0.2 : 0;
  }

  if (targetType === "alpha") {
    return q.alpha && alphaSimilarity(q.alpha, target) * 0.45;
  }

  return 0;
}

function numericSimilarity(query, target, targetType) {
  if (targetType === "numeric") return query === target ? 1 : 0;
  if (targetType === "mixed") {
    const t = parseMixedToken(target);
    return t.numeric === query ? 0.9 : 0;
  }
  return 0;
}

function tokenSimilarity(queryToken, targetToken) {
  const qType = tokenType(queryToken);
  const tType = tokenType(targetToken);

  if (queryToken === targetToken) return 1;

  if (qType === "mixed") return mixedSimilarity(queryToken, targetToken, tType);
  if (qType === "numeric") return numericSimilarity(queryToken, targetToken, tType);

  if (qType === "alpha") {
    if (tType === "alpha") return alphaSimilarity(queryToken, targetToken);
    if (tType === "mixed") {
      const t = parseMixedToken(targetToken);
      return alphaSimilarity(queryToken, t.alpha) * 0.85;
    }
  }

  return 0;
}

function scoreCpuMatch(rawQuery, rawTarget) {
  const query = normalize(rawQuery);
  const target = normalize(rawTarget);

  if (!query || !target) return 0;
  if (query === target) return 1;

  const queryTokens = query.split(" ");
  const targetTokens = target.split(" ");

  let weightedSum = 0;
  let totalWeight = 0;
  let mixedTokens = 0;
  let mixedStrongHits = 0;
  let mixedMeaningfulAlpha = 0;
  let mixedMeaningfulAlphaHits = 0;
  let meaningfulAlphaTokens = 0;
  let meaningfulAlphaHits = 0;

  for (const queryToken of queryTokens) {
    const weight = tokenWeight(queryToken);
    let best = 0;
    const qType = tokenType(queryToken);

    for (const targetToken of targetTokens) {
      const score = tokenSimilarity(queryToken, targetToken);
      if (score > best) best = score;
      if (best === 1) break;
    }

    if (qType === "mixed") {
      mixedTokens += 1;
      if (best >= 0.55) mixedStrongHits += 1;

      const mixed = parseMixedToken(queryToken);
      if (mixed.alpha.length >= 2 && !GENERIC_ALPHA_TOKENS.has(mixed.alpha)) {
        mixedMeaningfulAlpha += 1;
        let alphaBest = 0;
        for (const targetToken of targetTokens) {
          const targetType = tokenType(targetToken);
          const alphaTarget = targetType === "mixed" ? parseMixedToken(targetToken).alpha : targetToken;
          alphaBest = Math.max(alphaBest, alphaSimilarity(mixed.alpha, alphaTarget));
          if (alphaBest >= 0.85) break;
        }
        if (alphaBest >= 0.85) mixedMeaningfulAlphaHits += 1;
      }
    }

    if (qType === "alpha" && !GENERIC_ALPHA_TOKENS.has(queryToken)) {
      meaningfulAlphaTokens += 1;
      if (best >= 0.85) meaningfulAlphaHits += 1;
    }

    weightedSum += best * weight;
    totalWeight += weight;
  }

  let score = totalWeight ? weightedSum / totalWeight : 0;

  const compactQuery = query.replace(/\s+/g, "");
  const compactTarget = target.replace(/\s+/g, "");
  const editDistance = levenshteinDistance(compactQuery, compactTarget);
  const editSimilarity = Math.max(0, 1 - editDistance / Math.max(compactQuery.length, compactTarget.length));
  score = score * 0.9 + editSimilarity * 0.1;

  if (mixedTokens > 0 && mixedStrongHits === 0) {
    score *= 0.2;
  }

  if (meaningfulAlphaTokens > 0 && meaningfulAlphaHits === 0) {
    score *= 0.35;
  }

  if (mixedMeaningfulAlpha > 0 && mixedMeaningfulAlphaHits === 0) {
    score *= 0.3;
  }

  return clamp01(score);
}

export function fuzzySearch(cpus, rawQuery, limit = 5) {
  const query = normalize(rawQuery);
  if (!query) return [];

  const parsedLimit = Math.max(1, Math.min(50, Number(limit) || 5));

  return cpus
    .map((cpu) => {
      const matchScore = scoreCpuMatch(query, cpu.name || "");
      return { ...cpu, matchScore };
    })
    .filter((cpu) => cpu.matchScore >= 0.45)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (b.cpuMark ?? 0) - (a.cpuMark ?? 0);
    })
    .slice(0, parsedLimit);
}
