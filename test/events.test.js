import { describe, it, expect } from "vitest";
import {
  parseISOToNaive,
  parseTag,
  parseICSDate,
  unescapeICS,
  extractDexFromImage,
  matchNameToDex,
  extractCandidateNames,
  escapeRegex,
} from "../src/sources/events.js";
import { parseCupsFromEvents } from "../src/sources/pvpoke.js";

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
});
