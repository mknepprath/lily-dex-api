import { describe, it, expect } from "vitest";
import { getGeneration, idToName, moveIdToName } from "../src/utils.js";

describe("getGeneration", () => {
  it("returns correct generation for each range", () => {
    expect(getGeneration(1)).toBe(1);
    expect(getGeneration(151)).toBe(1);
    expect(getGeneration(152)).toBe(2);
    expect(getGeneration(251)).toBe(2);
    expect(getGeneration(387)).toBe(4);
    expect(getGeneration(906)).toBe(9);
  });
});

describe("idToName", () => {
  it("converts pokemon IDs to readable names", () => {
    expect(idToName("BULBASAUR")).toBe("Bulbasaur");
    expect(idToName("MR_MIME")).toBe("Mr Mime");
  });

  it("handles null/undefined input", () => {
    expect(idToName(null)).toBe("Unknown");
    expect(idToName(undefined)).toBe("Unknown");
    expect(idToName("")).toBe("Unknown");
  });
});

describe("moveIdToName", () => {
  it("strips _FAST suffix and formats", () => {
    expect(moveIdToName("VINE_WHIP_FAST")).toBe("Vine Whip");
    expect(moveIdToName("SOLAR_BEAM")).toBe("Solar Beam");
  });
});
