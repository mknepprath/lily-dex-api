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

  if (!Array.isArray(data)) {
    console.error("  PvPoke data is not an array, skipping parse");
    return { releasedDex, tagsByDex, buddyByDex, familyByDex, thirdMoveCostByDex, defaultIVsByDex, speciesIdToDex, status: "error", error: "Invalid data format" };
  }

  for (const entry of data) {
    if (!entry || !entry.dex) continue;
    if (entry.released) releasedDex.add(entry.dex);

    speciesIdToDex.set(entry.speciesId, entry.dex);

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
  }

  return {
    releasedDex,
    tagsByDex,
    buddyByDex,
    familyByDex,
    thirdMoveCostByDex,
    defaultIVsByDex,
    speciesIdToDex,
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

export async function fetchPvpRankings(speciesIdToDex) {
  const RANKINGS_BASE = `${BASE}/rankings/all/overall`;

  const [little, great, ultra, master] = await Promise.all([
    fetchWithCache("rankings-500", `${RANKINGS_BASE}/rankings-500.json`),
    fetchWithCache("rankings-1500", `${RANKINGS_BASE}/rankings-1500.json`),
    fetchWithCache("rankings-2500", `${RANKINGS_BASE}/rankings-2500.json`),
    fetchWithCache("rankings-10000", `${RANKINGS_BASE}/rankings-10000.json`),
  ]);

  const mapRankings = (data) =>
    (Array.isArray(data) ? data : []).slice(0, 100).map((entry, index) => ({
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
      matchups: (entry.matchups || []).slice(0, 5),
      counters: (entry.counters || []).slice(0, 5),
    }));

  // Find Pokemon where purified (with Return) outranks shadow in any league
  const returnPokemon = findReturnPokemon(
    [little.data, great.data, ultra.data, master.data],
    speciesIdToDex
  );

  return {
    little: mapRankings(little.data),
    great: mapRankings(great.data),
    ultra: mapRankings(ultra.data),
    master: mapRankings(master.data),
    returnPokemon,
    status: { little: little.status, great: great.status, ultra: ultra.status, master: master.status },
  };
}
