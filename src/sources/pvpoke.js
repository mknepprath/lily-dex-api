import { fetchWithCache } from "../utils.js";

const URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster/pokemon.json";

export async function fetchPvpoke() {
  const { data, status, error } = await fetchWithCache("pvpoke", URL);

  // Build lookup by dex number
  // pvpoke has multiple entries per dex (forms), so collect all
  const releasedDex = new Set();
  const tagsByDex = new Map();
  const buddyByDex = new Map();
  const familyByDex = new Map();

  for (const entry of data) {
    if (entry.released) releasedDex.add(entry.dex);

    if (entry.tags && !tagsByDex.has(entry.dex)) {
      tagsByDex.set(entry.dex, entry.tags);
    }

    if (entry.buddyDistance && !buddyByDex.has(entry.dex)) {
      buddyByDex.set(entry.dex, entry.buddyDistance);
    }

    if (entry.family && !familyByDex.has(entry.dex)) {
      familyByDex.set(entry.dex, entry.family);
    }
  }

  return {
    releasedDex,
    tagsByDex,
    buddyByDex,
    familyByDex,
    status,
    error,
  };
}
