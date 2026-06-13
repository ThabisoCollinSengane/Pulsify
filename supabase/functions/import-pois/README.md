# import-pois — Apify → Pulsify POI ingest

Receives scraped places from the **Apify Google Maps Scraper**, maps them to
Pulsify POI categories, validates South-Africa bounds, and upserts into the
`pois` table. Deduped on a deterministic id (`apify_<hash of name+coords>`), so
re-running a scrape updates rows instead of creating duplicates.

## Endpoint

```
POST https://cjzewfvtdayjgjdpdmln.supabase.co/functions/v1/import-pois?secret=<POI_IMPORT_SECRET>
```

Auth is the shared `secret` query param (or `x-import-secret` header). `verify_jwt`
is off because Apify can't mint a Supabase JWT.

## Accepted body shapes

1. A raw JSON array of place items
2. `{ "items": [...] }` or `{ "data": [...] }`
3. An Apify webhook envelope `{ "resource": { "defaultDatasetId": "..." } }` —
   the function fetches the dataset from the Apify API (needs `APIFY_TOKEN` set)

## Category mapping

Only useful civic categories are kept; everything else is skipped.

| Google Maps category contains | → Pulsify category |
|---|---|
| taxi / minibus / rank | `taxi_rank` |
| atm / cash machine | `atm` |
| gas station / petrol / filling / fuel | `fuel` |
| pharmacy / chemist / drugstore | `pharmacy` |
| supermarket / grocer / hypermarket | `supermarket` |
| bus stop / bus station / brt / transit | `bus_stop` |
| clinic / hospital / medical centre | `clinic` |
| (anything else) | skipped |

Imported rows are marked `is_verified = true` (Google Maps is authoritative).
Existing rows keep their `votes` count on re-import.

## Environment variables (Supabase → Edge Functions → Secrets)

| Var | Purpose | Default |
|---|---|---|
| `POI_IMPORT_SECRET` | guards the endpoint | `pulsify_poi_2026` (**change in prod**) |
| `SUPABASE_SERVICE_ROLE_KEY` | DB writes (auto-provided) | — |
| `APIFY_TOKEN` | only needed for the webhook-envelope path | — |

## Wiring Apify (the remaining 10-minute step)

1. In Apify, run the **Google Maps Scraper** actor with search terms like
   `taxi rank`, `ATM`, `pharmacy`, `petrol station` and `Country: South Africa`
   (or per-city: Durban, Johannesburg, Cape Town, Pretoria…).
2. Actor → **Integrations → Webhooks → Add webhook**:
   - Event: `ACTOR.RUN.SUCCEEDED`
   - URL: the endpoint above (with `?secret=...`)
   - Payload template: send the dataset items, or leave the default envelope
     (then set `APIFY_TOKEN` so this function pulls the dataset itself).
3. Run the actor — places flow straight onto the live map.

### Quick manual test (no Apify needed)

```bash
curl -X POST 'https://cjzewfvtdayjgjdpdmln.supabase.co/functions/v1/import-pois?secret=pulsify_poi_2026' \
  -H 'Content-Type: application/json' \
  -d '[{"title":"Test Rank","categoryName":"Taxi stand","location":{"lat":-29.86,"lng":31.01},"city":"Durban"}]'
# → {"success":true,"received":1,"imported":1,"skipped":0}
```
