export function normalizeCpuQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEuroPriceFromText(text) {
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
      if (Number.isFinite(value) && value > 0) {
        matches.push(value);
      }
    }
  }

  if (!matches.length) return null;

  const likelyMonthly = matches.find((value) => value >= 20 && value <= 1000);
  return likelyMonthly ?? matches[0];
}

function isCpuCandidate(line) {
  const normalized = String(line || "").trim();
  if (!normalized) return false;
  if (normalized.length < 6) return false;

  const hasBrandLike = /(intel|amd|xeon|epyc|ryzen|core\s+i\d|atom|opteron|apple|ampere|celeron|pentium|threadripper)/i.test(
    normalized,
  );
  const hasModelLike = /\d{3,5}[a-z]{0,3}|x3d|ghz|@/i.test(normalized);

  if (!(hasBrandLike || hasModelLike)) return false;

  if (/price|setup|traffic|auctionid|support|details|vat|location|buy/i.test(normalized)) {
    return false;
  }

  return true;
}

export function pickCpuLineFromText(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines.filter(isCpuCandidate);
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

export function scorePerEuro(score, euroPrice) {
  const scoreNumber = Number(score);
  const euroNumber = Number(euroPrice);
  if (!Number.isFinite(scoreNumber) || !Number.isFinite(euroNumber) || euroNumber <= 0) return null;
  return scoreNumber / euroNumber;
}
