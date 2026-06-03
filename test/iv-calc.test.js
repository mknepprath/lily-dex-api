import { describe, it, expect } from "vitest";
import { calculateDefaultIVs } from "../src/iv-calc.js";

describe("calculateDefaultIVs", () => {
  it("returns null for missing/zero stats", () => {
    expect(calculateDefaultIVs(null)).toBeNull();
    expect(calculateDefaultIVs({})).toBeNull();
    expect(calculateDefaultIVs({ baseAttack: 0, baseDefense: 0, baseStamina: 0 })).toBeNull();
  });

  it("accepts both baseAttack and attack field names", () => {
    const byBase = calculateDefaultIVs({ baseAttack: 100, baseDefense: 100, baseStamina: 100 });
    const byShort = calculateDefaultIVs({ attack: 100, defense: 100, stamina: 100 });
    expect(byBase).toEqual(byShort);
  });

  it("returns four CP brackets", () => {
    const result = calculateDefaultIVs({ baseAttack: 118, baseDefense: 111, baseStamina: 128 });
    expect(result).toHaveProperty("cp500");
    expect(result).toHaveProperty("cp1500");
    expect(result).toHaveProperty("cp2500");
    expect(result).toHaveProperty("cp2500l40");
  });

  it("each bracket is [level, ivAtk, ivDef, ivSta] or null", () => {
    const result = calculateDefaultIVs({ baseAttack: 118, baseDefense: 111, baseStamina: 128 });
    for (const key of ["cp500", "cp1500", "cp2500", "cp2500l40"]) {
      if (result[key] !== null) {
        expect(result[key]).toHaveLength(4);
        const [level, ivAtk, ivDef, ivSta] = result[key];
        expect(level).toBeGreaterThan(0);
        expect(ivAtk).toBeGreaterThanOrEqual(0);
        expect(ivAtk).toBeLessThanOrEqual(15);
        expect(ivDef).toBeGreaterThanOrEqual(0);
        expect(ivDef).toBeLessThanOrEqual(15);
        expect(ivSta).toBeGreaterThanOrEqual(0);
        expect(ivSta).toBeLessThanOrEqual(15);
      }
    }
  });

  it("high-stat Pokemon fit under GL cap", () => {
    // Mewtwo (300/182/214) can still make GL at very low level
    const result = calculateDefaultIVs({ baseAttack: 300, baseDefense: 182, baseStamina: 214 });
    expect(result.cp1500).not.toBeNull();
    const [level] = result.cp1500;
    expect(level).toBeLessThan(20); // Mewtwo needs low level for GL
  });

  it("cp2500l40 level capped at 40", () => {
    const result = calculateDefaultIVs({ baseAttack: 118, baseDefense: 111, baseStamina: 128 });
    if (result.cp2500l40) {
      const [level] = result.cp2500l40;
      expect(level).toBeLessThanOrEqual(40);
    }
  });

  it("cp2500 level can exceed 40 (uses best buddy)", () => {
    // A Pokemon that barely fits under 2500 at level 40+ with max IVs
    const result = calculateDefaultIVs({ baseAttack: 118, baseDefense: 111, baseStamina: 128 });
    if (result.cp2500 && result.cp2500l40) {
      // cp2500 may have same or higher level than cp2500l40
      expect(result.cp2500[0]).toBeGreaterThanOrEqual(result.cp2500l40[0]);
    }
  });
});
