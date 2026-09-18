/**
 * Fetch evolution chain data from PokeAPI.
 * Returns a map of dex number → full family (all dex numbers in the chain).
 */
import { existsSync, readFileSync, writeFileSync } from "fs";

const BASE = "https://pokeapi.co/api/v2";
// Owned, not cached: evolution chains only change when a new generation ships,
// so this file is the dataset and PokeAPI is a refresher for it. It sits in
// data/ so a routine "clear the cache" can never wipe the guard's baseline.
const CACHE_PATH = new URL("../../data/evolution-chains.json", import.meta.url).pathname;
const BATCH = 50;

export async function fetchEvolutionChains() {
  console.log("  Fetching evolution chains from PokeAPI...");

  try {
    // Get total chain count
    const countRes = await fetch(`${BASE}/evolution-chain?limit=1`);
    if (!countRes.ok) throw new Error(`HTTP ${countRes.status}`);
    const { count: totalChains } = await countRes.json();
    console.log(`  ${totalChains} evolution chains`);

    // Get all chain URLs
    const listRes = await fetch(`${BASE}/evolution-chain?limit=${totalChains}`);
    if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
    const { results } = await listRes.json();
    const chainIds = results.map((r) =>
      parseInt(r.url.match(/evolution-chain\/(\d+)/)?.[1])
    );

    // Fetch chains in batches
    const familyByDex = {};
    let fetched = 0;
    let skipped = 0;

    for (let i = 0; i < chainIds.length; i += BATCH) {
      const batch = chainIds.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            const res = await fetch(`${BASE}/evolution-chain/${id}/`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.chain ? parseChain(data.chain) : null;
          } catch {
            return null;
          }
        })
      );

      for (const chain of batchResults) {
        if (!chain) { skipped++; continue; }
        const flat = flattenChain(chain);
        for (const dex of flat) {
          familyByDex[dex] = flat;
        }
      }

      fetched += batch.length;
      if (fetched % 200 === 0 || fetched === chainIds.length) {
        console.log(`  ... ${fetched}/${chainIds.length} chains`);
      }
    }

    // Never let a partial run overwrite a complete one. Each chain is fetched
    // individually and a rate-limited or timed-out chain is skipped silently,
    // so a degraded run looks exactly like a successful smaller one. Species
    // only ever gain evolution data, so fewer entries than last time means the
    // run was incomplete, not that Pokemon stopped evolving.
    const count = Object.keys(familyByDex).length;
    if (skipped > 0) {
      console.warn(`  evolution-chains: ${skipped} chain(s) failed to fetch`);
    }
    const cachedCount = readCachedCount();
    if (cachedCount !== null && count < cachedCount) {
      console.warn(
        `  evolution-chains: run returned ${count} species, cache has ${cachedCount} — ` +
          `keeping cache (set ALLOW_EVOLUTION_SHRINK=1 to overwrite)`
      );
      if (!process.env.ALLOW_EVOLUTION_SHRINK) {
        const data = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
        return { familyByDex: toMap(data), status: "cached", error: `incomplete run (${count} < ${cachedCount})` };
      }
    }

    writeFileSync(CACHE_PATH, JSON.stringify(familyByDex));
    console.log(`  evolution-chains: fresh (${count} species)`);
    return { familyByDex: toMap(familyByDex), status: "fresh" };
  } catch (err) {
    console.warn(`  evolution-chains: fetch failed (${err.message}), using cache`);
    if (existsSync(CACHE_PATH)) {
      const data = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
      return { familyByDex: toMap(data), status: "cached", error: err.message };
    }
    console.warn("  evolution-chains: no cache available");
    return { familyByDex: new Map(), status: "error", error: err.message };
  }
}

/** Species count in the cache, or null when there is no usable cache. */
function readCachedCount() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return Object.keys(JSON.parse(readFileSync(CACHE_PATH, "utf-8"))).length;
  } catch {
    return null;
  }
}

function toMap(obj) {
  const m = new Map();
  for (const [k, v] of Object.entries(obj)) {
    m.set(parseInt(k), v);
  }
  return m;
}

function extractDex(speciesUrl) {
  const match = speciesUrl.match(/pokemon-species\/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function parseChain(node) {
  const dex = extractDex(node.species.url);
  const evolvesTo = (node.evolves_to || []).map(parseChain);
  return { dex, evolvesTo };
}

function flattenChain(node) {
  const result = [];
  if (node.dex) result.push(node.dex);
  for (const child of node.evolvesTo) {
    result.push(...flattenChain(child));
  }
  return result;
}
