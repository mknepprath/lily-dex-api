/**
 * Fetch Pokemon GO events from multiple sources.
 *
 * Source: ScrapedDuck JSON (itself built from Leek Duck)
 * Enrichment: Leek Duck page scraping (Pokemon lists)
 *
 * Timestamps are kept as naive strings (no timezone) so the app
 * can interpret them in the user's local timezone.
 */

import { fetchWithCache } from "../utils.js";

const SCRAPEDDUCK_URL =
  "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json";

// ScrapedDuck eventType → our tag mapping
const TYPE_TO_TAG = {
  "community-day": "CD",
  "raid-battles": "RB",
  "raid-hour": "RH",
  "raid-day": "RD",
  "max-mondays": "MM",
  "max-battles": "MB",
  "go-battle-league": "GBL",
  "research": "R",
  "spotlight-hour": "SH",
  "event": "E",
  "season": "S",
  "go-pass": "GP",
  "pokemon-go-fest": "PGF",
};

export async function fetchEvents(pokemonNames) {
  console.log("  Fetching events...");

  let events = [];
  try {
    events = await fetchScrapedDuck(pokemonNames);
    console.log(`  ScrapedDuck: ${events.length} events`);
  } catch (err) {
    // No second source to fall back to — the go-calendar ICS that used to sit
    // here was itself built from this same ScrapedDuck feed, so it failed in
    // lockstep while looking like redundancy. The committed cache is the real
    // protection; if that is gone too, publishing nothing beats publishing an
    // empty feed, which the events-not-empty invariant enforces.
    console.warn(`  ScrapedDuck failed: ${err.message}`);
    return { events: [], status: "error" };
  }

  // Enrich events with Pokemon from Leek Duck pages
  await enrichFromLeekDuck(events);

  console.log(`  ${events.length} events total`);
  return { events, status: "fresh" };
}

// ─── ScrapedDuck ────────────────────────────────────────────

async function fetchScrapedDuck(pokemonNames) {
  // Cached like every other source, and now the only thing standing between a
  // ScrapedDuck outage and an empty event feed. Serving the last good copy
  // keeps events and the Battle screen's formats alive until it recovers.
  const { data, status, error } = await fetchWithCache("events-scrapedduck", SCRAPEDDUCK_URL, {
    timeout: 15000,
  });
  if (status === "cached") {
    console.warn(`  ScrapedDuck: serving cached events (${error})`);
  }

  if (!Array.isArray(data)) throw new Error("Invalid data format");

  return data
    .map((e) => parseScrapedDuckEvent(e, pokemonNames))
    .filter(Boolean)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function parseScrapedDuckEvent(entry, pokemonNames) {
  if (!entry.eventID || !entry.name) return null;
  if (/example|template|demo|test/i.test(entry.name)) return null;

  const tag = TYPE_TO_TAG[entry.eventType] || "E";
  const title = decodeHTMLEntities(entry.name);
  const summary = tag ? `[${tag}] ${title}` : title;

  // Parse dates — convert ISO to naive local strings
  const startDate = parseISOToNaive(entry.start);
  const endDate = parseISOToNaive(entry.end);
  if (!startDate || !endDate) return null;

  const isAllDay = !entry.start?.includes("T") ||
    (entry.start?.endsWith("T00:00:00") && entry.end?.endsWith("T00:00:00"));

  const url = entry.link || null;
  const imageURL = entry.image || null;

  // Extract Pokemon from extraData
  const { dexNrs: pokemonDexNrs, formByDex } = extractPokemonFromExtraData(entry, pokemonNames);
  // Forms named in the title fill the gaps the icons miss; icons win where
  // both know a form, since they describe the event's own artwork.
  for (const [dex, form] of extractMegaForms(title, pokemonNames)) {
    if (!formByDex.has(dex)) formByDex.set(dex, form);
  }
  const pokemonSpeciesIds =
    formByDex.size > 0
      ? pokemonDexNrs.map((dex) =>
          formByDex.has(dex) ? `${dex}_${formByDex.get(dex)}` : String(dex)
        )
      : null;

  return {
    id: entry.eventID,
    summary,
    tag,
    title,
    description: decodeHTMLEntities(entry.heading || ""),
    startDate,
    endDate,
    isAllDay,
    url,
    imageURL,
    pokemonDexNrs,
    ...(pokemonSpeciesIds ? { pokemonSpeciesIds } : {}),
  };
}

/**
 * Extract Pokemon dex numbers from ScrapedDuck extraData.
 * Checks raid bosses, community day spawns, and image URLs.
 */
function extractPokemonFromExtraData(entry, pokemonNames) {
  const dexNrs = new Set();
  const formByDex = new Map();
  const extra = entry.extraData || {};

  // Icons name the form directly (pm15.fMEGA.icon.png), which is more
  // reliable than the title — parsePokemonIcon reads both dex and form.
  const addIcon = (url) => {
    const p = parsePokemonIcon(url);
    if (!p || !(p.dexNr > 0 && p.dexNr < 2000)) return null;
    dexNrs.add(p.dexNr);
    if (p.form) formByDex.set(p.dexNr, p.form);
    return p.dexNr;
  };

  // Raid bosses
  const bosses = extra.raidbattles?.bosses || [];
  for (const boss of bosses) {
    addIcon(boss.image);
    // Also try name matching
    if (boss.name && pokemonNames) {
      const matched = matchNameToDex(boss.name, pokemonNames);
      if (matched) dexNrs.add(matched);
    }
  }

  // Community day spawns
  const spawns = extra.communityday?.spawns || [];
  for (const spawn of spawns) {
    addIcon(spawn.image);
    if (spawn.name && pokemonNames) {
      const matched = matchNameToDex(spawn.name, pokemonNames);
      if (matched) dexNrs.add(matched);
    }
  }

  // Also do title-based matching as fallback
  if (dexNrs.size === 0 && pokemonNames) {
    const tag = TYPE_TO_TAG[entry.eventType] || "";
    const titleMatched = matchPokemon(entry.name, tag, pokemonNames);
    for (const dex of titleMatched) dexNrs.add(dex);
  }

  return { dexNrs: [...dexNrs].sort((a, b) => a - b), formByDex };
}

/**
 * Extract dex number from a Leek Duck image URL.
 * Handles: pokemon_icon_XXX_YY.png and pmXXX.icon.png / pmXXX.cCOSTUME.icon.png
 */
export function extractDexFromImage(url) {
  if (!url) return null;
  const standard = url.match(/pokemon_icon_(\d{3,4})_\d+/);
  if (standard) return parseInt(standard[1], 10);
  const costumed = url.match(/pm(\d{1,4})(?:\.c[A-Z0-9_]+)?\.(?:s\.)?icon\.png/);
  if (costumed) return parseInt(costumed[1], 10);
  return null;
}

export function matchNameToDex(name, pokemonNames) {
  // Strip prefixes like "Mega ", "Shadow ", "Gigantamax ", "Dynamax "
  const cleaned = name
    .replace(/^(Mega|Shadow|Gigantamax|Dynamax)\s+/i, "")
    .replace(/\s*\(.*?\)/, "")
    .trim();

  const lower = cleaned.toLowerCase();
  for (const [pName, dex] of pokemonNames) {
    if (pName.toLowerCase() === lower) return dex;
  }
  // Also try the original name (for "Mega Slowbro" matching "Mega Slowbro")
  const origLower = name.toLowerCase();
  for (const [pName, dex] of pokemonNames) {
    if (pName.toLowerCase() === origLower) return dex;
  }
  return null;
}

/**
 * Convert ISO timestamp to naive local date string.
 * "2026-03-14T14:00:00+00:00" → "2026-03-14T14:00:00"
 * "2026-03-14" → "2026-03-14"
 */
export function parseISOToNaive(iso) {
  if (!iso) return null;
  // Strip timezone offset and milliseconds
  return iso
    .replace(/\.\d{3}/, "")
    .replace(/[+-]\d{2}:\d{2}$/, "")
    .replace(/Z$/, "");
}

// ─── Leek Duck Enrichment ───────────────────────────────────

async function enrichFromLeekDuck(events) {
  const toEnrich = events.filter(
    (e) => e.url && e.url.includes("leekduck.com") && e.tag !== "GBL"
  );
  if (toEnrich.length === 0) return;

  console.log(`  Enriching ${toEnrich.length} events from Leek Duck...`);
  let enriched = 0;

  for (let i = 0; i < toEnrich.length; i += 5) {
    const batch = toEnrich.slice(i, i + 5);
    await Promise.allSettled(
      batch.map(async (event) => {
        try {
          const res = await fetch(event.url, {
            signal: AbortSignal.timeout(10000),
            headers: {
              "User-Agent": "lily-dex-api/1.0 (+https://github.com/mknepprath/lily-dex-api)",
            },
          });
          if (!res.ok) return;
          const html = await res.text();
          const { dexNrs: scraped, formByDex } = extractPokemonFromHTML(html);
          if (scraped.length > 0) {
            const merged = [...new Set([...event.pokemonDexNrs, ...scraped])].sort(
              (a, b) => a - b
            );
            event.pokemonDexNrs = merged;
            // Emit species IDs aligned with pokemonDexNrs so the app can render
            // regional forms (e.g. Galarian Meowth) instead of the base sprite.
            // Forms already derived from the title are folded in first — the
            // merge above can add dex numbers, and a stale speciesIds array
            // would then point at the wrong Pokemon. Scraped icons win, since
            // they describe the event page itself.
            const formsByDex = new Map();
            for (const sid of event.pokemonSpeciesIds || []) {
              const [dex, ...form] = sid.split("_");
              if (form.length > 0) formsByDex.set(parseInt(dex, 10), form.join("_"));
            }
            for (const [dex, form] of formByDex) formsByDex.set(dex, form);
            if (formsByDex.size > 0) {
              event.pokemonSpeciesIds = merged.map((dex) =>
                formsByDex.has(dex) ? `${dex}_${formsByDex.get(dex)}` : String(dex)
              );
            }
            enriched++;
          }
        } catch {
          // Best-effort
        }
      })
    );
  }

  console.log(`  ${enriched} events enriched with Pokemon from Leek Duck`);
}

// Numeric Leek Duck icon form codes (pokemon_icon_{dex}_{code}). The
// pm{dex}.f{FORM} format names its form directly and doesn't need this map.
const ICON_FORM_CODES = {
  "31": "galarian",
  "61": "alola",
};

// Extract { dexNr, form } from a Leek Duck icon URL. `form` is a lowercase
// suffix that matches the app's regional formId (e.g. "galarian" →
// MEOWTH_GALARIAN), or null for base/costume icons.
export function parsePokemonIcon(url) {
  if (!url) return null;
  let m = url.match(/pokemon_icon_(\d{3,4})_(\d+)/);
  if (m) return { dexNr: parseInt(m[1], 10), form: ICON_FORM_CODES[m[2]] || null };
  // pm{dex}.f{FORM}.icon.png — form named directly (fGALARIAN, fHISUIAN, …)
  m = url.match(/pm(\d{1,4})\.f([A-Z0-9_]+)\.(?:s\.)?icon\.png/);
  if (m) return { dexNr: parseInt(m[1], 10), form: m[2].toLowerCase() };
  // pm{dex}.c{COSTUME}.icon.png or pm{dex}.icon.png — no regional form
  m = url.match(/pm(\d{1,4})\.(?:c[A-Z0-9_]+\.)?(?:s\.)?icon\.png/);
  if (m) return { dexNr: parseInt(m[1], 10), form: null };
  return null;
}

// Scrape a Leek Duck event page for the Pokemon it features, keeping the
// regional form of each (so the app renders the correct sprite).
export function extractPokemonFromHTML(html) {
  const dexNrs = new Set();
  const formByDex = new Map();

  const add = (url) => {
    const p = parsePokemonIcon(url);
    if (!p || !(p.dexNr > 0 && p.dexNr < 2000)) return;
    dexNrs.add(p.dexNr);
    if (p.form && !formByDex.has(p.dexNr)) formByDex.set(p.dexNr, p.form);
  };

  for (const m of html.matchAll(/pokemon_icon_\d{3,4}_\d+/g)) add(m[0]);
  for (const m of html.matchAll(/pm\d{1,4}\.[fc][A-Z0-9_]+\.(?:s\.)?icon\.png/g)) add(m[0]);

  const excludeSections = html.matchAll(
    /(?:not (?:be )?(?:allowed|eligible)|cannot (?:be used|participate))[^]*?<ul[^>]*class="pkmn-list-flex"[^>]*>([\s\S]*?)<\/ul>/gi
  );
  for (const section of excludeSections) {
    const listHTML = section[1];
    const drop = (nr) => {
      dexNrs.delete(nr);
      formByDex.delete(nr);
    };
    for (const m of listHTML.matchAll(/pokemon_icon_(\d{3,4})_\d+/g)) drop(parseInt(m[1], 10));
    for (const m of listHTML.matchAll(/pm(\d{1,4})\.[fc][A-Z0-9_]+\.(?:s\.)?icon\.png/g))
      drop(parseInt(m[1], 10));
  }

  return { dexNrs: [...dexNrs].sort((a, b) => a - b), formByDex };
}

// ─── Shared Helpers ─────────────────────────────────────────

// Decode HTML entities that leak through from scraped sources (e.g. ScrapedDuck
// titles like "PokémonXP &amp; 2026 Worlds"). Handles named and numeric
// entities; &amp; is decoded last so we don't double-decode "&amp;lt;".
export function decodeHTMLEntities(str) {
  if (typeof str !== "string" || !str.includes("&")) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function matchPokemon(title, tag, pokemonNames) {
  if (!pokemonNames || pokemonNames.size === 0) return [];

  const candidates = extractCandidateNames(title, tag);
  const matched = [];

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    for (const [name, dex] of pokemonNames) {
      if (name.toLowerCase() === lower) {
        matched.push(dex);
        break;
      }
    }
  }

  if (matched.length === 0) {
    for (const [name, dex] of pokemonNames) {
      const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
      if (regex.test(title)) {
        matched.push(dex);
      }
    }
  }

  return [...new Set(matched)];
}

/**
 * Detect mega and primal forms named in an event title, as dexNr → form
 * suffix. "Mega Gyarados in Mega Raids" → 130 → "mega".
 *
 * The suffix is what the app matches against a form's id, so it has to line
 * up with the game master form ids: mega, mega_x, mega_y, primal.
 */
export function extractMegaForms(title, pokemonNames) {
  const forms = new Map();
  if (!pokemonNames || !/\b(mega|primal)\b/i.test(title)) return forms;

  for (const [name, dex] of pokemonNames) {
    const esc = escapeRegex(name);
    // "Mega Charizard X" carries its variant letter; plain "Mega Beedrill"
    // does not. Anchor on the name so "Mega Raids" matches nothing.
    const mega = title.match(new RegExp(`\\bMega\\s+${esc}\\b(?:\\s+([XY])\\b)?`, "i"));
    if (mega) {
      forms.set(dex, mega[1] ? `mega_${mega[1].toLowerCase()}` : "mega");
    } else if (new RegExp(`\\bPrimal\\s+${esc}\\b`, "i").test(title)) {
      forms.set(dex, "primal");
    }
  }
  return forms;
}

export function extractCandidateNames(title, tag) {
  switch (tag) {
    case "CD": {
      const m = title.match(/^(.+?)\s+Community Day/i);
      return m ? [m[1]] : [];
    }
    case "RB": {
      let name = title.replace(/^Mega\s+/i, "");
      name = name.replace(/\s*\(.*?\)/, "");
      name = name.replace(/\s+in\s+.*$/i, "");
      const parts = [name.trim()];
      if (title.match(/^Mega\s+/i)) {
        parts.push(title.replace(/\s*\(.*?\)/, "").replace(/\s+in\s+.*$/i, "").trim());
      }
      if (title.match(/^Shadow\s+/i)) {
        parts.push(title.replace(/^Shadow\s+/i, "").replace(/\s*\(.*?\)/, "").replace(/\s+in\s+.*$/i, "").trim());
      }
      return parts;
    }
    case "RH": {
      let name = title.replace(/\s*\(.*?\)/, "").replace(/\s+Raid Hour$/i, "");
      return [name.trim()];
    }
    case "MM": {
      const m = title.match(/Dynamax\s+(.+?)\s+during/i);
      return m ? [m[1]] : [];
    }
    case "MB": {
      const m = title.match(/Gigantamax\s+(.+?)\s+Max/i);
      return m ? [m[1]] : [];
    }
    case "SH": {
      const m1 = title.match(/:\s*(.+)/);
      if (m1) return [m1[1].trim()];
      const m2 = title.match(/^(.+?)\s+Spotlight Hour/i);
      return m2 ? [m2[1]] : [];
    }
    default:
      return [];
  }
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
