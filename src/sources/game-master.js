import { fetchWithCache, TYPE_NAMES, getGeneration, idToName, moveIdToName } from "../utils.js";

const URL =
  "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json";

function buildTypeInfo(typeEnum) {
  if (!typeEnum) return null;
  const name = TYPE_NAMES[typeEnum] || typeEnum.replace("POKEMON_TYPE_", "");
  return {
    type: typeEnum,
    names: { English: name },
  };
}

function buildMoveInfo(moveId, movesMap, combatMovesMap) {
  if (!moveId || typeof moveId !== "string") return null;
  const move = movesMap.get(moveId) || movesMap.get(moveId + "_FAST");
  const combat = combatMovesMap.get(moveId) || combatMovesMap.get(moveId + "_FAST");

  return {
    id: moveId,
    power: move?.power || 0,
    energy: move?.energyDelta || 0,
    durationMs: move?.durationMs || 0,
    type: buildTypeInfo(move?.pokemonType || move?.type) || { type: "POKEMON_TYPE_NORMAL", names: { English: "Normal" } },
    names: { English: moveIdToName(moveId) },
    combat: combat
      ? {
          energy: combat.energyDelta || 0,
          power: combat.power || 0,
          turns: combat.durationTurns ? combat.durationTurns + 1 : 1,
          buffs: combat.buffs
            ? {
                buffActivationChance: (combat.buffs.buffsActivationChance || 0) * 100,
                attackerAttackStatStageChange: combat.buffs.attackerAttackStatStageChange || null,
                attackerDefenseStatStageChange: combat.buffs.attackerDefenseStatStageChange || null,
                targetAttackStatStageChange: combat.buffs.targetAttackStatStageChange || null,
                targetDefenseStatStageChange: combat.buffs.targetDefenseStatStageChange || null,
              }
            : null,
        }
      : null,
  };
}

export async function fetchGameMaster() {
  const { data, status, error } = await fetchWithCache("game-master", URL);

  // Parse all template types
  const pokemonMap = new Map(); // pokemonId → pokemonSettings
  const formsMap = new Map(); // pokemon → forms array
  const movesMap = new Map(); // moveId → move data
  const combatMovesMap = new Map(); // moveId → combat move data
  const tempEvoMap = new Map(); // pokemon → temp evolution settings

  for (const template of data) {
    const tid = template.templateId || template.data?.templateId || "";
    const d = template.data || template;

    if (d.pokemonSettings) {
      const ps = d.pokemonSettings;
      const dexMatch = tid.match(/V(\d{4})_POKEMON_/);
      if (dexMatch) {
        const dexNr = parseInt(dexMatch[1], 10);
        // Some newer Pokemon have numeric pokemonId — normalize to string from templateId
        if (typeof ps.pokemonId !== "string") {
          const baseName = tid.replace(/^V\d{4}_POKEMON_/, "").replace(/_NORMAL$/, "");
          ps.pokemonId = baseName;
        }
        // Extract form suffix from templateId (e.g., V0019_POKEMON_RATTATA_ALOLA → RATTATA_ALOLA)
        const formSuffix = tid.replace(/^V\d{4}_POKEMON_/, "");
        // Use formSuffix as key to preserve regional variants
        // Skip _NORMAL/_PURIFIED/_SHADOW duplicates — only keep base + regional
        if (formSuffix.endsWith("_NORMAL") || formSuffix.endsWith("_PURIFIED") || formSuffix.endsWith("_SHADOW")) {
          if (!pokemonMap.has(ps.pokemonId)) {
            pokemonMap.set(ps.pokemonId, { ...ps, dexNr, templateId: tid });
          }
        } else {
          pokemonMap.set(formSuffix, { ...ps, dexNr, templateId: tid });
        }
      }
    }

    if (d.formSettings) {
      formsMap.set(d.formSettings.pokemon, d.formSettings.forms || []);
    }

    if (d.moveSettings) {
      movesMap.set(d.moveSettings.movementId, d.moveSettings);
    }

    if (d.combatMove) {
      combatMovesMap.set(d.combatMove.uniqueId, d.combatMove);
    }

    if (d.temporaryEvolutionSettings) {
      tempEvoMap.set(
        d.temporaryEvolutionSettings.pokemonId,
        d.temporaryEvolutionSettings.temporaryEvolutions || []
      );
    }
  }

  // Group Pokemon by dex number to find base + regional forms
  const pokemonByDex = new Map();
  for (const [id, ps] of pokemonMap) {
    const dex = ps.dexNr;
    if (!pokemonByDex.has(dex)) pokemonByDex.set(dex, []);
    pokemonByDex.get(dex).push({ id, ...ps });
  }

  // Build Pokemon entries
  const pokemon = [];

  for (const [dexNr, entries] of pokemonByDex) {
    // The base entry is typically the one whose pokemonId matches the species
    // (no regional suffix like _ALOLA, _GALARIAN, etc.)
    const base =
      entries.find((e) => !e.templateId.includes("_ALOLA") &&
        !e.templateId.includes("_GALARIAN") &&
        !e.templateId.includes("_HISUIAN") &&
        !e.templateId.includes("_PALDEAN")) || entries[0];

    const formId = `${base.pokemonId}_NORMAL`;
    const forms = formsMap.get(base.pokemonId) || [];

    // Build quick moves
    const quickMoves = {};
    for (const moveId of base.quickMoves || []) {
      const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
      if (info) quickMoves[moveId] = info;
    }

    // Build charged moves
    const cinematicMoves = {};
    for (const moveId of base.cinematicMoves || []) {
      const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
      if (info) cinematicMoves[moveId] = info;
    }

    // Build elite moves
    const eliteQuickMoves = {};
    for (const moveId of base.eliteQuickMove || []) {
      const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
      if (info) eliteQuickMoves[moveId] = info;
    }
    const eliteCinematicMoves = {};
    for (const moveId of base.eliteCinematicMove || []) {
      const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
      if (info) eliteCinematicMoves[moveId] = info;
    }

    // Build evolution data
    const evolutions = (base.evolutionBranch || []).map((evo) => ({
      id: String(evo.evolution || ""),
      formId: String(evo.form || `${evo.evolution}_NORMAL`),
      candies: evo.candyCost || 0,
      item: evo.evolutionItemRequirement || null,
      quests: evo.questDisplay
        ? [{ id: evo.questDisplay.questRequirementTemplateId || "", type: null, names: { English: evo.questDisplay.questRequirementTemplateId || "" } }]
        : null,
    }));

    // Build regional forms
    const regionForms = entries
      .filter((e) => e.id !== base.id)
      .reduce((acc, regionEntry) => {
        const regionFormId = regionEntry.id;
        const regionQuickMoves = {};
        for (const moveId of regionEntry.quickMoves || []) {
          const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
          if (info) regionQuickMoves[moveId] = info;
        }
        const regionCinematicMoves = {};
        for (const moveId of regionEntry.cinematicMoves || []) {
          const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
          if (info) regionCinematicMoves[moveId] = info;
        }

        acc[regionFormId] = {
          id: String(regionFormId),
          formId: String(regionFormId),
          dexNr,
          generation: getGeneration(dexNr),
          names: { English: idToName(regionFormId) },
          stats: {
            stamina: regionEntry.stats?.baseStamina || 0,
            attack: regionEntry.stats?.baseAttack || 0,
            defense: regionEntry.stats?.baseDefense || 0,
          },
          primaryType: buildTypeInfo(regionEntry.type),
          secondaryType: buildTypeInfo(regionEntry.type2),
          pokemonClass: null,
          quickMoves: regionQuickMoves,
          cinematicMoves: regionCinematicMoves,
          eliteQuickMoves: [],
          eliteCinematicMoves: [],
          evolutions: (regionEntry.evolutionBranch || []).map((evo) => ({
            id: String(evo.evolution || ""),
            formId: String(evo.form || `${evo.evolution}_NORMAL`),
            candies: evo.candyCost || 0,
          })),
          hasMegaEvolution: false,
          megaEvolutions: [],
          hasGigantamaxEvolution: false,
          regionForms: [],
          assetForms: [],
        };
        return acc;
      }, {});

    // Determine pokemonClass
    let pokemonClass = null;
    if (base.pokemonClass === "POKEMON_CLASS_LEGENDARY") pokemonClass = "POKEMON_CLASS_LEGENDARY";
    else if (base.pokemonClass === "POKEMON_CLASS_MYTHIC") pokemonClass = "POKEMON_CLASS_MYTHIC";
    else if (base.pokemonClass === "POKEMON_CLASS_ULTRA_BEAST") pokemonClass = "POKEMON_CLASS_ULTRA_BEAST";

    // Mega evolutions
    const tempEvos = tempEvoMap.get(base.pokemonId) || [];
    const megaEvolutions = tempEvos.map((evo) => ({
      id: evo.temporaryEvolutionId,
      stats: evo.stats
        ? {
            stamina: evo.stats.baseStamina || 0,
            attack: evo.stats.baseAttack || 0,
            defense: evo.stats.baseDefense || 0,
          }
        : null,
      primaryType: buildTypeInfo(evo.typeOverride1),
      secondaryType: buildTypeInfo(evo.typeOverride2),
    }));

    pokemon.push({
      id: String(base.pokemonId),
      formId: String(formId),
      dexNr,
      generation: getGeneration(dexNr),
      names: { English: idToName(base.pokemonId) },
      stats: {
        stamina: base.stats?.baseStamina || 0,
        attack: base.stats?.baseAttack || 0,
        defense: base.stats?.baseDefense || 0,
      },
      primaryType: buildTypeInfo(base.type),
      secondaryType: buildTypeInfo(base.type2),
      pokemonClass,
      quickMoves,
      cinematicMoves,
      eliteQuickMoves: Object.keys(eliteQuickMoves).length > 0 ? eliteQuickMoves : [],
      eliteCinematicMoves: Object.keys(eliteCinematicMoves).length > 0 ? eliteCinematicMoves : [],
      regionForms: Object.keys(regionForms).length > 0 ? regionForms : [],
      evolutions: evolutions.length > 0 ? evolutions : [],
      hasMegaEvolution: megaEvolutions.length > 0,
      megaEvolutions: megaEvolutions.length > 0 ? megaEvolutions : [],
      hasGigantamaxEvolution: false,
      assetForms: [],
      // These will be filled in by merge.js
      _buddyDistance: base.kmBuddyDistance || 0,
      _candyToEvolve: base.candyToEvolve || 0,
      _shadow: !!base.shadow,
      _familyId: base.familyId || null,
    });
  }

  return { pokemon, status, error };
}
