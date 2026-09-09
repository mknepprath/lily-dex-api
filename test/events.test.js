import { describe, it, expect } from "vitest";
import {
  parseISOToNaive,
  parseTag,
  parseICSDate,
  unescapeICS,
  decodeHTMLEntities,
  parsePokemonIcon,
  extractPokemonFromHTML,
  extractDexFromImage,
  matchNameToDex,
  extractCandidateNames,
  extractMegaForms,
  parseScrapedDuckEvent,
  escapeRegex,
} from "../src/sources/events.js";
import { parseCupsFromEvents } from "../src/sources/pvpoke.js";
import { megaFormId, megaFormName } from "../src/sources/game-master.js";

// ─── parseISOToNaive ──────────────────────────────────────────────────────────

describe("parseISOToNaive", () => {
  it("returns null for falsy input", () => {
    expect(parseISOToNaive(null)).toBeNull();
    expect(parseISOToNaive("")).toBeNull();
    expect(parseISOToNaive(undefined)).toBeNull();
  });

  it("strips UTC offset", () => {
    expect(parseISOToNaive("2026-03-14T14:00:00+00:00")).toBe("2026-03-14T14:00:00");
  });

  it("strips negative UTC offset", () => {
    expect(parseISOToNaive("2026-03-14T10:00:00-04:00")).toBe("2026-03-14T10:00:00");
  });

  it("strips Z suffix", () => {
    expect(parseISOToNaive("2026-03-14T14:00:00Z")).toBe("2026-03-14T14:00:00");
  });

  it("strips milliseconds", () => {
    expect(parseISOToNaive("2026-03-14T14:00:00.000Z")).toBe("2026-03-14T14:00:00");
  });

  it("passes through date-only strings unchanged", () => {
    expect(parseISOToNaive("2026-03-14")).toBe("2026-03-14");
  });
});

// ─── parseTag ─────────────────────────────────────────────────────────────────

describe("parseTag", () => {
  it("extracts tag and title from bracketed prefix", () => {
    const result = parseTag("[CD] Bulbasaur Community Day");
    expect(result.tag).toBe("CD");
    expect(result.title).toBe("Bulbasaur Community Day");
  });

  it("returns empty tag when no bracket", () => {
    const result = parseTag("Some Event Without Tag");
    expect(result.tag).toBe("");
    expect(result.title).toBe("Some Event Without Tag");
  });

  it("handles multi-letter tags", () => {
    const result = parseTag("[GBL] Great League");
    expect(result.tag).toBe("GBL");
  });

  it("trims leading space after bracket", () => {
    const result = parseTag("[RH] Mewtwo Raid Hour");
    expect(result.title).toBe("Mewtwo Raid Hour");
  });
});

// ─── parseICSDate ─────────────────────────────────────────────────────────────

describe("parseICSDate", () => {
  it("returns null for falsy input", () => {
    expect(parseICSDate(null)).toEqual({ dateStr: null, isAllDay: false });
    expect(parseICSDate("")).toEqual({ dateStr: null, isAllDay: false });
  });

  it("parses 8-digit all-day date", () => {
    const result = parseICSDate("20260314");
    expect(result.dateStr).toBe("2026-03-14");
    expect(result.isAllDay).toBe(true);
  });

  it("parses timed date", () => {
    const result = parseICSDate("20260314T140000");
    expect(result.dateStr).toBe("2026-03-14T14:00:00");
    expect(result.isAllDay).toBe(false);
  });

  it("handles UTC Z suffix on timed date", () => {
    const result = parseICSDate("20260314T140000Z");
    expect(result.dateStr).toBe("2026-03-14T14:00:00");
    expect(result.isAllDay).toBe(false);
  });
});

// ─── decodeHTMLEntities ──────────────────────────────────────────────────────

describe("decodeHTMLEntities", () => {
  it("decodes &amp; to & (the reported bug)", () => {
    expect(decodeHTMLEntities("PokémonXP &amp; 2026 Worlds")).toBe("PokémonXP & 2026 Worlds");
  });

  it("decodes named entities", () => {
    expect(decodeHTMLEntities("a &lt;b&gt; &quot;c&quot; &apos;d&apos;")).toBe('a <b> "c" \'d\'');
  });

  it("decodes numeric and hex entities", () => {
    expect(decodeHTMLEntities("Trainer&#39;s &#x2764; day")).toBe("Trainer's ❤ day");
  });

  it("does not double-decode &amp;lt;", () => {
    expect(decodeHTMLEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves plain strings untouched", () => {
    expect(decodeHTMLEntities("Community Day")).toBe("Community Day");
  });

  it("handles non-string input", () => {
    expect(decodeHTMLEntities("")).toBe("");
    expect(decodeHTMLEntities(undefined)).toBe(undefined);
  });
});

// ─── unescapeICS ─────────────────────────────────────────────────────────────

describe("unescapeICS", () => {
  it("converts \\n to newline", () => {
    expect(unescapeICS("line1\\nline2")).toBe("line1\nline2");
  });

  it("unescapes commas", () => {
    expect(unescapeICS("a\\,b")).toBe("a,b");
  });

  it("unescapes semicolons", () => {
    expect(unescapeICS("a\\;b")).toBe("a;b");
  });

  it("unescapes backslash", () => {
    expect(unescapeICS("a\\\\b")).toBe("a\\b");
  });

  it("passes through unescaped text", () => {
    expect(unescapeICS("Hello World")).toBe("Hello World");
  });
});

// ─── parsePokemonIcon ────────────────────────────────────────────────────────

describe("parsePokemonIcon", () => {
  it("reads a Galarian form from a numeric icon code (_31)", () => {
    expect(parsePokemonIcon("x/pokemon_icon_052_31.png")).toEqual({ dexNr: 52, form: "galarian" });
    expect(parsePokemonIcon("x/pokemon_icon_079_31.png")).toEqual({ dexNr: 79, form: "galarian" });
  });

  it("reads a form named directly in pm{dex}.f{FORM}", () => {
    expect(parsePokemonIcon("x/pm215.fHISUIAN.icon.png")).toEqual({ dexNr: 215, form: "hisuian" });
    expect(parsePokemonIcon("x/pm222.fGALARIAN.icon.png")).toEqual({ dexNr: 222, form: "galarian" });
  });

  it("treats base and costume icons as formless", () => {
    expect(parsePokemonIcon("x/pokemon_icon_001_00.png")).toEqual({ dexNr: 1, form: null });
    expect(parsePokemonIcon("x/pm25.cHAT.icon.png")).toEqual({ dexNr: 25, form: null });
    expect(parsePokemonIcon("x/pm150.icon.png")).toEqual({ dexNr: 150, form: null });
  });

  it("returns null for non-icon input", () => {
    expect(parsePokemonIcon("")).toBeNull();
    expect(parsePokemonIcon("https://example.com/logo.png")).toBeNull();
  });
});

// ─── extractPokemonFromHTML ──────────────────────────────────────────────────

describe("extractPokemonFromHTML", () => {
  it("keeps the regional form of each scraped Pokemon", () => {
    const html = `
      <img src="pokemon_icon_052_31.png">
      <img src="pm222.fGALARIAN.icon.png">
      <img src="pokemon_icon_025_00.png">`;
    const { dexNrs, formByDex } = extractPokemonFromHTML(html);
    expect(dexNrs).toEqual([25, 52, 222]);
    expect(formByDex.get(52)).toBe("galarian");
    expect(formByDex.get(222)).toBe("galarian");
    expect(formByDex.has(25)).toBe(false);
  });

  it("drops Pokemon (and their forms) listed in excluded sections", () => {
    const html = `
      <img src="pokemon_icon_052_31.png">
      <p>Pokémon not allowed:</p>
      <ul class="pkmn-list-flex"><img src="pokemon_icon_052_31.png"></ul>`;
    const { dexNrs, formByDex } = extractPokemonFromHTML(html);
    expect(dexNrs).not.toContain(52);
    expect(formByDex.has(52)).toBe(false);
  });
});

// ─── extractDexFromImage ──────────────────────────────────────────────────────

describe("extractDexFromImage", () => {
  it("returns null for falsy url", () => {
    expect(extractDexFromImage(null)).toBeNull();
    expect(extractDexFromImage("")).toBeNull();
  });

  it("extracts dex from standard pokemon_icon URL", () => {
    expect(extractDexFromImage("https://example.com/pokemon_icon_001_00.png")).toBe(1);
    expect(extractDexFromImage("https://example.com/pokemon_icon_0149_00.png")).toBe(149);
  });

  it("extracts dex from pm-style URL", () => {
    expect(extractDexFromImage("https://example.com/pm6.icon.png")).toBe(6);
    expect(extractDexFromImage("https://example.com/pm150.icon.png")).toBe(150);
  });

  it("handles costume pm-style URL", () => {
    expect(extractDexFromImage("https://example.com/pm25.cHAT.icon.png")).toBe(25);
  });

  it("returns null for unrecognised URL", () => {
    expect(extractDexFromImage("https://example.com/some_other_image.png")).toBeNull();
  });
});

// ─── matchNameToDex ───────────────────────────────────────────────────────────

describe("matchNameToDex", () => {
  const names = new Map([
    ["Bulbasaur", 1],
    ["Slowbro", 80],
    ["Mega Slowbro", 80],
  ]);

  it("matches exact name", () => {
    expect(matchNameToDex("Bulbasaur", names)).toBe(1);
  });

  it("matches case-insensitively", () => {
    expect(matchNameToDex("bulbasaur", names)).toBe(1);
  });

  it("strips Mega prefix before matching", () => {
    expect(matchNameToDex("Mega Slowbro", names)).toBe(80);
  });

  it("strips Shadow prefix before matching", () => {
    const n = new Map([["Gengar", 94]]);
    expect(matchNameToDex("Shadow Gengar", n)).toBe(94);
  });

  it("strips parenthetical form suffix", () => {
    const n = new Map([["Kyurem", 646]]);
    expect(matchNameToDex("Kyurem (Black)", n)).toBe(646);
  });

  it("returns null for unknown names", () => {
    expect(matchNameToDex("Fakemon", names)).toBeNull();
  });
});

// ─── extractCandidateNames ───────────────────────────────────────────────────

describe("extractCandidateNames", () => {
  it("extracts Community Day pokemon", () => {
    expect(extractCandidateNames("Bulbasaur Community Day", "CD")).toEqual(["Bulbasaur"]);
  });

  it("extracts Spotlight Hour pokemon after colon", () => {
    expect(extractCandidateNames("Spotlight Hour: Pikachu", "SH")).toEqual(["Pikachu"]);
  });

  it("extracts Spotlight Hour pokemon before 'Spotlight Hour'", () => {
    expect(extractCandidateNames("Eevee Spotlight Hour", "SH")).toEqual(["Eevee"]);
  });

  it("extracts Max Monday pokemon", () => {
    expect(extractCandidateNames("Dynamax Snorlax during Max Mondays", "MM")).toEqual(["Snorlax"]);
  });

  it("extracts Max Battle pokemon", () => {
    expect(extractCandidateNames("Gigantamax Charizard Max Battle", "MB")).toEqual(["Charizard"]);
  });

  it("returns empty for unknown tags", () => {
    expect(extractCandidateNames("Some Event", "E")).toEqual([]);
    expect(extractCandidateNames("Some Event", "GBL")).toEqual([]);
  });
});

// ─── escapeRegex ──────────────────────────────────────────────────────────────

describe("escapeRegex", () => {
  it("escapes regex special characters", () => {
    expect(escapeRegex("Mr. Mime")).toBe("Mr\\. Mime");
    expect(escapeRegex("Nidoran♀")).toBe("Nidoran♀");
    expect(escapeRegex("(test)")).toBe("\\(test\\)");
  });

  it("passes through plain strings unchanged", () => {
    expect(escapeRegex("Pikachu")).toBe("Pikachu");
  });
});

// ─── parseCupsFromEvents ──────────────────────────────────────────────────────

describe("parseCupsFromEvents", () => {
  it("returns empty for no events", () => {
    expect(parseCupsFromEvents([])).toEqual([]);
  });

  it("ignores non-GBL events", () => {
    const events = [{ tag: "CD", title: "Fantasy Cup Day" }];
    expect(parseCupsFromEvents(events)).toEqual([]);
  });

  it("extracts a simple cup name", () => {
    const events = [{ tag: "GBL", title: "Fantasy Cup: Great League Edition" }];
    const result = parseCupsFromEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fantasy");
    expect(result[0].name).toBe("Fantasy Cup");
  });

  it("skips standard leagues", () => {
    const events = [{ tag: "GBL", title: "Great League and Ultra League" }];
    expect(parseCupsFromEvents(events)).toEqual([]);
  });

  it("extracts cup from 'X and Y Cup' format", () => {
    const events = [{ tag: "GBL", title: "Ultra League and Fantasy Cup: Great League Edition | Season 20" }];
    const result = parseCupsFromEvents(events);
    expect(result.some((c) => c.id === "fantasy")).toBe(true);
  });

  it("strips leading year from cup name", () => {
    const events = [{ tag: "GBL", title: "2025 Championship Series Cup" }];
    const result = parseCupsFromEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("championshipseries");
    expect(result[0].name).toBe("Championship Series Cup");
  });

  it("strips season suffix after pipe", () => {
    const events = [{ tag: "GBL", title: "Fantasy Cup: Great League Edition | Memories in Motion" }];
    const result = parseCupsFromEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fantasy");
  });

  it("deduplicates the same cup across multiple events", () => {
    const events = [
      { tag: "GBL", title: "Fantasy Cup: Great League Edition" },
      { tag: "GBL", title: "Fantasy Cup: Ultra Edition" },
    ];
    const result = parseCupsFromEvents(events);
    expect(result.filter((c) => c.id === "fantasy")).toHaveLength(1);
  });

  // ─── rotation windows ───────────────────────────────────────────────────

  const NOW = new Date("2026-09-10T00:00:00Z");
  const rotation = (title, start, end) => ({
    tag: "GBL",
    title,
    startDate: start,
    endDate: end,
  });
  const ENDED = ["2026-09-01T20:00:00Z", "2026-09-08T20:00:00Z"];
  const LIVE = ["2026-09-08T20:00:00Z", "2026-09-15T20:00:00Z"];
  const NEXT = ["2026-09-15T20:00:00Z", "2026-09-22T20:00:00Z"];

  it("drops rotations that have already ended", () => {
    const events = [rotation("Retro Cup: Great League Edition", ...ENDED)];
    expect(parseCupsFromEvents(events, NOW)).toEqual([]);
  });

  it("marks the current rotation live and leaves its name unadorned", () => {
    const events = [rotation("Retro Cup: Great League Edition", ...LIVE)];
    const [cup] = parseCupsFromEvents(events, NOW);
    expect(cup.isLive).toBe(true);
    expect(cup.name).toBe("Retro Cup");
  });

  it("keeps upcoming rotations and date-stamps the label", () => {
    const events = [rotation("Willpower Cup: Great League Edition", ...NEXT)];
    const [cup] = parseCupsFromEvents(events, NOW);
    expect(cup.isLive).toBe(false);
    expect(cup.id).toBe("willpower");
    expect(cup.name).toMatch(/^Willpower Cup \(/);
    expect(cup.startDate).toBe(new Date(NEXT[0]).toISOString());
  });

  it("prefers the live airing when a cup runs in two rotations", () => {
    const events = [
      rotation("Retro Cup: Great League Edition", ...NEXT),
      rotation("Retro Cup: Great League Edition", ...LIVE),
    ];
    const result = parseCupsFromEvents(events, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].isLive).toBe(true);
    expect(result[0].name).toBe("Retro Cup");
  });

  // ─── mega editions ──────────────────────────────────────────────────────

  it("recognises mega editions as their own format at each CP cap", () => {
    const events = [
      rotation(
        "Great League: Mega Edition, Ultra League: Mega Edition, and Master League: Mega Edition",
        ...LIVE
      ),
    ];
    const result = parseCupsFromEvents(events, NOW);
    expect(result.map((c) => [c.id, c.slug, c.cp, c.name])).toEqual([
      ["mega-1500", "mega", 1500, "Mega Great"],
      ["mega-2500", "mega", 2500, "Mega Ultra"],
      ["mega-10000", "mega", 10000, "Mega Master"],
    ]);
  });

  it("separates mega leagues from standard ones in a mixed rotation", () => {
    const events = [
      rotation("Ultra League, Master League: Mega Edition, and Retro Cup: Great League Edition", ...LIVE),
    ];
    const result = parseCupsFromEvents(events, NOW);
    // Plain "Ultra League" is the standard meta we already publish top-level.
    expect(result.map((c) => c.id).sort()).toEqual(["mega-10000", "retro"]);
  });

  it("derives a cup's CP cap from its edition suffix", () => {
    const events = [rotation("Fantasy Cup: Ultra League Edition", ...LIVE)];
    expect(parseCupsFromEvents(events, NOW)[0].cp).toBe(2500);
  });

  it("orders live formats ahead of upcoming ones", () => {
    const events = [
      rotation("Willpower Cup: Great League Edition", ...NEXT),
      rotation("Retro Cup: Great League Edition", ...LIVE),
    ];
    const result = parseCupsFromEvents(events, NOW);
    expect(result.map((c) => c.id)).toEqual(["retro", "willpower"]);
  });

  it("keeps undated events rather than dropping them", () => {
    const events = [{ tag: "GBL", title: "Fantasy Cup: Great League Edition" }];
    const [cup] = parseCupsFromEvents(events, NOW);
    expect(cup.isLive).toBe(true);
    expect(cup.startDate).toBeNull();
  });
});

// ─── mega forms ───────────────────────────────────────────────────────────────

describe("megaFormId", () => {
  it("matches PokeAPI and PvPoke naming", () => {
    expect(megaFormId("CHARIZARD", "TEMP_EVOLUTION_MEGA_X")).toBe("CHARIZARD_MEGA_X");
    expect(megaFormId("BEEDRILL", "TEMP_EVOLUTION_MEGA")).toBe("BEEDRILL_MEGA");
    expect(megaFormId("KYOGRE", "TEMP_EVOLUTION_PRIMAL")).toBe("KYOGRE_PRIMAL");
  });
});

describe("megaFormName", () => {
  it("names plain megas", () => {
    expect(megaFormName("BEEDRILL", "TEMP_EVOLUTION_MEGA")).toBe("Mega Beedrill");
  });

  it("keeps the variant letter last", () => {
    expect(megaFormName("CHARIZARD", "TEMP_EVOLUTION_MEGA_X")).toBe("Mega Charizard X");
    expect(megaFormName("MEWTWO", "TEMP_EVOLUTION_MEGA_Y")).toBe("Mega Mewtwo Y");
  });

  it("names primals with their own prefix", () => {
    expect(megaFormName("KYOGRE", "TEMP_EVOLUTION_PRIMAL")).toBe("Primal Kyogre");
  });
});

describe("extractMegaForms", () => {
  const names = new Map([
    ["Gyarados", 130],
    ["Charizard", 6],
    ["Kyogre", 382],
    ["Staraptor", 398],
  ]);

  it("returns empty when no mega is named", () => {
    expect(extractMegaForms("Community Day: Bulbasaur", names).size).toBe(0);
  });

  it("detects a plain mega", () => {
    expect([...extractMegaForms("Mega Gyarados in Mega Raids", names)]).toEqual([[130, "mega"]]);
  });

  it("captures the variant letter", () => {
    expect([...extractMegaForms("Mega Charizard X in Mega Raids", names)]).toEqual([[6, "mega_x"]]);
  });

  it("detects primals", () => {
    expect([...extractMegaForms("Primal Kyogre in Raids", names)]).toEqual([[382, "primal"]]);
  });

  it("does not match a bare 'Mega' that is not a form", () => {
    // "Mega Raid Day" is an event format, not a mega Staraptor.
    expect(extractMegaForms("Staraptor Super Mega Raid Day", names).size).toBe(0);
    expect(extractMegaForms("Mega Squads", names).size).toBe(0);
  });
});

// ─── parseScrapedDuckEvent ────────────────────────────────────────────────────

describe("parseScrapedDuckEvent species ids", () => {
  const names = new Map([["Beedrill", 15], ["Malamar", 687]]);
  const base = { eventID: "e1", start: "2026-09-08T20:00:00", end: "2026-09-15T20:00:00" };

  it("emits a mega species id for a mega raid event", () => {
    // Regression: this path built events without species ids at all, so
    // "Mega Beedrill in Mega Raids" rendered the base sprite.
    const e = parseScrapedDuckEvent(
      { ...base, name: "Mega Beedrill in Mega Raids", eventType: "raid-battles" },
      names
    );
    expect(e.pokemonDexNrs).toEqual([15]);
    expect(e.pokemonSpeciesIds).toEqual(["15_mega"]);
  });

  it("reads the form from the boss icon, which names it directly", () => {
    const e = parseScrapedDuckEvent(
      {
        ...base,
        name: "Raid Hour",
        eventType: "raid-battles",
        extraData: { raidbattles: { bosses: [{ name: "Mega Beedrill", image: "https://x/pm15.fMEGA.icon.png" }] } },
      },
      names
    );
    expect(e.pokemonSpeciesIds).toEqual(["15_mega"]);
  });

  it("omits species ids when no form is involved", () => {
    const e = parseScrapedDuckEvent(
      { ...base, name: "Malamar Spotlight Hour", eventType: "pokemon-spotlight-hour" },
      names
    );
    expect(e.pokemonSpeciesIds).toBeUndefined();
  });
});
