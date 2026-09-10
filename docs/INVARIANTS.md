# Invariants

Rules that, when broken, produce something that looks right and is not.

Every one of these has been broken in production at least once. That is the bar
for being on this list — not "would be nice", but "we shipped the opposite and
did not notice". Where a check exists it is named beside the invariant and runs
in `tools/conformance.js` against the built artifacts in `output/`.

## Why this file and not more tests

The unit suite tests functions. It passed for months while the API published
every Mega Evolution with `stats: null`, because no test looked at what was
actually written to `output/`. Conformance reads the artifacts the app reads.

Two consequences worth stating plainly:

- **A passing unit suite is not evidence the data is right.** Both must pass.
- **This cannot catch a layout bug.** The scroll-anchor regression of 2026-09-09
  added ~100pt of dead space to three tabs while every test passed and the
  compiler was satisfied. It was caught by a person looking at a screenshot.
  Invariants are for claims about data, not about pixels.

## Blocking or advisory

A failed check either stops the deploy or does not, and the line is drawn by
what happens to users when it does. A blocked deploy leaves everyone on the
previous artifacts — no new events, raids or rankings until it is fixed.

- **Blocking** — shipping this is worse than shipping nothing new. Wrong dex
  numbers and misaligned sprites misrepresent the user's own collection.
- **Advisory** — degraded but worth shipping. An undecoded ampersand is not
  worth freezing every other user's event list over. Reported, exit 0.

## Data — enforced by `tools/conformance.js`

**1. Megas are published as forms.** `mega-forms-present` — advisory
Game Master has carried mega evolutions all along; the API never emitted them as
forms, so every consumer's form lookup missed and fell back to the base species.
Every mega rendered as its unevolved self across raids, events, PvP and the dex.

**2. Every mega form is complete.** `mega-forms-complete` — advisory
Name, both type slots resolved, non-zero stats. The stats and type overrides live
on `pokemonSettings.tempEvoOverrides`, not on `temporaryEvolutionSettings`, which
carries only an id and an asset bundle number. Reading the wrong one produces
forms that exist and describe nothing.

**3. A form carries its species' dex number.** `forms-carry-base-dex` — blocking
Caught state is keyed on dex number alone. A form with its own `dexNr` would
detach that Pokémon from the user's collection — it would appear uncaught, and
marking it caught would not mark the species. This invariant is why swapping a
mega form in for display is safe.

**4. Dex entries are unique.** `dex-entries-unique` — blocking
A duplicate double-counts a species in collection totals, which are the app's
central number.

**5. Species ids align positionally with dex numbers.** `species-ids-aligned` — blocking
The app walks `pokemonDexNrs` by index and reads `pokemonSpeciesIds[index]`. A
length mismatch does not error — it points a sprite at a different Pokémon. The
enrichment step rebuilds `pokemonDexNrs`, so anything that sets species ids
earlier must be folded in rather than left behind.

**6. Event titles are decoded.** `titles-decoded` — advisory
`Pokémon XP &amp; 2026 Worlds` shipped to users.

**7. No expired battle format is published.** `formats-not-expired` — advisory
Cups were merged from every GBL rotation with no date filter, so a format two
rotations away appeared as the live one while the actual rotation went unnamed.

**8. Format ids are unique.** `format-ids-unique` — blocking
Mega runs at three CP caps under a single PvPoke slug. Without a per-cap id the
app renders one chip and silently drops the other two.

**9. Every published format carries rankings.** `formats-have-rankings` — advisory
A format with an empty list renders an empty screen behind a chip.

## App — enforced by `LilyDexTests`, not by this tool

These are claims about behaviour, so they live with the code in
`mknepprath/lily-dex`. They are recorded here because the list is the point.

**10. A team can field at most one Mega Evolution.**
Pokémon GO only lets one Pokémon be Mega Evolved at a time — evolving a second
reverts the first. In Mega Master the entire top 10 is megas, so a builder with
no notion of megas returns a team that cannot be entered. Enforced in the greedy
builder, the role-based picks, and a final filter for builders with their own
assembly. Tested by `IsMegaTests`.

**11. `isMega` matches PvPoke's species list exactly.**
62 mega and primal forms, no false positives — `meganium` and `yanmega` are the
traps. Verified against the full list, not a sample.

**12. Presentation never changes caught state.**
A raid row may show the mega form; the row's identity stays the base dex number.
Follows from invariant 3 and is tested by `RaidDisplayFormTests`.

## Running it

```sh
node src/index.js        # build the artifacts
node tools/conformance.js # check them
```

Or `npm run conformance`. CI runs it after the build and before publishing, so a
broken blocking invariant stops the deploy rather than reaching users. Advisory
failures are printed and the deploy continues.

## Adding one

Add it when something ships wrong, not when something might. The list is
valuable because every entry is a scar; a list of hypotheticals would be noise
with the same shape. Write the check so it fails against the real broken data
before you trust it — a check that has never failed has not been tested.
