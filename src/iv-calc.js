/**
 * Calculate rank 1 PvP IVs for a given Pokemon's base stats and CP cap.
 *
 * Pokemon GO CP formula:
 *   CP = floor((atk + ivAtk) * sqrt(def + ivDef) * sqrt(sta + ivSta) * cpm² / 10)
 *
 * Stat product (used for ranking):
 *   SP = (atk + ivAtk) * cpm * (def + ivDef) * cpm * floor((sta + ivSta) * cpm)
 */

// CP multiplier table — static, never changes in Pokemon GO
const CPM = [
  [1, 0.094], [1.5, 0.135137432], [2, 0.16639787], [2.5, 0.192650919],
  [3, 0.21573247], [3.5, 0.236572661], [4, 0.25572005], [4.5, 0.273530381],
  [5, 0.29024988], [5.5, 0.306057377], [6, 0.3210876], [6.5, 0.335445036],
  [7, 0.34921268], [7.5, 0.362457751], [8, 0.37523559], [8.5, 0.387592406],
  [9, 0.39956728], [9.5, 0.411193551], [10, 0.42250001], [10.5, 0.432926419],
  [11, 0.44310755], [11.5, 0.4530599578], [12, 0.46279839], [12.5, 0.472336083],
  [13, 0.48168495], [13.5, 0.4908558], [14, 0.49985844], [14.5, 0.508701765],
  [15, 0.51739395], [15.5, 0.525942511], [16, 0.53435433], [16.5, 0.542635767],
  [17, 0.55079269], [17.5, 0.558830576], [18, 0.56675452], [18.5, 0.574569153],
  [19, 0.58227891], [19.5, 0.589887917], [20, 0.59740001], [20.5, 0.604818814],
  [21, 0.61215729], [21.5, 0.619399365], [22, 0.62656713], [22.5, 0.633644533],
  [23, 0.64065295], [23.5, 0.647576426], [24, 0.65443563], [24.5, 0.661214806],
  [25, 0.667934], [25.5, 0.674577537], [26, 0.68116492], [26.5, 0.687680648],
  [27, 0.69414365], [27.5, 0.700538673], [28, 0.70688421], [28.5, 0.713164996],
  [29, 0.71939909], [29.5, 0.725571552], [30, 0.7317], [30.5, 0.734741009],
  [31, 0.73776948], [31.5, 0.740785574], [32, 0.74378943], [32.5, 0.746781211],
  [33, 0.74976104], [33.5, 0.752729087], [34, 0.75568551], [34.5, 0.758630378],
  [35, 0.76156384], [35.5, 0.764486065], [36, 0.76739717], [36.5, 0.770297266],
  [37, 0.7731865], [37.5, 0.776064962], [38, 0.77893275], [38.5, 0.781790055],
  [39, 0.78463697], [39.5, 0.787473578], [40, 0.79030001], [40.5, 0.792803968],
  [41, 0.79530001], [41.5, 0.797800015], [42, 0.80030001], [42.5, 0.802800016],
  [43, 0.80530001], [43.5, 0.807800016], [44, 0.81030001], [44.5, 0.812800017],
  [45, 0.81530001], [45.5, 0.817800017], [46, 0.82030001], [46.5, 0.822800018],
  [47, 0.82530001], [47.5, 0.827800018], [48, 0.83030001], [48.5, 0.832800019],
  [49, 0.83530001], [49.5, 0.837800019], [50, 0.84030001], [50.5, 0.842300019],
  [51, 0.84530001],
];

// Precompute CPM² for speed
const CPM_SQUARED = CPM.map(([lvl, cpm]) => [lvl, cpm, cpm * cpm]);

function calcCP(atk, def, sta, cpmSq) {
  return Math.max(10, Math.floor(atk * Math.sqrt(def) * Math.sqrt(sta) * cpmSq / 10));
}

/**
 * Find rank 1 IVs for a CP cap.
 * @param {number} baseAtk
 * @param {number} baseDef
 * @param {number} baseSta
 * @param {number} cpCap
 * @param {number} [maxLevel=51] - Max level to consider (51 = level 50 + best buddy)
 * @returns {[number, number, number, number] | null} [level, ivAtk, ivDef, ivSta] or null
 */
function rank1IVs(baseAtk, baseDef, baseSta, cpCap, maxLevel = 51) {
  let bestSP = 0;
  let bestResult = null;

  for (let ivAtk = 0; ivAtk <= 15; ivAtk++) {
    const atk = baseAtk + ivAtk;
    for (let ivDef = 0; ivDef <= 15; ivDef++) {
      const def = baseDef + ivDef;
      const sqrtDef = Math.sqrt(def);
      for (let ivSta = 0; ivSta <= 15; ivSta++) {
        const sta = baseSta + ivSta;
        const sqrtSta = Math.sqrt(sta);

        // Find max level where CP <= cap
        let bestLevel = null;
        let bestLevelCpm = 0;
        for (const [lvl, cpm, cpmSq] of CPM_SQUARED) {
          if (lvl > maxLevel) break;
          const cp = Math.max(10, Math.floor(atk * sqrtDef * sqrtSta * cpmSq / 10));
          if (cp <= cpCap) {
            bestLevel = lvl;
            bestLevelCpm = cpm;
          } else {
            break; // CPM increases with level, so no point checking higher
          }
        }

        if (bestLevel !== null) {
          const sp = (atk * bestLevelCpm) * (def * bestLevelCpm) * Math.floor(sta * bestLevelCpm);
          if (sp > bestSP) {
            bestSP = sp;
            bestResult = [bestLevel, ivAtk, ivDef, ivSta];
          }
        }
      }
    }
  }

  return bestResult;
}

/**
 * Calculate defaultIVs for a Pokemon.
 * @param {{ baseAttack: number, baseDefense: number, baseStamina: number }} stats
 * @returns {{ cp500: number[]|null, cp1500: number[]|null, cp2500: number[]|null, cp2500l40: number[]|null }}
 */
export function calculateDefaultIVs(stats) {
  const atk = stats?.baseAttack ?? stats?.attack;
  const def = stats?.baseDefense ?? stats?.defense;
  const sta = stats?.baseStamina ?? stats?.stamina;

  if (!atk || !def || !sta) {
    return null;
  }

  const cp500 = rank1IVs(atk, def, sta, 500);
  const cp1500 = rank1IVs(atk, def, sta, 1500);
  const cp2500 = rank1IVs(atk, def, sta, 2500);
  const cp2500l40 = rank1IVs(atk, def, sta, 2500, 40);

  return {
    cp500: cp500,
    cp1500: cp1500,
    cp2500: cp2500,
    cp2500l40: cp2500l40,
  };
}
