import { fetchWithCache, moveIdToName } from "../utils.js";

const BASE =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data";

export async function fetchPvpoke() {
  const { data, status, error } = await fetchWithCache(
    "pvpoke",
    `${BASE}/gamemaster/pokemon.json`
  );

  // Build lookup by dex number
  // pvpoke has multiple entries per dex (forms), so collect all
  const releasedDex = new Set();
  const tagsByDex = new Map();
  const buddyByDex = new Map();
  const familyByDex = new Map();
  const thirdMoveCostByDex = new Map();
  const defaultIVsByDex = new Map();
  const speciesIdToDex = new Map();
  const speciesIdToName = new Map();
  const movesBySpeciesId = new Map();

  if (!Array.isArray(data)) {
    console.error("  PvPoke data is not an array, skipping parse");
    return { releasedDex, tagsByDex, buddyByDex, familyByDex, thirdMoveCostByDex, defaultIVsByDex, speciesIdToDex, speciesIdToName, movesBySpeciesId, status: "error", error: "Invalid data format" };
  }

  for (const entry of data) {
    if (!entry || !entry.dex) continue;
    if (entry.released) releasedDex.add(entry.dex);

    speciesIdToDex.set(entry.speciesId, entry.dex);
    if (entry.speciesName) speciesIdToName.set(entry.speciesId, entry.speciesName);

    if (entry.tags && !tagsByDex.has(entry.dex)) {
      tagsByDex.set(entry.dex, entry.tags);
    }

    if (entry.buddyDistance && !buddyByDex.has(entry.dex)) {
      buddyByDex.set(entry.dex, entry.buddyDistance);
    }

    if (entry.family && !familyByDex.has(entry.dex)) {
      familyByDex.set(entry.dex, entry.family);
    }

    if (entry.thirdMoveCost && !thirdMoveCostByDex.has(entry.dex)) {
      thirdMoveCostByDex.set(entry.dex, entry.thirdMoveCost);
    }

    if (entry.defaultIVs && !defaultIVsByDex.has(entry.dex)) {
      defaultIVsByDex.set(entry.dex, entry.defaultIVs);
    }

    // Store move lists by speciesId (includes legacy/signature moves)
    // PvPoke has `eliteMoves` (covers both fast and charged) and `eliteChargedMoves` (charged only).
    // Derive elite fast moves: any move in eliteMoves that's also in fastMoves.
    const eliteMoveSet = new Set(entry.eliteMoves || []);
    const eliteFastMoves = (entry.fastMoves || [])
      .filter((m) => eliteMoveSet.has(m))
      .map((m) => m + "_FAST");
    movesBySpeciesId.set(entry.speciesId, {
      fastMoves: (entry.fastMoves || []).map((m) => m + "_FAST"),
      chargedMoves: entry.chargedMoves || [],
      eliteChargedMoves: entry.eliteChargedMoves || [],
      eliteFastMoves,
    });
  }

  return {
    releasedDex,
    tagsByDex,
    buddyByDex,
    familyByDex,
    thirdMoveCostByDex,
    defaultIVsByDex,
    speciesIdToDex,
    speciesIdToName,
    movesBySpeciesId,
    status,
    error,
  };
}

/**
 * Scan full rankings for Pokemon whose recommended moveset includes Return
 * and who outrank their shadow counterpart. These are worth purifying.
 */
function findReturnPokemon(leagueDataArrays, speciesIdToDex) {
  const returnDexNrs = new Set();

  for (const data of leagueDataArrays) {
    if (!Array.isArray(data)) continue;

    // Build rank lookup: speciesId → rank (1-indexed)
    const ranks = new Map();
    for (let i = 0; i < data.length; i++) {
      ranks.set(data[i].speciesId, i + 1);
    }

    for (const [speciesId, rank] of ranks) {
      const entry = data[rank - 1];
      const moveset = entry.moveset || [];
      if (!moveset.includes("RETURN")) continue;

      // Compare to shadow version
      const base = speciesId.replace(/_shadow$/, "");
      const shadowId = base + "_shadow";
      const shadowRank = ranks.get(shadowId);

      // Include if Return version ranks better than shadow (or no shadow exists)
      if (!shadowRank || rank < shadowRank) {
        const dex =
          speciesIdToDex.get(speciesId) ||
          speciesIdToDex.get(base) ||
          null;
        if (dex) returnDexNrs.add(dex);
      }
    }
  }

  return [...returnDexNrs];
}

const mapRankings = (data, speciesIdToDex, speciesIdToName) => {
  const resolveName = (id) => speciesIdToName?.get(id) || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (Array.isArray(data) ? data : []).slice(0, 100).map((entry, index) => ({
    rank: index + 1,
    speciesId: entry.speciesId,
    speciesName: entry.speciesName,
    dexNr:
      speciesIdToDex.get(entry.speciesId) ||
      speciesIdToDex.get(entry.speciesId.replace(/_shadow$/, "")) ||
      null,
    rating: entry.rating,
    moveset: entry.moveset,
    movesetNames: (entry.moveset || []).map(moveIdToName),
    matchups: (entry.matchups || []).slice(0, 10).map((m) => ({
      opponent: resolveName(m.opponent),
      dexNr: speciesIdToDex.get(m.opponent) || speciesIdToDex.get(m.opponent.replace(/_shadow$/, "")) || null,
      rating: m.rating,
    })),
    counters: (entry.counters || []).slice(0, 10).map((m) => ({
      opponent: resolveName(m.opponent),
      dexNr: speciesIdToDex.get(m.opponent) || speciesIdToDex.get(m.opponent.replace(/_shadow$/, "")) || null,
      rating: m.rating,
    })),
  }));
};

/**
 * Fetch role-specific rankings (leads/switches/closers) for a league.
 * Returns null fields for any role that fails to load — non-fatal.
 */
async function fetchLeagueRoles(cp, speciesIdToDex, speciesIdToName) {
  const roleBase = (role) => `${BASE}/rankings/all/${role}/rankings-${cp}.json`;
  const [leads, switches, closers] = await Promise.all([
    fetchWithCache(`rankings-${cp}-leads`, roleBase("leads")).catch(() => ({ data: null })),
    fetchWithCache(`rankings-${cp}-switches`, roleBase("switches")).catch(() => ({ data: null })),
    fetchWithCache(`rankings-${cp}-closers`, roleBase("closers")).catch(() => ({ data: null })),
  ]);
  return {
    leads: leads.data ? mapRankings(leads.data, speciesIdToDex, speciesIdToName) : null,
    switches: switches.data ? mapRankings(switches.data, speciesIdToDex, speciesIdToName) : null,
    closers: closers.data ? mapRankings(closers.data, speciesIdToDex, speciesIdToName) : null,
  };
}

export async function fetchPvpRankings(speciesIdToDex, speciesIdToName) {
  const RANKINGS_BASE = `${BASE}/rankings/all/overall`;

  const [little, great, ultra, master, greatRoles, ultraRoles, masterRoles] = await Promise.all([
    fetchWithCache("rankings-500", `${RANKINGS_BASE}/rankings-500.json`),
    fetchWithCache("rankings-1500", `${RANKINGS_BASE}/rankings-1500.json`),
    fetchWithCache("rankings-2500", `${RANKINGS_BASE}/rankings-2500.json`),
    fetchWithCache("rankings-10000", `${RANKINGS_BASE}/rankings-10000.json`),
    fetchLeagueRoles(1500, speciesIdToDex, speciesIdToName),
    fetchLeagueRoles(2500, speciesIdToDex, speciesIdToName),
    fetchLeagueRoles(10000, speciesIdToDex, speciesIdToName),
  ]);

  // Find Pokemon where purified (with Return) outranks shadow in any league
  const returnPokemon = findReturnPokemon(
    [little.data, great.data, ultra.data, master.data],
    speciesIdToDex
  );

  return {
    little: mapRankings(little.data, speciesIdToDex, speciesIdToName),
    great: mapRankings(great.data, speciesIdToDex, speciesIdToName),
    ultra: mapRankings(ultra.data, speciesIdToDex, speciesIdToName),
    master: mapRankings(master.data, speciesIdToDex, speciesIdToName),
    roles: {
      great: greatRoles,
      ultra: ultraRoles,
      master: masterRoles,
    },
    returnPokemon,
    status: { little: little.status, great: great.status, ultra: ultra.status, master: master.status },
  };
}

/**
 * Parse GBL event titles into the battle formats worth publishing.
 *
 * A rotation's title lists each format as a segment:
 *   "Great League: Mega Edition, Ultra League: Mega Edition, and Master League: Mega Edition | Twilight Trails"
 *   "Ultra League, Master League: Mega Edition, and Retro Cup: Great League Edition | Twilight Trails"
 *
 * Two kinds of segment matter. "{Name} Cup" is a specialty cup, and
 * "{League} League: Mega Edition" is that league run with megas legal —
 * a genuinely different meta that PvPoke publishes as its own "mega"
 * format at each CP cap. A bare "{League} League" is the standard meta
 * we already publish at the top level, so it is skipped.
 *
 * Rotations that have already ended are dropped, but upcoming ones are
 * kept: PvPoke publishes a cup's rankings a week or two early so players
 * can prepare, and the lookahead is self-limiting because rankings that
 * do not exist yet simply 404 in fetchCupRankings.
 */
const STANDARD_LEAGUES = new Set(["great league", "ultra league", "master league"]);
const LEAGUE_CP = { great: 1500, ultra: 2500, master: 10000 };

/** Parse an event's window, or null when it carries no usable dates. */
function eventWindow(event) {
  const start = event.startDate ? new Date(event.startDate) : null;
  const end = event.endDate ? new Date(event.endDate) : null;
  if (!start || !end || isNaN(start) || isNaN(end)) return null;
  return { start, end };
}

/** Identify one title segment as a mega league, a cup, or neither. */
function parseSegment(segment) {
  const text = segment.trim();

  // "{League} League: Mega Edition" — megas legal, its own PvPoke format.
  const mega = text.match(/^(great|ultra|master)\s+league\s*:\s*mega\s+edition\b/i);
  if (mega) {
    const league = mega[1].toLowerCase();
    const label = league[0].toUpperCase() + league.slice(1);
    return { slug: "mega", cp: LEAGUE_CP[league], name: `Mega ${label}` };
  }

  // "{Name} Cup", optionally "...: {League} League Edition" to set the CP cap.
  const cup = text.match(/^(.*?)\s+Cup\b(?:\s*:\s*(great|ultra|master)\s+league\s+edition\b)?/i);
  if (!cup) return null;
  const rawName = cup[1].replace(/:.*$/, "").trim();
  if (STANDARD_LEAGUES.has(rawName.toLowerCase())) return null;
  // Strip leading year: "2025 Championship Series" → "Championship Series"
  const cleanName = rawName.replace(/^\d+\s+/, "");
  if (!cleanName) return null;
  return {
    slug: cleanName.toLowerCase().replace(/\s+/g, ""),
    cp: LEAGUE_CP[(cup[2] || "great").toLowerCase()],
    name: `${cleanName} Cup`,
  };
}

export function parseCupsFromEvents(events, now = new Date()) {
  const candidates = [];

  for (const event of events) {
    if (event.tag !== "GBL") continue;
    const window = eventWindow(event);
    // An undated event is kept rather than dropped: we cannot filter what we
    // cannot date, and losing every format is worse than showing a stale one.
    if (window && window.end <= now) continue;
    const isLive = !window || (window.start <= now && now < window.end);

    // Strip season suffix: "| Twilight Trails" etc.
    const title = (event.title || "").replace(/\s*\|.*$/, "").trim();
    // Split on "and" or commas to isolate each format.
    for (const segment of title.split(/\s*(?:,\s*|\band\b)\s*/)) {
      const parsed = parseSegment(segment);
      if (!parsed) continue;
      // Mega runs at three CP caps under one PvPoke slug, so the cap is part
      // of its identity. Cups keep the bare slug, which the sprite enrichment
      // in index.js looks them up by.
      const id = parsed.slug === "mega" ? `mega-${parsed.cp}` : parsed.slug;
      candidates.push({ ...parsed, id, isLive, window });
    }
  }

  // A format can appear in more than one rotation. Prefer the live airing, then
  // the earliest upcoming one, so nothing live is ever labelled as upcoming.
  const best = new Map();
  for (const entry of candidates) {
    const existing = best.get(entry.id);
    if (!existing) { best.set(entry.id, entry); continue; }
    if (existing.isLive) continue;
    if (entry.isLive) { best.set(entry.id, entry); continue; }
    const a = entry.window?.start, b = existing.window?.start;
    if (a && b && a < b) best.set(entry.id, entry);
  }

  return [...best.values()]
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      const a0 = a.window?.start, b0 = b.window?.start;
      if (a0 && b0 && +a0 !== +b0) return a0 - b0;
      // Same rotation: order by CP cap so mega reads Great, Ultra, Master.
      if (a.cp !== b.cp) return a.cp - b.cp;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => ({
      id: entry.id,
      slug: entry.slug,
      // Date-stamp upcoming formats so the chip says when it starts. The app
      // renders cup.name verbatim, so the label has to carry this itself.
      name: entry.isLive
        ? entry.name
        : `${entry.name} (${entry.window.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
      cp: entry.cp,
      isLive: entry.isLive,
      startDate: entry.window ? entry.window.start.toISOString() : null,
      endDate: entry.window ? entry.window.end.toISOString() : null,
    }));
}

/**
 * Fetch rankings for active specialty cups from PvPoke.
 * Silently skips cups with no data available.
 */
export async function fetchCupRankings(events, speciesIdToDex, speciesIdToName) {
  const cups = parseCupsFromEvents(events);
  if (cups.length === 0) return [];

  console.log(`  Found ${cups.length} format(s): ${cups.map((c) => c.name).join(", ")}`);

  // Helper to fetch + map a single role file for a cup; returns null on miss
  async function fetchCupRole(slug, role, cp) {
    const url = `${BASE}/rankings/${slug}/${role}/rankings-${cp}.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const data = await res.json();
      const mapped = mapRankings(data, speciesIdToDex, speciesIdToName);
      return mapped.length > 0 ? mapped : null;
    } catch {
      return null;
    }
  }

  const results = [];
  for (const cup of cups) {
    const url = `${BASE}/rankings/${cup.slug}/overall/rankings-${cup.cp}.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rankings = mapRankings(data, speciesIdToDex, speciesIdToName);
      if (rankings.length > 0) {
        // Fetch role-specific rankings in parallel — non-fatal if missing
        const [leads, switches, closers] = await Promise.all([
          fetchCupRole(cup.slug, "leads", cup.cp),
          fetchCupRole(cup.slug, "switches", cup.cp),
          fetchCupRole(cup.slug, "closers", cup.cp),
        ]);

        // Get the actual last commit date for this file from GitHub API
        let lastUpdated = null;
        try {
          const commitUrl = `https://api.github.com/repos/pvpoke/pvpoke/commits?path=src/data/rankings/${cup.slug}/overall/rankings-${cup.cp}.json&per_page=1`;
          const commitRes = await fetch(commitUrl, { signal: AbortSignal.timeout(10000) });
          if (commitRes.ok) {
            const commits = await commitRes.json();
            if (commits.length > 0) {
              lastUpdated = commits[0].commit.committer.date;
            }
          }
        } catch { /* non-fatal */ }
        results.push({
          id: cup.id,
          name: cup.name,
          cp: cup.cp,
          isLive: cup.isLive,
          startDate: cup.startDate,
          endDate: cup.endDate,
          lastUpdated,
          rankings,
          leads,
          switches,
          closers,
        });
        const roleNote = [leads && "leads", switches && "switches", closers && "closers"].filter(Boolean).join("/");
        console.log(`  ${cup.name}: ${rankings.length} rankings${roleNote ? ` + ${roleNote}` : ""} (updated ${lastUpdated || "unknown"})`);
      }
    } catch (err) {
      // An upcoming rotation routinely has no rankings yet — PvPoke publishes
      // them a week or two out, so this is the expected steady state, not a
      // failure. Only a live format missing its data is worth warning about.
      if (cup.isLive) {
        console.warn(`  ${cup.name}: no data available (${err.message})`);
      } else {
        console.log(`  ${cup.name}: not published by PvPoke yet`);
      }
    }
  }

  return results;
}
