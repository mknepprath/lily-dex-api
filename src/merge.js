/**
 * Merge all sources into the final output schema.
 *
 * Priority: PokeMiners Game Master (stats, moves, evolutions) >
 *           pvpoke (released, tags) >
 *           pokemon-go-api (names, shiny, raids, quests)
 */
export function mergePokemon(gameMaster, pvpoke, pokemonGoApi) {
  const output = [];

  for (const gm of gameMaster.pokemon) {
    const dex = gm.dexNr;

    // Only include released Pokemon
    if (!pvpoke.releasedDex.has(dex)) continue;

    // Supplement names from pokemon-go-api (has localized names)
    const apiNames = pokemonGoApi.namesByDex.get(dex);
    if (apiNames) {
      gm.names = apiNames;
    }

    // Supplement move names from pokemon-go-api
    const apiEntry = pokemonGoApi.pokedex.find((e) => e.dexNr === dex);
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
    const apiAssets = pokemonGoApi.assetsByDex.get(dex);
    const assets = apiAssets || {
      image: `${artworkBase}/${spriteId}.png`,
      shinyImage: `${artworkBase}/shiny/${spriteId}.png`,
    };

    // Clean up internal fields
    const { _candyToEvolve, _shadow, _familyId, ...cleanEntry } = gm;

    // Add PvPoke data
    const thirdMoveCost = pvpoke.thirdMoveCostByDex.get(dex) || null;
    const defaultIVs = pvpoke.defaultIVsByDex.get(dex) || null;

    output.push({
      ...cleanEntry,
      thirdMoveCost,
      defaultIVs,
      assets,
      pixelSprites: {
        image: `${pixelBase}/${spriteId}.png`,
        shinyImage: `${pixelBase}/shiny/${spriteId}.png`,
      },
    });
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
