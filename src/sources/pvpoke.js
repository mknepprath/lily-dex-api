import { fetchWithCache, moveIdToName } from "../utils.js";

const BASE =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data";

export async function fetchPvpoke() {
  const { data, status, error } = await fetchWithCache(
    "pvpoke",
    `${BASE}/gamemaster/pokemon.json`
  );

  // Build lookup by dex number
  // pvpoke has multiple entries per dex (forms), so collect all
  const releasedDex = new Set();
  const tagsByDex = new Map();
  const buddyByDex = new Map();
  const familyByDex = new Map();
  const thirdMoveCostByDex = new Map();
  const defaultIVsByDex = new Map();
  const speciesIdToDex = new Map();
  const speciesIdToName = new Map();
  const movesBySpeciesId = new Map();

  if (!Array.isArray(data)) {
    console.error("  PvPoke data is not an array, skipping parse");
    return { releasedDex, tagsByDex, buddyByDex, familyByDex, thirdMoveCostByDex, defaultIVsByDex, speciesIdToDex, status: "error", error: "Invalid data format" };
  }

  for (const entry of data) {
    if (!entry || !entry.dex) continue;
    if (entry.released) releasedDex.add(entry.dex);

    speciesIdToDex.set(entry.speciesId, entry.dex);
    if (entry.speciesName) speciesIdToName.set(entry.speciesId, entry.speciesName);

    if (entry.tags && !tagsByDex.has(entry.dex)) {
      tagsByDex.set(entry.dex, entry.tags);
    }

    if (entry.buddyDistance && !buddyByDex.has(entry.dex)) {
      buddyByDex.set(entry.dex, entry.buddyDistance);
    }

    if (entry.family && !familyByDex.has(entry.dex)) {
      familyByDex.set(entry.dex, entry.family);
    }

    if (entry.thirdMoveCost && !thirdMoveCostByDex.has(entry.dex)) {
      thirdMoveCostByDex.set(entry.dex, entry.thirdMoveCost);
    }

    if (entry.defaultIVs && !defaultIVsByDex.has(entry.dex)) {
      defaultIVsByDex.set(entry.dex, entry.defaultIVs);
    }

    // Store move lists by speciesId (includes legacy/signature moves)
    // PvPoke has `eliteMoves` (covers both fast and charged) and `eliteChargedMoves` (charged only).
    // Derive elite fast moves: any move in eliteMoves that's also in fastMoves.
    const eliteMoveSet = new Set(entry.eliteMoves || []);
    const eliteFastMoves = (entry.fastMoves || [])
      .filter((m) => eliteMoveSet.has(m))
      .map((m) => m + "_FAST");
    movesBySpeciesId.set(entry.speciesId, {
      fastMoves: (entry.fastMoves || []).map((m) => m + "_FAST"),
      chargedMoves: entry.chargedMoves || [],
      eliteChargedMoves: entry.eliteChargedMoves || [],
      eliteFastMoves,
    });
  }

  return {
    releasedDex,
    tagsByDex,
    buddyByDex,
    familyByDex,
    thirdMoveCostByDex,
    defaultIVsByDex,
    speciesIdToDex,
    speciesIdToName,
    movesBySpeciesId,
    status,
    error,
  };
}

/**
 * Scan full rankings for Pokemon whose recommended moveset includes Return
 * and who outrank their shadow counterpart. These are worth purifying.
 */
function findReturnPokemon(leagueDataArrays, speciesIdToDex) {
  const returnDexNrs = new Set();

  for (const data of leagueDataArrays) {
    if (!Array.isArray(data)) continue;

    // Build rank lookup: speciesId → rank (1-indexed)
    const ranks = new Map();
    for (let i = 0; i < data.length; i++) {
      ranks.set(data[i].speciesId, i + 1);
    }

    for (const [speciesId, rank] of ranks) {
      const entry = data[rank - 1];
      const moveset = entry.moveset || [];
      if (!moveset.includes("RETURN")) continue;

      // Compare to shadow version
      const base = speciesId.replace(/_shadow$/, "");
      const shadowId = base + "_shadow";
      const shadowRank = ranks.get(shadowId);

      // Include if Return version ranks better than shadow (or no shadow exists)
      if (!shadowRank || rank < shadowRank) {
        const dex =
          speciesIdToDex.get(speciesId) ||
          speciesIdToDex.get(base) ||
          null;
        if (dex) returnDexNrs.add(dex);
      }
    }
  }

  return [...returnDexNrs];
}

const mapRankings = (data, speciesIdToDex, speciesIdToName) => {
  const resolveName = (id) => speciesIdToName?.get(id) || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (Array.isArray(data) ? data : []).slice(0, 100).map((entry, index) => ({
    rank: index + 1,
    speciesId: entry.speciesId,
    speciesName: entry.speciesName,
    dexNr:
      speciesIdToDex.get(entry.speciesId) ||
      speciesIdToDex.get(entry.speciesId.replace(/_shadow$/, "")) ||
      null,
    rating: entry.rating,
    moveset: entry.moveset,
    movesetNames: (entry.moveset || []).map(moveIdToName),
    matchups: (entry.matchups || []).slice(0, 5).map((m) => ({
      opponent: resolveName(m.opponent),
      dexNr: speciesIdToDex.get(m.opponent) || speciesIdToDex.get(m.opponent.replace(/_shadow$/, "")) || null,
      rating: m.rating,
    })),
    counters: (entry.counters || []).slice(0, 5).map((m) => ({
      opponent: resolveName(m.opponent),
      dexNr: speciesIdToDex.get(m.opponent) || speciesIdToDex.get(m.opponent.replace(/_shadow$/, "")) || null,
      rating: m.rating,
    })),
  }));
};

export async function fetchPvpRankings(speciesIdToDex, speciesIdToName) {
  const RANKINGS_BASE = `${BASE}/rankings/all/overall`;

  const [little, great, ultra, master] = await Promise.all([
    fetchWithCache("rankings-500", `${RANKINGS_BASE}/rankings-500.json`),
    fetchWithCache("rankings-1500", `${RANKINGS_BASE}/rankings-1500.json`),
    fetchWithCache("rankings-2500", `${RANKINGS_BASE}/rankings-2500.json`),
    fetchWithCache("rankings-10000", `${RANKINGS_BASE}/rankings-10000.json`),
  ]);

  // Find Pokemon where purified (with Return) outranks shadow in any league
  const returnPokemon = findReturnPokemon(
    [little.data, great.data, ultra.data, master.data],
    speciesIdToDex
  );

  return {
    little: mapRankings(little.data, speciesIdToDex, speciesIdToName),
    great: mapRankings(great.data, speciesIdToDex, speciesIdToName),
    ultra: mapRankings(ultra.data, speciesIdToDex, speciesIdToName),
    master: mapRankings(master.data, speciesIdToDex, speciesIdToName),
    returnPokemon,
    status: { little: little.status, great: great.status, ultra: ultra.status, master: master.status },
  };
}

/**
 * Parse GBL event titles to extract specialty cup identifiers.
 * Handles multiple naming formats:
 *   "Ultra League and Fantasy Cup: Great League Edition | Memories in Motion"
 *   "2025 Championship Series Cup and Master League: Mega Edition"
 *   "Fantasy Cup: Great League Edition | Memories in Motion"
 */
const STANDARD_LEAGUES = new Set(["great league", "ultra league", "master league"]);

function parseCupsFromEvents(events) {
  const cups = new Map(); // id → display name

  for (const event of events) {
    if (event.tag !== "GBL") continue;
    // Strip season suffix: "| Memories in Motion" etc.
    const title = (event.title || "").replace(/\s*\|.*$/, "").trim();

    // Split on "and" or commas to isolate each segment, then check for "{Name} Cup"
    const segments = title.split(/\s*(?:,\s*|\band\b)\s*/);
    for (const segment of segments) {
      const match = segment.match(/^(.*?)\s+Cup\b/i);
      if (!match) continue;
      // Strip edition suffix: "Fantasy Cup: Great League Edition" → "Fantasy"
      const rawName = match[1].replace(/:.*$/, "").trim();
      if (STANDARD_LEAGUES.has(rawName.toLowerCase())) continue;
      // Strip leading year/numbers: "2025 Championship Series" → "Championship Series"
      const cleanName = rawName.replace(/^\d+\s+/, "");
      const id = cleanName.toLowerCase().replace(/\s+/g, "");
      cups.set(id, `${cleanName} Cup`);
    }
  }

  return [...cups.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * Fetch rankings for active specialty cups from PvPoke.
 * Silently skips cups with no data available.
 */
export async function fetchCupRankings(events, speciesIdToDex, speciesIdToName) {
  const cups = parseCupsFromEvents(events);
  if (cups.length === 0) return [];

  console.log(`  Found ${cups.length} specialty cup(s): ${cups.map((c) => c.name).join(", ")}`);

  const results = [];
  for (const cup of cups) {
    const url = `${BASE}/rankings/${cup.id}/overall/rankings-1500.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rankings = mapRankings(data, speciesIdToDex, speciesIdToName);
      if (rankings.length > 0) {
        // Get the actual last commit date for this file from GitHub API
        let lastUpdated = null;
        try {
          const commitUrl = `https://api.github.com/repos/pvpoke/pvpoke/commits?path=src/data/rankings/${cup.id}/overall/rankings-1500.json&per_page=1`;
          const commitRes = await fetch(commitUrl, { signal: AbortSignal.timeout(10000) });
          if (commitRes.ok) {
            const commits = await commitRes.json();
            if (commits.length > 0) {
              lastUpdated = commits[0].commit.committer.date;
            }
          }
        } catch { /* non-fatal */ }
        results.push({ id: cup.id, name: cup.name, cp: 1500, lastUpdated, rankings });
        console.log(`  ${cup.name}: ${rankings.length} rankings (updated ${lastUpdated || "unknown"})`);
      }
    } catch (err) {
      console.warn(`  ${cup.name}: no data available (${err.message})`);
    }
  }

  return results;
}
