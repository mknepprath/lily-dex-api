import { fetchWithCache } from "../utils.js";

const BASE = "https://pokemon-go-api.github.io/pokemon-go-api/api";

export async function fetchPokemonGoApi() {
  const [pokedex, raids, maxBattles, quests, types] = await Promise.all([
    fetchWithCache("pokedex", `${BASE}/pokedex.json`),
    fetchWithCache("raids", `${BASE}/raidboss.json`),
    fetchWithCache("max-battles", `${BASE}/maxbattles.json`),
    fetchWithCache("quests", `${BASE}/quests.json`),
    fetchWithCache("types", `${BASE}/types.json`),
  ]);

  // Build lookup maps from pokedex for supplementary data
  const namesByDex = new Map();
  const assetsByDex = new Map();
  const assetFormsByDex = new Map();

  if (!Array.isArray(pokedex.data)) {
    console.error("  Pokemon GO API pokedex data is not an array, skipping parse");
    return {
      pokedex: [], raids: raids.data || [], maxBattles: maxBattles.data || [],
      quests: quests.data || [], types: types.data || [],
      namesByDex, assetsByDex, assetFormsByDex,
      status: { pokedex: "error", raids: raids.status, maxBattles: maxBattles.status, quests: quests.status, types: types.status },
    };
  }

  for (const entry of pokedex.data) {
    if (!entry || !entry.dexNr) continue;
    const dex = entry.dexNr;
    if (!namesByDex.has(dex)) {
      namesByDex.set(dex, entry.names);
    }
    if (entry.assets) {
      assetsByDex.set(dex, entry.assets);
    }
    if (entry.assetForms?.length > 0) {
      assetFormsByDex.set(dex, entry.assetForms);
    }
  }

  return {
    pokedex: pokedex.data,
    raids: raids.data,
    maxBattles: maxBattles.data,
    quests: quests.data,
    types: types.data,
    namesByDex,
    assetsByDex,
    assetFormsByDex,
    status: {
      pokedex: pokedex.status,
      raids: raids.status,
      maxBattles: maxBattles.status,
      quests: quests.status,
      types: types.status,
    },
  };
}
