/**
 * Fetch and parse the Pokemon GO event calendar (ICS format).
 *
 * Source: https://github.com/othyn/go-calendar
 * Timestamps are kept as naive strings (no timezone) so the app
 * can interpret them in the user's local timezone.
 */

const CALENDAR_URL =
  "https://github.com/othyn/go-calendar/releases/latest/download/gocal.ics";

export async function fetchEvents(pokemonNames) {
  console.log("  Fetching event calendar...");

  let icsText;
  try {
    const res = await fetch(CALENDAR_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    icsText = await res.text();
  } catch (err) {
    console.warn(`  Calendar fetch failed: ${err.message}`);
    return { events: [], status: "error" };
  }

  const events = parseICS(icsText, pokemonNames);
  console.log(`  ${events.length} events parsed`);

  // Enrich events with Pokemon from Leek Duck pages
  await enrichFromLeekDuck(events);

  return { events, status: "fresh" };
}

/**
 * Scrape Leek Duck event pages for Pokemon not captured by title matching.
 * Extracts dex numbers from pokemon_icon_XXX_YY image filenames.
 */
async function enrichFromLeekDuck(events) {
  const toEnrich = events.filter(
    (e) => e.url && e.url.includes("leekduck.com") && e.tag !== "GBL"
  );
  if (toEnrich.length === 0) return;

  console.log(`  Enriching ${toEnrich.length} events from Leek Duck...`);
  let enriched = 0;

  // Fetch in batches of 5 to avoid hammering the server
  for (let i = 0; i < toEnrich.length; i += 5) {
    const batch = toEnrich.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (event) => {
        try {
          const res = await fetch(event.url, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return;
          const html = await res.text();
          const scraped = extractDexNrsFromHTML(html);
          if (scraped.length > 0) {
            // Merge with existing (title-matched) dex numbers
            const merged = [...new Set([...event.pokemonDexNrs, ...scraped])];
            event.pokemonDexNrs = merged;
            enriched++;
          }
        } catch {
          // Skip silently — enrichment is best-effort
        }
      })
    );
  }

  console.log(`  ${enriched} events enriched with Pokemon from Leek Duck`);
}

/**
 * Extract Pokemon dex numbers from Leek Duck HTML.
 * Matches two image naming patterns:
 *   - pokemon_icon_XXX_YY (standard sprites)
 *   - pmXXX.cCOSTUME.icon.png (costumed Pokemon)
 *
 * Excludes Pokemon mentioned in "not eligible" / "not allowed" contexts.
 */
function extractDexNrsFromHTML(html) {
  const dexNrs = new Set();

  // Standard: pokemon_icon_010_00
  for (const m of html.matchAll(/pokemon_icon_(\d{3,4})_\d+/g)) {
    const nr = parseInt(m[1], 10);
    if (nr > 0 && nr < 2000) dexNrs.add(nr);
  }

  // Costumed: pm12.cFASHION_2021.icon.png
  for (const m of html.matchAll(/pm(\d{1,4})\.c[A-Z0-9_]+\.(?:s\.)?icon\.png/g)) {
    const nr = parseInt(m[1], 10);
    if (nr > 0 && nr < 2000) dexNrs.add(nr);
  }

  // Remove Pokemon listed after "not allowed" / "not eligible" text
  // Leek Duck uses: <p>...not be allowed...</p><ul class="pkmn-list-flex">...<li>icons</li>...</ul>
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

  return [...dexNrs];
}

/**
 * Parse ICS text into structured event objects.
 */
function parseICS(icsText, pokemonNames) {
  // Unfold ICS line continuations (lines starting with space are continuations)
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

    // Parse dates — keep as naive strings
    const { dateStr: startDate, isAllDay } = parseICSDate(
      fields["DTSTART;VALUE=DATE"] || fields.DTSTART
    );
    const { dateStr: endDate } = parseICSDate(
      fields["DTEND;VALUE=DATE"] || fields.DTEND
    );

    if (!startDate || !endDate) continue;

    const description = unescapeICS(fields.DESCRIPTION || "");
    const url = fields.URL || null;

    // IMAGE field uses VALUE=URI: prefix
    let imageURL = null;
    const imageField =
      fields["IMAGE;VALUE=URI"] || fields.IMAGE || null;
    if (imageField) {
      imageURL = imageField.replace(/^VALUE=URI:/, "");
    }

    // Match Pokemon names
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

  // Sort by start date
  events.sort((a, b) => a.startDate.localeCompare(b.startDate));

  return events;
}

/**
 * Extract key-value pairs from an ICS VEVENT block.
 * Skips VALARM sub-blocks to avoid overwriting event fields.
 */
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

    // Split on first colon only
    const colonIdx = trimmed.indexOf(":");
    const key = trimmed.substring(0, colonIdx);
    const value = trimmed.substring(colonIdx + 1);

    fields[key] = value;
  }

  return fields;
}

/**
 * Parse SUMMARY tag prefix like [CD], [RB], etc.
 */
function parseTag(summary) {
  // Match one or more tag prefixes like [CD], [R] [Promo Code], etc.
  const tagMatch = summary.match(/^\[([A-Z]+)\]\s*/);
  if (!tagMatch) {
    return { tag: "", title: summary };
  }

  const tag = tagMatch[1];
  // Strip all bracket prefixes from title
  const title = summary.replace(/^\[.*?\]\s*/g, "").trim();

  return { tag, title };
}

/**
 * Parse an ICS date string into a naive date string.
 * Returns { dateStr, isAllDay }.
 *
 * "20260314T140000" → { dateStr: "2026-03-14T14:00:00", isAllDay: false }
 * "20260314" → { dateStr: "2026-03-14", isAllDay: true }
 */
function parseICSDate(raw) {
  if (!raw) return { dateStr: null, isAllDay: false };

  const clean = raw.trim();

  if (clean.length === 8) {
    // All-day: 20260314 → 2026-03-14
    const y = clean.substring(0, 4);
    const m = clean.substring(4, 6);
    const d = clean.substring(6, 8);
    return { dateStr: `${y}-${m}-${d}`, isAllDay: true };
  }

  if (clean.length >= 15) {
    // Timed: 20260314T140000 → 2026-03-14T14:00:00
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

/**
 * Unescape ICS special characters.
 */
function unescapeICS(str) {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Match Pokemon names mentioned in an event title.
 * Returns array of dex numbers.
 */
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

  // Fallback: scan title for any Pokemon name (for generic events)
  if (matched.length === 0) {
    for (const [name, dex] of pokemonNames) {
      // Word boundary check to avoid partial matches
      const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
      if (regex.test(title)) {
        matched.push(dex);
      }
    }
  }

  return [...new Set(matched)];
}

/**
 * Extract candidate Pokemon names from event title based on tag type.
 */
function extractCandidateNames(title, tag) {
  switch (tag) {
    case "CD": {
      // "Scorbunny Community Day" → "Scorbunny"
      const m = title.match(/^(.+?)\s+Community Day/i);
      return m ? [m[1]] : [];
    }
    case "RB": {
      // "Mega Steelix in Mega Raids" → "Steelix"
      // "Zacian (Hero of Many Battles) in 5-star Raid Battles" → "Zacian"
      let name = title.replace(/^Mega\s+/i, "");
      name = name.replace(/\s*\(.*?\)/, "");
      name = name.replace(/\s+in\s+.*$/i, "");
      name = name.replace(/\s+in\s+.*$/i, "");
      const parts = [name.trim()];
      // Also try the full name with "Mega" for mega Pokemon
      if (title.match(/^Mega\s+/i)) {
        parts.push(title.replace(/\s*\(.*?\)/, "").replace(/\s+in\s+.*$/i, "").trim());
      }
      // Also try without "Shadow" prefix
      if (title.match(/^Shadow\s+/i)) {
        parts.push(title.replace(/^Shadow\s+/i, "").replace(/\s*\(.*?\)/, "").replace(/\s+in\s+.*$/i, "").trim());
      }
      return parts;
    }
    case "RH": {
      // "Zamazenta (Hero of Many Battles) Raid Hour" → "Zamazenta"
      // "Regieleki Raid Hour" → "Regieleki"
      let name = title.replace(/\s*\(.*?\)/, "").replace(/\s+Raid Hour$/i, "");
      return [name.trim()];
    }
    case "MM": {
      // "Dynamax Falinks during Max Monday" → "Falinks"
      const m = title.match(/Dynamax\s+(.+?)\s+during/i);
      return m ? [m[1]] : [];
    }
    case "MB": {
      // "Gigantamax Pikachu Max Battle Day" → "Pikachu"
      const m = title.match(/Gigantamax\s+(.+?)\s+Max/i);
      return m ? [m[1]] : [];
    }
    case "SH": {
      // "Spotlight Hour: Pidgey" or "Pidgey Spotlight Hour"
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
