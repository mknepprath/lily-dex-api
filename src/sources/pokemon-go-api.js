import { fetchWithCache } from "../utils.js";

const BASE = "https://pokemon-go-api.github.io/pokemon-go-api/api";

export async function fetchPokemonGoApi() {
  const [pokedex, raids, maxBattles, quests] = await Promise.all([
    fetchWithCache("pokedex", `${BASE}/pokedex.json`),
    fetchWithCache("raids", `${BASE}/raidboss.json`),
    fetchWithCache("max-battles", `${BASE}/maxbattles.json`),
    fetchWithCache("quests", `${BASE}/quests.json`),
  ]);

  // Build lookup maps from pokedex for supplementary data
  const namesByDex = new Map();
  const shinyByDex = new Map();
  const assetsByDex = new Map();
  const assetFormsByDex = new Map();

  for (const entry of pokedex.data) {
    const dex = entry.dexNr;
    if (!namesByDex.has(dex)) {
      namesByDex.set(dex, entry.names);
    }
    if (entry.assets?.shinyImage) {
      shinyByDex.set(dex, true);
    }
    if (entry.assets) {
      assetsByDex.set(dex, entry.assets);
    }
    if (entry.assetForms?.length > 0) {
      assetFormsByDex.set(dex, entry.assetForms);
      // Also check assetForms for shiny
      if (entry.assetForms.some((f) => f.shinyImage)) {
        shinyByDex.set(dex, true);
      }
    }
  }

  return {
    pokedex: pokedex.data,
    raids: raids.data,
    maxBattles: maxBattles.data,
    quests: quests.data,
    namesByDex,
    shinyByDex,
    assetsByDex,
    assetFormsByDex,
    status: {
      pokedex: pokedex.status,
      raids: raids.status,
      maxBattles: maxBattles.status,
      quests: quests.status,
    },
  };
}
