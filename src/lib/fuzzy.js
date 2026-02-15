function normalize(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

function similarityScore(query, target) {
  if (!query || !target) return 0;
  if (query === target) return 1;
  if (target.includes(query)) return 0.95;

  const queryTokens = query.split(" ");
  const targetTokens = target.split(" ");
  const tokenMatches = queryTokens.filter((token) =>
    targetTokens.some((t) => t.startsWith(token) || t.includes(token)),
  ).length;

  const tokenCoverage = tokenMatches / queryTokens.length;
  const maxLength = Math.max(query.length, target.length);
  const editDistance = levenshteinDistance(query, target);
  const editSimilarity = Math.max(0, 1 - editDistance / maxLength);

  return Math.max(editSimilarity, tokenCoverage * 0.92);
}

export function fuzzySearch(cpus, rawQuery, limit = 5) {
  const query = normalize(rawQuery);
  if (!query) return [];

  return cpus
    .map((cpu) => {
      const normalizedName = normalize(cpu.name);
      return {
        ...cpu,
        matchScore: similarityScore(query, normalizedName),
      };
    })
    .filter((cpu) => cpu.matchScore >= 0.3)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (b.cpuMark ?? 0) - (a.cpuMark ?? 0);
    })
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 5)));
}
