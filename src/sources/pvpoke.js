import { fetchWithCache } from "../utils.js";

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

  for (const entry of data) {
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

export async function fetchPvpRankings(speciesIdToDex) {
  const RANKINGS_BASE = `${BASE}/rankings/all/overall`;

  const [great, ultra] = await Promise.all([
    fetchWithCache("rankings-1500", `${RANKINGS_BASE}/rankings-1500.json`),
    fetchWithCache("rankings-2500", `${RANKINGS_BASE}/rankings-2500.json`),
  ]);

  const mapRankings = (data) =>
    data.slice(0, 100).map((entry, index) => ({
      rank: index + 1,
      speciesId: entry.speciesId,
      speciesName: entry.speciesName,
      dexNr:
        speciesIdToDex.get(entry.speciesId) ||
        speciesIdToDex.get(entry.speciesId.replace(/_shadow$/, "")) ||
        null,
      rating: entry.rating,
      moveset: entry.moveset,
      matchups: (entry.matchups || []).slice(0, 5),
      counters: (entry.counters || []).slice(0, 5),
    }));

  return {
    great: mapRankings(great.data),
    ultra: mapRankings(ultra.data),
    status: { great: great.status, ultra: ultra.status },
  };
}
