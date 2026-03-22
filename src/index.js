import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { fetchGameMaster } from "./sources/game-master.js";
import { fetchPvpoke, fetchPvpRankings } from "./sources/pvpoke.js";
import { fetchPokemonGoApi } from "./sources/pokemon-go-api.js";
import { fetchEvents } from "./sources/events.js";
import { fetchEvolutionChains } from "./sources/pokeapi.js";
import { mergePokemon } from "./merge.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url).pathname;

async function build() {
  console.log("Building lily-dex API...\n");
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sourceStatus = {};

  // Fetch all sources in parallel
  console.log("Fetching sources...");
  const [gameMaster, pvpoke, pokemonGoApi, pokeapi] = await Promise.all([
    fetchGameMaster(),
    fetchPvpoke(),
    fetchPokemonGoApi(),
    fetchEvolutionChains(),
  ]);

  sourceStatus.gameMaster = gameMaster.status;
  sourceStatus.pvpoke = pvpoke.status;
  sourceStatus.pokemonGoApi = pokemonGoApi.status;
  sourceStatus.pokeapi = pokeapi.status;

  // Fetch PvP rankings (needs speciesIdToDex from pvpoke)
  console.log("\nFetching PvP rankings...");
  let rankings;
  try {
    rankings = await fetchPvpRankings(pvpoke.speciesIdToDex);
    sourceStatus.rankings = rankings.status;
  } catch (err) {
    console.warn(`  Rankings fetch failed: ${err.message}`);
    rankings = { great: [], ultra: [], master: [] };
    sourceStatus.rankings = "error";
  }

  // Load maintainer overrides
  const overridesPath = new URL("../data/overrides.json", import.meta.url).pathname;
  let overrides = {};
  if (existsSync(overridesPath)) {
    try {
      overrides = JSON.parse(readFileSync(overridesPath, "utf-8"));
      const count = Object.keys(overrides).length;
      if (count > 0) console.log(`  ${count} override(s) loaded`);
    } catch (err) {
      console.warn(`  Overrides failed: ${err.message}`);
    }
  }

  // Merge Pokemon data
  console.log("\nMerging Pokemon data...");
  const pokemon = mergePokemon(gameMaster, pvpoke, pokemonGoApi, pokeapi, overrides);
  console.log(`  ${pokemon.length} released Pokemon`);

  if (pokemon.length === 0) {
    throw new Error("Merge produced 0 Pokemon — aborting to avoid publishing empty data");
  }

  // Build Pokemon name → dex lookup for event matching
  const pokemonNames = new Map();
  for (const p of pokemon) {
    if (p.names?.English) {
      pokemonNames.set(p.names.English, p.dexNr);
    }
  }

  // Fetch events (non-blocking — doesn't fail the build)
  console.log("\nFetching events...");
  let eventsResult;
  try {
    eventsResult = await fetchEvents(pokemonNames);
    sourceStatus.events = eventsResult.status;
  } catch (err) {
    console.warn(`  Events fetch failed: ${err.message}`);
    eventsResult = { events: [] };
    sourceStatus.events = "error";
  }

  // Merge announcements into events
  const announcementsPath = new URL("../data/announcements.json", import.meta.url).pathname;
  if (existsSync(announcementsPath)) {
    try {
      const announcements = JSON.parse(readFileSync(announcementsPath, "utf-8"));
      let added = 0;
      for (const a of announcements) {
        if (!a.id || !a.startDate || !a.endDate) continue;
        // Skip announcements older than 30 days
        const endDate = new Date(a.endDate);
        if (endDate < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) continue;
        eventsResult.events.push({
          id: a.id,
          summary: `[LD] ${a.title}`,
          tag: "LD",
          title: a.title,
          description: a.description || "",
          startDate: a.startDate,
          endDate: a.endDate,
          isAllDay: true,
          url: a.url || null,
          imageURL: a.imageURL || null,
          pokemonDexNrs: a.pokemonDexNrs || [],
        });
        added++;
      }
      if (added > 0) {
        eventsResult.events.sort((a, b) => a.startDate.localeCompare(b.startDate));
        console.log(`  ${added} announcement(s) merged into events`);
      }
    } catch (err) {
      console.warn(`  Announcements failed: ${err.message}`);
    }
  }

  // Write outputs
  console.log("\nWriting output files...");

  writeFileSync(`${OUTPUT_DIR}pokedex.json`, JSON.stringify(pokemon));
  console.log(`  pokedex.json (${pokemon.length} entries)`);

  writeFileSync(`${OUTPUT_DIR}raidboss.json`, JSON.stringify(pokemonGoApi.raids || []));
  console.log(`  raidboss.json`);

  writeFileSync(
    `${OUTPUT_DIR}maxbattles.json`,
    JSON.stringify(pokemonGoApi.maxBattles || [])
  );
  console.log(`  maxbattles.json`);

  writeFileSync(
    `${OUTPUT_DIR}quests.json`,
    JSON.stringify(pokemonGoApi.quests || [])
  );
  console.log(`  quests.json`);

  writeFileSync(
    `${OUTPUT_DIR}types.json`,
    JSON.stringify(pokemonGoApi.types || [])
  );
  console.log(`  types.json`);

  writeFileSync(
    `${OUTPUT_DIR}events.json`,
    JSON.stringify(eventsResult.events)
  );
  console.log(`  events.json (${eventsResult.events.length} events)`);

  writeFileSync(
    `${OUTPUT_DIR}rankings.json`,
    JSON.stringify({
      great: rankings.great || [],
      ultra: rankings.ultra || [],
      master: rankings.master || [],
      returnPokemon: rankings.returnPokemon || [],
    })
  );
  console.log(`  rankings.json (${(rankings.returnPokemon || []).length} Return Pokemon)`);

  // Meta file
  const meta = {
    buildTime: new Date().toISOString(),
    sources: sourceStatus,
    pokemonCount: pokemon.length,
    version: "1.1.0",
  };
  writeFileSync(`${OUTPUT_DIR}meta.json`, JSON.stringify(meta, null, 2));
  console.log(`  meta.json`);

  console.log("\nDone!");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
