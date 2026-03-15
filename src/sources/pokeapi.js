/**
 * Fetch evolution chain data from PokeAPI.
 * Returns a map of dex number → full family (all dex numbers in the chain).
 */
import { existsSync, readFileSync, writeFileSync } from "fs";

const BASE = "https://pokeapi.co/api/v2";
const CACHE_PATH = new URL("../../cache/pokeapi-evolution-chains.json", import.meta.url).pathname;
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
        if (!chain) continue;
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

    // Cache the result
    writeFileSync(CACHE_PATH, JSON.stringify(familyByDex));
    console.log(`  pokeapi-evolution-chains: fresh (${Object.keys(familyByDex).length} species)`);
    return { familyByDex: toMap(familyByDex), status: "fresh" };
  } catch (err) {
    console.warn(`  pokeapi-evolution-chains: fetch failed (${err.message}), using cache`);
    if (existsSync(CACHE_PATH)) {
      const data = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
      return { familyByDex: toMap(data), status: "cached", error: err.message };
    }
    console.warn("  pokeapi-evolution-chains: no cache available");
    return { familyByDex: new Map(), status: "error", error: err.message };
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
