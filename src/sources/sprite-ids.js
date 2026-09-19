/**
 * Resolve each Pokemon form to its PokeAPI sprite id, at build time.
 *
 * The app used to fetch PokeAPI's 1,500-entry Pokemon list on every launch, on
 * every device, to build this mapping itself — and fell back to an empty map on
 * any failure, which silently reverted all 326 alternate forms (every mega,
 * every regional) to base-species art. Resolving here puts the id on the entry
 * it describes, so it travels and caches with the rest of the Pokemon data and
 * the app makes no runtime call to PokeAPI at all.
 *
 * This is a port of the app's former Swift resolver; the two must agree.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";

const LIST_URL = "https://pokeapi.co/api/v2/pokemon?limit=1500";
// Owned, not cached: PokeAPI's alternate-form ids only grow, one generation at
// a time, and a partial list would quietly strip sprites from existing forms.
const DATA_PATH = new URL("../../data/pokeapi-form-ids.json", import.meta.url).pathname;

// PokeAPI uses short region names; Game Master uses the adjectives.
const REGION_VARIANTS = { galar: "galarian", hisui: "hisuian", paldea: "paldean" };
// PokeAPI uses digits; Game Master spells some out ("zygarde-10" → ZYGARDE_TEN).
const NUMBER_VARIANTS = { 10: "ten", 50: "fifty" };

/** PokeAPI's alternate-form ids (10000 and up), keyed by name. Never shrinks. */
export async function fetchFormIds() {
  const stored = existsSync(DATA_PATH) ? JSON.parse(readFileSync(DATA_PATH, "utf-8")) : null;
  try {
    const res = await fetch(LIST_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { results } = await res.json();

    const formIds = {};
    for (const { name, url } of results || []) {
      const id = parseInt(url.replace(/\/$/, "").split("/").pop(), 10);
      if (id >= 10000) formIds[name] = id;
    }

    const count = Object.keys(formIds).length;
    const storedCount = stored ? Object.keys(stored).length : 0;
    if (count < storedCount) {
      console.warn(`  pokeapi-form-ids: got ${count}, stored has ${storedCount} — keeping stored copy`);
      return { formIds: stored, status: "cached", error: `shrunk (${count} < ${storedCount})` };
    }
    writeFileSync(DATA_PATH, JSON.stringify(formIds));
    console.log(`  pokeapi-form-ids: fresh (${count} forms)`);
    return { formIds, status: "fresh" };
  } catch (err) {
    console.warn(`  pokeapi-form-ids: fetch failed (${err.message}), using stored copy`);
    if (stored) return { formIds: stored, status: "cached", error: err.message };
    return { formIds: {}, status: "error", error: err.message };
  }
}

/** Game Master formId → PokeAPI sprite id, including the naming variants. */
export function buildSpriteMap(formIds) {
  const toFormId = (name) => name.replace(/-/g, "_").toUpperCase();
  const replaceSegment = (name, from, to) =>
    name.split(`-${from}-`).join(`-${to}-`).replace(new RegExp(`-${from}$`), `-${to}`);

  const map = {};
  for (const [name, id] of Object.entries(formIds)) {
    map[toFormId(name)] = id;

    let regional = name;
    for (const [short, long] of Object.entries(REGION_VARIANTS)) {
      regional = replaceSegment(regional, short, long);
    }
    const variants = regional === name ? [name] : [name, regional];
    if (regional !== name) map[toFormId(regional)] = id;

    for (const variant of variants) {
      let spelled = variant;
      for (const [digit, word] of Object.entries(NUMBER_VARIANTS)) {
        spelled = replaceSegment(spelled, digit, word);
      }
      if (spelled !== variant) map[toFormId(spelled)] = id;
    }
  }
  return map;
}

/** Exact match, then drop trailing segments (ZACIAN_CROWNED_SWORD → ZACIAN_CROWNED), else the dex number. */
export function resolveSpriteId(formId, dexNr, spriteMap) {
  if (!formId) return dexNr;
  if (spriteMap[formId]) return spriteMap[formId];
  const parts = formId.split("_");
  while (parts.length > 1) {
    parts.pop();
    const shorter = parts.join("_");
    if (spriteMap[shorter]) return spriteMap[shorter];
  }
  return dexNr;
}

/** Stamp a spriteId onto every entry and every form, in place. */
export function annotateSpriteIds(pokemon, spriteMap) {
  let forms = 0;
  let resolved = 0;
  for (const p of pokemon) {
    p.spriteId = resolveSpriteId(p.formId, p.dexNr, spriteMap);
    for (const form of Object.values(p.regionForms || {})) {
      form.spriteId = resolveSpriteId(form.formId, form.dexNr, spriteMap);
      forms++;
      if (form.spriteId !== form.dexNr) resolved++;
    }
  }
  return { forms, resolved };
}
