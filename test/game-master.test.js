import { describe, it, expect } from "vitest";
import { buildMoveInfo, buildEvolutionItem, buildEvolutionEntry } from "../src/sources/game-master.js";

// ─── buildMoveInfo ───────────────────────────────────────────────────────────

describe("buildMoveInfo", () => {
  it("returns null for missing/invalid moveId", () => {
    expect(buildMoveInfo(null, new Map(), new Map())).toBeNull();
    expect(buildMoveInfo("", new Map(), new Map())).toBeNull();
    expect(buildMoveInfo(42, new Map(), new Map())).toBeNull();
  });

  it("builds a basic fast move from movesMap", () => {
    const movesMap = new Map([
      ["VINE_WHIP_FAST", { power: 7, energyDelta: 6, durationMs: 600, pokemonType: "POKEMON_TYPE_GRASS" }],
    ]);
    const result = buildMoveInfo("VINE_WHIP_FAST", movesMap, new Map());
    expect(result.id).toBe("VINE_WHIP_FAST");
    expect(result.power).toBe(7);
    expect(result.energy).toBe(6);
    expect(result.names.English).toBe("Vine Whip");
    expect(result.type.type).toBe("POKEMON_TYPE_GRASS");
    expect(result.type.names.English).toBe("Grass");
    expect(result.combat).toBeNull();
  });

  it("includes combat data when combatMovesMap has an entry", () => {
    const movesMap = new Map([
      ["SOLAR_BEAM", { power: 180, energyDelta: -100, durationMs: 4900, pokemonType: "POKEMON_TYPE_GRASS" }],
    ]);
    const combatMovesMap = new Map([
      ["SOLAR_BEAM", { power: 150, energyDelta: -80, durationTurns: 4 }],
    ]);
    const result = buildMoveInfo("SOLAR_BEAM", movesMap, combatMovesMap);
    expect(result.combat.power).toBe(150);
    expect(result.combat.energy).toBe(-80);
    expect(result.combat.turns).toBe(5); // durationTurns + 1
    expect(result.combat.buffs).toBeNull();
  });

  it("falls back to _FAST suffix when base id not found", () => {
    const movesMap = new Map([
      ["MUD_SHOT_FAST", { power: 5, energyDelta: 9, pokemonType: "POKEMON_TYPE_GROUND" }],
    ]);
    const result = buildMoveInfo("MUD_SHOT", movesMap, new Map());
    expect(result.id).toBe("MUD_SHOT");
    expect(result.power).toBe(5);
    expect(result.names.English).toBe("Mud Shot");
  });

  it("handles missing move gracefully with zero values", () => {
    const result = buildMoveInfo("UNKNOWN_MOVE", new Map(), new Map());
    expect(result.power).toBe(0);
    expect(result.energy).toBe(0);
    expect(result.type.type).toBe("POKEMON_TYPE_NORMAL");
    expect(result.combat).toBeNull();
  });
});

// ─── buildEvolutionItem ───────────────────────────────────────────────────────

describe("buildEvolutionItem", () => {
  it("returns null for missing itemId", () => {
    expect(buildEvolutionItem(null)).toBeNull();
    expect(buildEvolutionItem(undefined)).toBeNull();
    expect(buildEvolutionItem("")).toBeNull();
  });

  it("uses ITEM_NAMES lookup for known items", () => {
    const result = buildEvolutionItem("ITEM_SUN_STONE");
    expect(result.id).toBe("ITEM_SUN_STONE");
    expect(result.names.English).toBe("Sun Stone");
  });

  it("falls back to idToName for unknown items", () => {
    const result = buildEvolutionItem("ITEM_SOME_NEW_STONE");
    expect(result.id).toBe("ITEM_SOME_NEW_STONE");
    expect(result.names.English).toBe("Item Some New Stone");
  });
});

// ─── buildEvolutionEntry ─────────────────────────────────────────────────────

describe("buildEvolutionEntry", () => {
  const pokemonMap = new Map([
    ["IVYSAUR", { dexNr: 2 }],
    ["VENUSAUR_NORMAL", { dexNr: 3 }],
  ]);

  it("builds a basic candy-only evolution", () => {
    const evo = { evolution: "IVYSAUR", candyCost: 25 };
    const result = buildEvolutionEntry(evo, pokemonMap);
    expect(result.id).toBe("IVYSAUR");
    expect(result.formId).toBe("IVYSAUR_NORMAL");
    expect(result.dexNr).toBe(2);
    expect(result.candies).toBe(25);
    expect(result.item).toBeNull();
    expect(result.lureItem).toBeNull();
    expect(result.quests).toBeNull();
    expect(result.tradeEvolution).toBe(false);
  });

  it("includes evolution item when present", () => {
    const evo = { evolution: "SLOWKING", candyCost: 50, evolutionItemRequirement: "ITEM_KINGS_ROCK" };
    const result = buildEvolutionEntry(evo, new Map());
    expect(result.item.id).toBe("ITEM_KINGS_ROCK");
    expect(result.item.names.English).toBe("King's Rock");
  });

  it("resolves dexNr via _NORMAL suffix fallback", () => {
    const evo = { evolution: "VENUSAUR" };
    const result = buildEvolutionEntry(evo, pokemonMap);
    expect(result.dexNr).toBe(3);
  });

  it("marks trade evolution", () => {
    const evo = { evolution: "ALAKAZAM", candyCost: 100, noCandyCostViaTrade: true };
    const result = buildEvolutionEntry(evo, new Map());
    expect(result.tradeEvolution).toBe(true);
  });

  it("includes quests when questTemplateMap provided", () => {
    const questTemplateMap = new Map([["QUEST_WALK_5KM", "Walk 5km as buddy"]]);
    const evo = {
      evolution: "ESPEON",
      candyCost: 25,
      questDisplay: [{ questRequirementTemplateId: "QUEST_WALK_5KM" }],
    };
    const result = buildEvolutionEntry(evo, new Map(), questTemplateMap);
    expect(result.quests).toHaveLength(1);
    expect(result.quests[0].names.English).toBe("Walk 5km as buddy");
  });

  it("omits quests when no questTemplateMap", () => {
    const evo = {
      evolution: "ESPEON",
      questDisplay: [{ questRequirementTemplateId: "QUEST_WALK_5KM" }],
    };
    const result = buildEvolutionEntry(evo, new Map());
    expect(result.quests).toBeNull();
  });

  it("regional form quests work when questTemplateMap passed", () => {
    // Matches real data: Galarian Slowpoke → Galarian Slowbro requires a quest
    const questTemplateMap = new Map([["SLOWBRO_G_EVOLUTION_QUEST", "Catch 30 Psychic-type Pokémon"]]);
    const evo = {
      evolution: "SLOWBRO",
      candyCost: 50,
      questDisplay: [{ questRequirementTemplateId: "SLOWBRO_G_EVOLUTION_QUEST" }],
    };
    const result = buildEvolutionEntry(evo, new Map(), questTemplateMap);
    expect(result.quests).toHaveLength(1);
    expect(result.quests[0].names.English).toBe("Catch 30 Psychic-type Pokémon");
  });

  it("handles daytime/nighttime/buddy restrictions", () => {
    const evo = { evolution: "ESPEON", onlyDaytime: true, mustBeBuddy: true };
    const result = buildEvolutionEntry(evo, new Map());
    expect(result.onlyDaytime).toBe(true);
    expect(result.onlyNighttime).toBe(false);
    expect(result.mustBeBuddy).toBe(true);
  });
});
