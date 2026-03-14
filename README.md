# lily-dex-api

Pokemon GO data API for [lily dex](https://github.com/mknepprath/lily-dex). Aggregates data from multiple sources into a unified JSON API, deployed to GitHub Pages on a 6-hour build cycle.

**Base URL:** `https://mknepprath.github.io/lily-dex-api/`

## Data Sources

| Source | What it provides | URL |
|--------|-----------------|-----|
| [PokeMiners Game Master](https://github.com/PokeMiners/game_masters) | Pokemon stats, moves, evolutions, forms | `game_masters/master/latest/latest.json` |
| [PvPoke](https://github.com/pvpoke/pvpoke) | PvP rankings (Great/Ultra/Master League) | `pvpoke/master/src/data` |
| [Pokemon GO API](https://pokemon-go-api.github.io/pokemon-go-api) | Names, sprites, raid bosses, max battles, quests, types | `pokemon-go-api/api/*.json` |
| [GO Calendar](https://github.com/othyn/go-calendar) | Pokemon GO events (ICS format) | `go-calendar/releases/latest/download/gocal.ics` |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `pokedex.json` | Complete Pokemon data (stats, moves, types, evolutions, forms) |
| `rankings.json` | PvP rankings for Little, Great, Ultra, and Master leagues |
| `raidboss.json` | Current raid bosses |
| `maxbattles.json` | Current max battle bosses |
| `events.json` | Pokemon GO events with naive timestamps (interpreted as local time) |
| `types.json` | Type effectiveness data |
| `quests.json` | Field research quests |
| `meta.json` | Build metadata: timestamp, source status, Pokemon count |

## Build

```sh
npm install
npm run build   # node src/index.js
npm test        # vitest
```

Requires Node.js >= 20. No runtime dependencies.

## Deployment

GitHub Actions runs `node src/index.js` on push to main, every 6 hours, or manual dispatch. Output files are deployed to GitHub Pages. Source fetch results are cached in `cache/` and committed back so builds can fall back to cached data if an upstream source is temporarily unavailable.
