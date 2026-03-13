import { readFileSync, writeFileSync, existsSync } from "fs";

const CACHE_DIR = new URL("../cache/", import.meta.url).pathname;

export async function fetchWithCache(name, url) {
  const cachePath = `${CACHE_DIR}${name}.json`;
  try {
    console.log(`  Fetching ${name}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    writeFileSync(cachePath, JSON.stringify(data));
    console.log(`  ${name}: fresh`);
    return { data, status: "fresh" };
  } catch (err) {
    console.warn(`  ${name}: fetch failed (${err.message}), using cache`);
    if (existsSync(cachePath)) {
      const data = JSON.parse(readFileSync(cachePath, "utf-8"));
      return { data, status: "cached", error: err.message };
    }
    throw new Error(`${name}: no cache available and fetch failed: ${err.message}`);
  }
}

export const TYPE_NAMES = {
  POKEMON_TYPE_NORMAL: "Normal",
  POKEMON_TYPE_FIGHTING: "Fighting",
  POKEMON_TYPE_FLYING: "Flying",
  POKEMON_TYPE_POISON: "Poison",
  POKEMON_TYPE_GROUND: "Ground",
  POKEMON_TYPE_ROCK: "Rock",
  POKEMON_TYPE_BUG: "Bug",
  POKEMON_TYPE_GHOST: "Ghost",
  POKEMON_TYPE_STEEL: "Steel",
  POKEMON_TYPE_FIRE: "Fire",
  POKEMON_TYPE_WATER: "Water",
  POKEMON_TYPE_GRASS: "Grass",
  POKEMON_TYPE_ELECTRIC: "Electric",
  POKEMON_TYPE_PSYCHIC: "Psychic",
  POKEMON_TYPE_ICE: "Ice",
  POKEMON_TYPE_DRAGON: "Dragon",
  POKEMON_TYPE_DARK: "Dark",
  POKEMON_TYPE_FAIRY: "Fairy",
};

export const ITEM_NAMES = {
  ITEM_SUN_STONE: "Sun Stone",
  ITEM_KINGS_ROCK: "King's Rock",
  ITEM_METAL_COAT: "Metal Coat",
  ITEM_DRAGON_SCALE: "Dragon Scale",
  ITEM_UP_GRADE: "Up-Grade",
  ITEM_GEN4_EVOLUTION_STONE: "Sinnoh Stone",
  ITEM_GEN5_EVOLUTION_STONE: "Unova Stone",
  ITEM_OTHER_EVOLUTION_STONE_A: "999 Gimmighoul Coins",
  ITEM_MAGNETIC_LURE: "Magnetic Lure Module",
  ITEM_MOSSY_LURE: "Mossy Lure Module",
  ITEM_GLACIAL_LURE: "Glacial Lure Module",
  ITEM_RAINY_LURE: "Rainy Lure Module",
};

export function getGeneration(dexNr) {
  if (dexNr <= 151) return 1;
  if (dexNr <= 251) return 2;
  if (dexNr <= 386) return 3;
  if (dexNr <= 493) return 4;
  if (dexNr <= 649) return 5;
  if (dexNr <= 721) return 6;
  if (dexNr <= 809) return 7;
  if (dexNr <= 905) return 8;
  return 9;
}

export function idToName(id) {
  if (!id || typeof id !== "string") return String(id || "Unknown");
  return id
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export function moveIdToName(id) {
  return id
    .replace(/_FAST$/, "")
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}
