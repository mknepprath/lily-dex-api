/**
 * Merge all sources into the final output schema.
 *
 * Priority: PokeMiners Game Master (stats, moves, evolutions) >
 *           pvpoke (released, tags) >
 *           pokemon-go-api (names, shiny, raids, quests)
 */
import { calculateDefaultIVs } from "./iv-calc.js";
import { buildMoveInfo } from "./sources/game-master.js";

export function mergePokemon(gameMaster, pvpoke, pokemonGoApi, pokeapi, overrides = {}) {
  const output = [];

  if (!gameMaster?.pokemon?.length) {
    console.warn("  No Game Master pokemon data to merge");
    return output;
  }

  for (const gm of gameMaster.pokemon) {
    if (!gm || !gm.dexNr) continue;
    const dex = gm.dexNr;

    // Determine release status
    const released = pvpoke.releasedDex.has(dex) || pokemonGoApi.assetsByDex?.has(dex) || false;

    // Supplement names from pokemon-go-api (has localized names)
    const apiNames = pokemonGoApi.namesByDex?.get(dex);
    if (apiNames) {
      gm.names = apiNames;
    }

    // Supplement moves from PvPoke (includes legacy/signature moves missing from Game Master)
    supplementMovesFromPvPoke(gm, pvpoke, gameMaster);

    // Supplement move names from pokemon-go-api
    const apiEntry = pokemonGoApi.pokedex?.find((e) => e.dexNr === dex);
    if (apiEntry) {
      supplementMoveNames(gm.quickMoves, apiEntry.quickMoves);
      supplementMoveNames(gm.cinematicMoves, apiEntry.cinematicMoves);
      supplementMoveNames(gm.eliteQuickMoves, apiEntry.eliteQuickMoves);
      supplementMoveNames(gm.eliteCinematicMoves, apiEntry.eliteCinematicMoves);

      // Supplement type names
      if (apiEntry.primaryType?.names) {
        gm.primaryType.names = apiEntry.primaryType.names;
      }
      if (apiEntry.secondaryType?.names && gm.secondaryType) {
        gm.secondaryType.names = apiEntry.secondaryType.names;
      }

      // Supplement evolution item names
      if (apiEntry.evolutions?.length > 0 && gm.evolutions?.length > 0) {
        for (const gmEvo of gm.evolutions) {
          if (gmEvo.item?.id) {
            const apiEvo = apiEntry.evolutions.find(
              (e) => e.item?.id === gmEvo.item.id
            );
            if (apiEvo?.item?.names) {
              gmEvo.item.names = apiEvo.item.names;
            }
          }
          if (gmEvo.lureItem?.id) {
            const apiEvo = apiEntry.evolutions.find(
              (e) => e.item?.id === gmEvo.lureItem.id
            );
            if (apiEvo?.item?.names) {
              gmEvo.lureItem.names = apiEvo.item.names;
            }
          }
        }
      }

      // Supplement regional form names, types, and assets
      if (apiEntry.regionForms && typeof gm.regionForms === "object" && !Array.isArray(gm.regionForms)) {
        for (const [formId, form] of Object.entries(gm.regionForms)) {
          const apiForm = Object.values(apiEntry.regionForms || {}).find(
            (f) => f?.formId === formId || f?.id === formId
          );
          if (apiForm?.names) {
            form.names = apiForm.names;
          }
          if (apiForm?.primaryType?.names && form.primaryType) {
            form.primaryType.names = apiForm.primaryType.names;
          }
          if (apiForm?.secondaryType?.names && form.secondaryType) {
            form.secondaryType.names = apiForm.secondaryType.names;
          }
          // Calculate PvP IVs for this form
          if (form.stats) {
            form.defaultIVs = calculateDefaultIVs(form.stats);
          }
          // Match assets from apiForm or from base assetForms by form suffix
          if (apiForm?.assets) {
            form.assets = apiForm.assets;
          } else if (apiEntry.assetForms?.length > 0) {
            // Match by form suffix (e.g., MEOWTH_ALOLA → "ALOLA")
            const suffix = formId.replace(/^[^_]+_/, "");
            const matchingAsset = apiEntry.assetForms.find(
              (af) => af.form === suffix
            );
            if (matchingAsset) {
              form.assets = {
                image: matchingAsset.image || null,
                shinyImage: matchingAsset.shinyImage || null,
              };
            }
          }
        }
      }

      // Asset forms (Unown letters, Burmy cloaks, etc.)
      if (apiEntry.assetForms?.length > 0) {
        gm.assetForms = apiEntry.assetForms;
      }
    }

    // Build sprite URLs from PokeAPI
    const spriteId = dex;
    const artworkBase =
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";
    const pixelBase =
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

    // Build assets - use pokemon-go-api assets if available, otherwise PokeAPI
    const apiAssets = pokemonGoApi.assetsByDex?.get(dex);
    const assets = apiAssets || {
      image: `${artworkBase}/${spriteId}.png`,
      shinyImage: `${artworkBase}/shiny/${spriteId}.png`,
    };

    // Clean up internal fields
    const { _candyToEvolve, _shadow, _familyId, ...cleanEntry } = gm;

    // Add PvPoke data
    const thirdMoveCost = pvpoke.thirdMoveCostByDex.get(dex) || null;
    const defaultIVs = calculateDefaultIVs(gm.stats);
    const tags = pvpoke.tagsByDex.get(dex) || [];

    // Full evolution family from PokeAPI
    const evolutionFamily = pokeapi?.familyByDex?.get(dex) || [];

    output.push({
      ...cleanEntry,
      released,
      thirdMoveCost,
      defaultIVs,
      tags,
      evolutionFamily,
      assets,
      pixelSprites: {
        image: `${pixelBase}/${spriteId}.png`,
        shinyImage: `${pixelBase}/shiny/${spriteId}.png`,
      },
    });
  }

  // Apply maintainer overrides
  for (const entry of output) {
    const override = overrides[String(entry.dexNr)];
    if (!override) continue;
    for (const [key, value] of Object.entries(override)) {
      if (key.startsWith("_")) continue; // skip _comment
      entry[key] = value;
    }
  }

  // Sort by dex number
  output.sort((a, b) => a.dexNr - b.dexNr);

  return output;
}

function supplementMoveNames(gmMoves, apiMoves) {
  if (!gmMoves || !apiMoves || Array.isArray(gmMoves) || Array.isArray(apiMoves)) return;

  for (const [moveId, gmMove] of Object.entries(gmMoves)) {
    const apiMove = apiMoves[moveId];
    if (apiMove) {
      if (apiMove.names) gmMove.names = apiMove.names;
      if (apiMove.type?.names && gmMove.type) {
        gmMove.type.names = apiMove.type.names;
      }
    }
  }
}

/**
 * Add moves from PvPoke that the Game Master doesn't include.
 * Handles signature moves (Behemoth Bash), legacy moves, etc.
 */
function supplementMovesFromPvPoke(gm, pvpoke, gameMaster) {
  if (!pvpoke.movesBySpeciesId || !gameMaster.movesMap) return;

  const { movesMap, combatMovesMap } = gameMaster;

  // Try to find PvPoke entry by formId or pokemonId
  // PvPoke uses bare names (mewtwo), GM uses MEWTWO_NORMAL — try both
  const formId = gm.formId || gm.pokemonId || "";
  const pvpId = formId.toLowerCase();
  const pvpIdBase = pvpId.replace(/_normal$/, "");
  const pvpMoves = pvpoke.movesBySpeciesId.get(pvpId) || pvpoke.movesBySpeciesId.get(pvpIdBase);

  // Supplement base form charged moves (skip moves already in elite list)
  if (pvpMoves && gm.cinematicMoves && typeof gm.cinematicMoves === "object" && !Array.isArray(gm.cinematicMoves)) {
    for (const moveId of pvpMoves.chargedMoves) {
      if (!gm.cinematicMoves[moveId] && !gm.eliteCinematicMoves?.[moveId]) {
        const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
        if (info) {
          gm.cinematicMoves[moveId] = info;
        }
      }
    }
    // Also add elite charged moves
    for (const moveId of pvpMoves?.eliteChargedMoves || []) {
      if (!gm.eliteCinematicMoves?.[moveId] && !gm.cinematicMoves[moveId]) {
        const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
        if (info) {
          if (!gm.eliteCinematicMoves || Array.isArray(gm.eliteCinematicMoves)) {
            gm.eliteCinematicMoves = {};
          }
          gm.eliteCinematicMoves[moveId] = info;
        }
      }
    }
    // Also add elite fast moves
    for (const moveId of pvpMoves?.eliteFastMoves || []) {
      if (!gm.eliteQuickMoves?.[moveId] && !gm.quickMoves[moveId]) {
        const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
        if (info) {
          if (!gm.eliteQuickMoves || Array.isArray(gm.eliteQuickMoves)) {
            gm.eliteQuickMoves = {};
          }
          gm.eliteQuickMoves[moveId] = info;
        }
      }
    }
  }

  // Supplement regional form moves too
  if (gm.regionForms && typeof gm.regionForms === "object" && !Array.isArray(gm.regionForms)) {
    for (const [formKey, form] of Object.entries(gm.regionForms)) {
      const formPvpId = formKey.toLowerCase();
      const formPvpMoves = pvpoke.movesBySpeciesId.get(formPvpId);
      if (!formPvpMoves) continue;

      if (form.cinematicMoves && typeof form.cinematicMoves === "object" && !Array.isArray(form.cinematicMoves)) {
        for (const moveId of formPvpMoves.chargedMoves) {
          if (!form.cinematicMoves[moveId]) {
            const info = buildMoveInfo(moveId, movesMap, combatMovesMap);
            if (info) {
              form.cinematicMoves[moveId] = info;
            }
          }
        }
      }
    }
  }
}
