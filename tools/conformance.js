#!/usr/bin/env node
/**
 * Data conformance — asserts the invariants in docs/INVARIANTS.md over the
 * *published* artifacts in output/, not over functions.
 *
 * The unit suite tests parsing in isolation and passed for months while the
 * API shipped megas with null stats, because nothing looked at what actually
 * got written. This runs after the build and reads what the app will read.
 *
 * Every check here exists because it failed in production at least once.
 */
import { readFileSync, existsSync } from "fs";

const OUT = new URL("../output/", import.meta.url).pathname;
const load = (name) => JSON.parse(readFileSync(OUT + name, "utf8"));
const MEGA_FORM = /_(MEGA|MEGA_X|MEGA_Y|PRIMAL)$/;

const checks = [];
const check = (id, why, fn) => checks.push({ id, why, fn });

// ── Pokedex ──────────────────────────────────────────────────────────────

check(
  "mega-forms-present",
  "megas existed in Game Master but were never published as forms, so every mega rendered as its base species",
  (dex) => {
    const forms = dex.flatMap((p) => Object.values(p.regionForms || {}).filter((f) => MEGA_FORM.test(f.formId)));
    const species = dex.filter((p) => p.hasMegaEvolution);
    if (forms.length === 0) return fail("no mega forms published at all");
    if (species.length === 0) return fail("no species flagged hasMegaEvolution");
    return pass(`${forms.length} forms across ${species.length} species`);
  }
);

check(
  "mega-forms-complete",
  "mega stats and types were read from the wrong Game Master template, so every published mega had stats: null",
  (dex) => {
    const bad = [];
    for (const p of dex) {
      for (const f of Object.values(p.regionForms || {})) {
        if (!MEGA_FORM.test(f.formId)) continue;
        if (!f.primaryType) bad.push(`${f.formId}: no primaryType`);
        else if (!f.stats || !f.stats.attack) bad.push(`${f.formId}: no stats`);
        else if (!f.names?.English) bad.push(`${f.formId}: no name`);
      }
    }
    return bad.length ? fail(bad.slice(0, 5).join("; "), bad.length) : pass("all megas carry name, types and stats");
  }
);

check(
  "forms-carry-base-dex",
  "caught state is keyed on dex number — a form with its own dexNr would silently detach a Pokemon from its collection",
  (dex) => {
    const bad = [];
    for (const p of dex) {
      for (const f of Object.values(p.regionForms || {})) {
        if (f.dexNr !== p.dexNr) bad.push(`${f.formId}: dexNr ${f.dexNr} under #${p.dexNr}`);
      }
    }
    return bad.length ? fail(bad.slice(0, 5).join("; "), bad.length) : pass("every form inherits its species' dex number");
  }
);

check(
  "dex-entries-unique",
  "a duplicate dex number would double-count a species in collection totals",
  (dex) => {
    const seen = new Set(), dupes = [];
    for (const p of dex) {
      if (seen.has(p.dexNr)) dupes.push(p.dexNr);
      seen.add(p.dexNr);
    }
    return dupes.length ? fail(`duplicate dexNr: ${dupes.slice(0, 5).join(", ")}`, dupes.length) : pass(`${seen.size} unique entries`);
  }
);

// ── Events ───────────────────────────────────────────────────────────────

check(
  "species-ids-aligned",
  "the app reads pokemonSpeciesIds positionally against pokemonDexNrs — a length mismatch points a sprite at the wrong Pokemon",
  (_dex, events) => {
    const bad = events
      .filter((e) => e.pokemonSpeciesIds)
      .filter((e) => e.pokemonSpeciesIds.length !== (e.pokemonDexNrs || []).length)
      .map((e) => `${e.title}: ${e.pokemonSpeciesIds.length} ids vs ${(e.pokemonDexNrs || []).length} dex`);
    return bad.length ? fail(bad.slice(0, 3).join("; "), bad.length) : pass("every species id list matches its dex list");
  }
);

check(
  "titles-decoded",
  "an undecoded entity shipped to users as \"Pokemon XP &amp; 2026 Worlds\"",
  (_dex, events) => {
    const bad = events.filter((e) => /&(amp|lt|gt|quot|#\d+);/i.test(e.title || "")).map((e) => e.title);
    return bad.length ? fail(bad.slice(0, 3).join("; "), bad.length) : pass("no HTML entities in event titles");
  }
);

// ── Rankings ─────────────────────────────────────────────────────────────

check(
  "formats-not-expired",
  "cups were merged from every rotation with no date filter, so a format two rotations away showed as live",
  (_dex, _events, rankings) => {
    const now = Date.now();
    const bad = (rankings.cups || [])
      .filter((c) => c.endDate && new Date(c.endDate).getTime() <= now)
      .map((c) => `${c.name} ended ${c.endDate.slice(0, 10)}`);
    return bad.length ? fail(bad.join("; "), bad.length) : pass(`${(rankings.cups || []).length} formats, none expired`);
  }
);

check(
  "format-ids-unique",
  "mega runs at three CP caps under one PvPoke slug — without a per-cap id the app renders one chip and drops two",
  (_dex, _events, rankings) => {
    const seen = new Set(), dupes = [];
    for (const c of rankings.cups || []) {
      if (seen.has(c.id)) dupes.push(c.id);
      seen.add(c.id);
    }
    return dupes.length ? fail(`duplicate cup id: ${dupes.join(", ")}`) : pass(`${seen.size} distinct formats`);
  }
);

check(
  "formats-have-rankings",
  "a format published with an empty list renders an empty screen behind a chip",
  (_dex, _events, rankings) => {
    const bad = (rankings.cups || []).filter((c) => !(c.rankings || []).length).map((c) => c.name);
    return bad.length ? fail(bad.join("; "), bad.length) : pass("every format carries rankings");
  }
);

// ── runner ───────────────────────────────────────────────────────────────

function pass(detail) { return { ok: true, detail }; }
function fail(detail, count) { return { ok: false, detail, count }; }

const required = ["pokedex.json", "events.json", "rankings.json"];
const missing = required.filter((f) => !existsSync(OUT + f));
if (missing.length) {
  console.error(`conformance: no build to check — missing ${missing.join(", ")}`);
  console.error("Run `node src/index.js` first.");
  process.exit(1);
}

const dex = load("pokedex.json");
const eventsRaw = load("events.json");
const events = Array.isArray(eventsRaw) ? eventsRaw : eventsRaw.events || [];
const rankings = load("rankings.json");

let failed = 0;
const lines = [];
for (const c of checks) {
  let r;
  try { r = c.fn(dex, events, rankings); }
  catch (err) { r = fail(`check threw: ${err.message}`); }
  if (!r.ok) failed++;
  const mark = r.ok ? "ok  " : "FAIL";
  const count = r.count ? ` (${r.count})` : "";
  lines.push(`  ${mark} ${c.id.padEnd(22)} ${r.detail}${count}`);
  if (!r.ok) lines.push(`       why: ${c.why}`);
}

console.log(`\nData conformance — ${checks.length - failed} passing, ${failed} failing of ${checks.length}\n`);
console.log(lines.join("\n"));
console.log();

if (failed > 0) {
  console.error(`conformance: ${failed} invariant(s) broken. See docs/INVARIANTS.md.`);
  process.exit(1);
}
