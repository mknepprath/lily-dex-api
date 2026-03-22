/**
 * Fetch Pokemon GO events from multiple sources.
 *
 * Primary: ScrapedDuck JSON (rich structured data)
 * Fallback: go-calendar ICS (community-maintained)
 * Enrichment: Leek Duck page scraping (Pokemon lists)
 *
 * Timestamps are kept as naive strings (no timezone) so the app
 * can interpret them in the user's local timezone.
 */

const SCRAPEDDUCK_URL =
  "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json";
const CALENDAR_URL =
  "https://github.com/othyn/go-calendar/releases/latest/download/gocal.ics";

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

  // Try ScrapedDuck first
  let events = [];
  let source = "none";

  try {
    events = await fetchScrapedDuck(pokemonNames);
    source = "scrapedduck";
    console.log(`  ScrapedDuck: ${events.length} events`);
  } catch (err) {
    console.warn(`  ScrapedDuck failed: ${err.message}`);
  }

  // Fallback to ICS if ScrapedDuck failed or returned nothing
  if (events.length === 0) {
    try {
      events = await fetchICS(pokemonNames);
      source = "ics";
      console.log(`  ICS fallback: ${events.length} events`);
    } catch (err) {
      console.warn(`  ICS fallback also failed: ${err.message}`);
      return { events: [], status: "error" };
    }
  }

  // Enrich events with Pokemon from Leek Duck pages
  await enrichFromLeekDuck(events);

  console.log(`  ${events.length} events total (source: ${source})`);
  return { events, status: "fresh" };
}

// ─── ScrapedDuck ────────────────────────────────────────────

async function fetchScrapedDuck(pokemonNames) {
  const res = await fetch(SCRAPEDDUCK_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data)) throw new Error("Invalid data format");

  return data
    .map((e) => parseScrapedDuckEvent(e, pokemonNames))
    .filter(Boolean)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function parseScrapedDuckEvent(entry, pokemonNames) {
  if (!entry.eventID || !entry.name) return null;
  if (/example|template|demo|test/i.test(entry.name)) return null;

  const tag = TYPE_TO_TAG[entry.eventType] || "E";
  const title = entry.name;
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
  const pokemonDexNrs = extractPokemonFromExtraData(entry, pokemonNames);

  return {
    id: entry.eventID,
    summary,
    tag,
    title,
    description: entry.heading || "",
    startDate,
    endDate,
    isAllDay,
    url,
    imageURL,
    pokemonDexNrs,
  };
}

/**
 * Extract Pokemon dex numbers from ScrapedDuck extraData.
 * Checks raid bosses, community day spawns, and image URLs.
 */
function extractPokemonFromExtraData(entry, pokemonNames) {
  const dexNrs = new Set();
  const extra = entry.extraData;
  if (!extra) return [];

  // Raid bosses
  const bosses = extra.raidbattles?.bosses || [];
  for (const boss of bosses) {
    const dex = extractDexFromImage(boss.image);
    if (dex) dexNrs.add(dex);
    // Also try name matching
    if (boss.name && pokemonNames) {
      const matched = matchNameToDex(boss.name, pokemonNames);
      if (matched) dexNrs.add(matched);
    }
  }

  // Community day spawns
  const spawns = extra.communityday?.spawns || [];
  for (const spawn of spawns) {
    const dex = extractDexFromImage(spawn.image);
    if (dex) dexNrs.add(dex);
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

  return [...dexNrs].sort((a, b) => a - b);
}

/**
 * Extract dex number from a Leek Duck image URL.
 * Handles: pokemon_icon_XXX_YY.png and pmXXX.icon.png / pmXXX.cCOSTUME.icon.png
 */
function extractDexFromImage(url) {
  if (!url) return null;
  const standard = url.match(/pokemon_icon_(\d{3,4})_\d+/);
  if (standard) return parseInt(standard[1], 10);
  const costumed = url.match(/pm(\d{1,4})(?:\.c[A-Z0-9_]+)?\.(?:s\.)?icon\.png/);
  if (costumed) return parseInt(costumed[1], 10);
  return null;
}

function matchNameToDex(name, pokemonNames) {
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
function parseISOToNaive(iso) {
  if (!iso) return null;
  // Strip timezone offset and milliseconds
  return iso
    .replace(/\.\d{3}/, "")
    .replace(/[+-]\d{2}:\d{2}$/, "")
    .replace(/Z$/, "");
}

// ─── ICS Fallback ───────────────────────────────────────────

async function fetchICS(pokemonNames) {
  const res = await fetch(CALENDAR_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const icsText = await res.text();
  return parseICS(icsText, pokemonNames);
}

function parseICS(icsText, pokemonNames) {
  const unfolded = icsText.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const events = [];
  const blocks = unfolded.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    const fields = extractFields(block);

    if (!fields.UID || !fields.SUMMARY) continue;

    const summary = unescapeICS(fields.SUMMARY);
    if (/example|template|demo|test/i.test(summary)) continue;
    const { tag, title } = parseTag(summary);

    const { dateStr: startDate, isAllDay } = parseICSDate(
      fields["DTSTART;VALUE=DATE"] || fields.DTSTART
    );
    const { dateStr: endDate } = parseICSDate(
      fields["DTEND;VALUE=DATE"] || fields.DTEND
    );
    if (!startDate || !endDate) continue;

    const description = unescapeICS(fields.DESCRIPTION || "");
    const url = fields.URL || null;

    let imageURL = null;
    const imageField = fields["IMAGE;VALUE=URI"] || fields.IMAGE || null;
    if (imageField) {
      imageURL = imageField.replace(/^VALUE=URI:/, "");
    }

    const pokemonDexNrs = matchPokemon(title, tag, pokemonNames);

    events.push({
      id: fields.UID,
      summary,
      tag,
      title,
      description,
      startDate,
      endDate,
      isAllDay,
      url,
      imageURL,
      pokemonDexNrs,
    });
  }

  events.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return events;
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
          const res = await fetch(event.url, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return;
          const html = await res.text();
          const scraped = extractDexNrsFromHTML(html);
          if (scraped.length > 0) {
            const merged = [...new Set([...event.pokemonDexNrs, ...scraped])];
            event.pokemonDexNrs = merged.sort((a, b) => a - b);
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

function extractDexNrsFromHTML(html) {
  const dexNrs = new Set();

  for (const m of html.matchAll(/pokemon_icon_(\d{3,4})_\d+/g)) {
    const nr = parseInt(m[1], 10);
    if (nr > 0 && nr < 2000) dexNrs.add(nr);
  }

  for (const m of html.matchAll(/pm(\d{1,4})\.c[A-Z0-9_]+\.(?:s\.)?icon\.png/g)) {
    const nr = parseInt(m[1], 10);
    if (nr > 0 && nr < 2000) dexNrs.add(nr);
  }

  const excludeSections = html.matchAll(
    /(?:not (?:be )?(?:allowed|eligible)|cannot (?:be used|participate))[^]*?<ul[^>]*class="pkmn-list-flex"[^>]*>([\s\S]*?)<\/ul>/gi
  );
  for (const section of excludeSections) {
    const listHTML = section[1];
    for (const m of listHTML.matchAll(/pokemon_icon_(\d{3,4})_\d+/g)) {
      const nr = parseInt(m[1], 10);
      if (nr > 0) dexNrs.delete(nr);
    }
    for (const m of listHTML.matchAll(/pm(\d{1,4})\.(?:c[A-Z0-9_]+\.)?(?:s\.)?icon\.png/g)) {
      const nr = parseInt(m[1], 10);
      if (nr > 0) dexNrs.delete(nr);
    }
  }

  return [...dexNrs].sort((a, b) => a - b);
}

// ─── Shared Helpers ─────────────────────────────────────────

function extractFields(block) {
  const fields = {};
  const lines = block.split("\n");
  let inAlarm = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VALARM") { inAlarm = true; continue; }
    if (trimmed === "END:VALARM") { inAlarm = false; continue; }
    if (inAlarm) continue;

    if (!trimmed || !trimmed.includes(":")) continue;
    const colonIdx = trimmed.indexOf(":");
    const key = trimmed.substring(0, colonIdx);
    const value = trimmed.substring(colonIdx + 1);
    fields[key] = value;
  }

  return fields;
}

function parseTag(summary) {
  const tagMatch = summary.match(/^\[([A-Z]+)\]\s*/);
  if (!tagMatch) return { tag: "", title: summary };
  const tag = tagMatch[1];
  const title = summary.replace(/^\[.*?\]\s*/g, "").trim();
  return { tag, title };
}

function parseICSDate(raw) {
  if (!raw) return { dateStr: null, isAllDay: false };
  const clean = raw.trim();

  if (clean.length === 8) {
    const y = clean.substring(0, 4);
    const m = clean.substring(4, 6);
    const d = clean.substring(6, 8);
    return { dateStr: `${y}-${m}-${d}`, isAllDay: true };
  }

  if (clean.length >= 15) {
    const y = clean.substring(0, 4);
    const m = clean.substring(4, 6);
    const d = clean.substring(6, 8);
    const h = clean.substring(9, 11);
    const min = clean.substring(11, 13);
    const s = clean.substring(13, 15);
    return { dateStr: `${y}-${m}-${d}T${h}:${min}:${s}`, isAllDay: false };
  }

  return { dateStr: null, isAllDay: false };
}

function unescapeICS(str) {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
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

function extractCandidateNames(title, tag) {
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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
