import { describe, it, expect } from "vitest";
import { mergePokemon } from "../src/merge.js";

const makeGameMaster = (pokemon = []) => ({ pokemon });
const makePvpoke = (overrides = {}) => ({
  releasedDex: new Set([1]),
  tagsByDex: new Map(),
  buddyByDex: new Map(),
  familyByDex: new Map(),
  thirdMoveCostByDex: new Map(),
  defaultIVsByDex: new Map(),
  speciesIdToDex: new Map(),
  ...overrides,
});
const makePokemonGoApi = (overrides = {}) => ({
  pokedex: [],
  namesByDex: new Map(),
  assetsByDex: new Map(),
  assetFormsByDex: new Map(),
  ...overrides,
});

describe("mergePokemon", () => {
  it("returns empty array when gameMaster has no pokemon", () => {
    const result = mergePokemon(makeGameMaster([]), makePvpoke(), makePokemonGoApi());
    expect(result).toEqual([]);
  });

  it("handles null/undefined gameMaster gracefully", () => {
    expect(mergePokemon(null, makePvpoke(), makePokemonGoApi())).toEqual([]);
    expect(mergePokemon({}, makePvpoke(), makePokemonGoApi())).toEqual([]);
    expect(mergePokemon({ pokemon: null }, makePvpoke(), makePokemonGoApi())).toEqual([]);
  });

  it("skips entries with no dexNr", () => {
    const gm = makeGameMaster([{ id: "TEST", dexNr: null }]);
    const result = mergePokemon(gm, makePvpoke(), makePokemonGoApi());
    expect(result).toEqual([]);
  });

  it("skips unreleased pokemon", () => {
    const gm = makeGameMaster([{
      pokemonId: "BULBASAUR",
      dexNr: 1,
      type: "POKEMON_TYPE_GRASS",
      stats: { baseStamina: 128, baseAttack: 118, baseDefense: 111 },
    }]);
    const pvpoke = makePvpoke({ releasedDex: new Set() }); // none released
    const result = mergePokemon(gm, pvpoke, makePokemonGoApi());
    expect(result).toEqual([]);
  });

  it("merges a basic pokemon entry", () => {
    const gm = makeGameMaster([{
      pokemonId: "BULBASAUR",
      dexNr: 1,
      type: "POKEMON_TYPE_GRASS",
      type2: "POKEMON_TYPE_POISON",
      stats: { baseStamina: 128, baseAttack: 118, baseDefense: 111 },
      quickMoves: [],
      cinematicMoves: [],
      buddyDistance: 3,
    }]);
    const result = mergePokemon(gm, makePvpoke(), makePokemonGoApi());
    expect(result).toHaveLength(1);
    expect(result[0].dexNr).toBe(1);
    expect(result[0].buddyDistance).toBe(3);
  });

  it("handles missing pokemonGoApi maps gracefully", () => {
    const gm = makeGameMaster([{
      pokemonId: "BULBASAUR",
      dexNr: 1,
      type: "POKEMON_TYPE_GRASS",
      stats: { baseStamina: 128, baseAttack: 118, baseDefense: 111 },
    }]);
    // pokemonGoApi with undefined maps
    const result = mergePokemon(gm, makePvpoke(), { pokedex: null, namesByDex: undefined, assetsByDex: undefined });
    expect(result).toHaveLength(1);
  });
});
