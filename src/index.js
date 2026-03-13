import { writeFileSync, mkdirSync } from "fs";
import { fetchGameMaster } from "./sources/game-master.js";
import { fetchPvpoke, fetchPvpRankings } from "./sources/pvpoke.js";
import { fetchPokemonGoApi } from "./sources/pokemon-go-api.js";
import { mergePokemon } from "./merge.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url).pathname;

async function build() {
  console.log("Building lily-dex API...\n");
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sourceStatus = {};

  // Fetch all sources in parallel
  console.log("Fetching sources...");
  const [gameMaster, pvpoke, pokemonGoApi] = await Promise.all([
    fetchGameMaster(),
    fetchPvpoke(),
    fetchPokemonGoApi(),
  ]);

  sourceStatus.gameMaster = gameMaster.status;
  sourceStatus.pvpoke = pvpoke.status;
  sourceStatus.pokemonGoApi = pokemonGoApi.status;

  // Fetch PvP rankings (needs speciesIdToDex from pvpoke)
  console.log("\nFetching PvP rankings...");
  const rankings = await fetchPvpRankings(pvpoke.speciesIdToDex);
  sourceStatus.rankings = rankings.status;

  // Merge Pokemon data
  console.log("\nMerging Pokemon data...");
  const pokemon = mergePokemon(gameMaster, pvpoke, pokemonGoApi);
  console.log(`  ${pokemon.length} released Pokemon`);

  // Write outputs
  console.log("\nWriting output files...");

  writeFileSync(`${OUTPUT_DIR}pokedex.json`, JSON.stringify(pokemon));
  console.log(`  pokedex.json (${pokemon.length} entries)`);

  writeFileSync(`${OUTPUT_DIR}raidboss.json`, JSON.stringify(pokemonGoApi.raids));
  console.log(`  raidboss.json`);

  writeFileSync(
    `${OUTPUT_DIR}maxbattles.json`,
    JSON.stringify(pokemonGoApi.maxBattles)
  );
  console.log(`  maxbattles.json`);

  writeFileSync(
    `${OUTPUT_DIR}quests.json`,
    JSON.stringify(pokemonGoApi.quests)
  );
  console.log(`  quests.json`);

  writeFileSync(
    `${OUTPUT_DIR}types.json`,
    JSON.stringify(pokemonGoApi.types)
  );
  console.log(`  types.json`);

  writeFileSync(
    `${OUTPUT_DIR}rankings.json`,
    JSON.stringify({ great: rankings.great, ultra: rankings.ultra })
  );
  console.log(`  rankings.json`);

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
