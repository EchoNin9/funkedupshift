# Scaling the Websites & Media lists (FUNK-93)

Status: **not urgent** (about 133 sites as of 2026-11-14). Revisit when sites or media reach
the low thousands, when `/websites` latency is noticeable, or when DynamoDB read
spend shows up on the bill.

## How it works today

| Call | What it reads |
|---|---|
| `GET /sites`, `GET /media` (every `/websites` / media page view and every search keystroke after debounce) | **Entire** `byEntity` partition for that entity type (paginated fully since PR #187), then filter/sort in Lambda |
| `GET /sites/latest` (homepage) | Entire partition, then sorts by `createdAt` in Lambda and keeps N |
| `POST /sites`, `PUT /sites` (dedupe gate) | Entire partition (PK + url) |

The `byEntity` GSI (`infra/main.tf`) has `projection_type = "ALL"`, and SITE items
carry `scrapedContent` (up to 100 KB). The table is `PAY_PER_REQUEST`.

**DynamoDB bills a Query on the size of the items it reads, not on what you
return.** `ProjectionExpression` trims the response but **does not** reduce read
units. So every list request pays for every site's `scrapedContent`.

Rough cost model, GSI reads (eventually consistent, so 0.5 RRU per 4 KB;
excludes the small per-request `batch_get_item` category lookups):

```
RRU per list request ≈ (sites × avg item KB) / 4 × 0.5
```

Example with an *assumed* 20 KB average item (most of it scrapedContent; measure
before deciding):

| Sites | Page views / month | RRU / month | Approx. on-demand read cost |
|---|---|---|---|
| 133 | 100k | ~33M | a few $ |
| 1,000 | 1M | ~2.5B | low hundreds of $ |
| 5,000 | 1M | ~12.5B | ~$1k+ |

Latency grows the same way: a Query page caps at 1 MB, so 1,000 × 20 KB means
about 20 sequential round trips per request.

## Would an index help? Yes, but only certain ones

Indexes in DynamoDB help in two ways: they **read fewer items** (a key
condition or sort-key range), or they **read smaller items** (a narrower
projection). They do **not** help substring search (`q`): DynamoDB can't do
"contains" without reading everything.

Ranked by value and effort:

1. **Slim list GSI (biggest, cheapest win).** Add a GSI (e.g. `byEntityList`) with
   `projection_type = "INCLUDE"` and only the fields the list readers use.
   **Build the `non_key_attributes` list from the code, not from this doc:**
   every attribute in `listSites`' `ProjectionExpression` (today: title, url,
   description, `descriptionAiGenerated`, `totalStarsSum`/`totalStarsCount`,
   categoryIds, logoUrl, logoKey) plus `createdAt` for sorting, **and** every
   attribute `_dynamoItemToMedia` reads for MEDIA items (media has a different
   shape and currently reads the full item). A GSI query can't return an
   unprojected attribute, so a missing one silently disappears from the UI.
   Read cost drops roughly by the ratio of full item size to list fields size
   (likely 5-20×). Trade-off: each SITE/MEDIA write also writes the new index
   (extra WRU + storage), which is cheap because writes are rare.
   - Alternative: move `scrapedContent` out of the SITE item (separate
     `SK=SCRAPED` item or S3). That shrinks every read path, not just lists.
2. **`createdAt` sort key for latest.** A GSI with `entityType` + `createdAt` lets
   `/sites/latest` read N items with `ScanIndexForward=false, Limit=N` instead
   of the whole partition. It also enables true server-side paging for a "newest
   first" list. It is a sparse index: items without `createdAt` won't appear
   (today they sort last but can still show), so backfill `createdAt` first.
3. **URL-uniqueness item for the dedupe gate.** On create, `TransactWriteItems`:
   put the SITE plus put `PK=SITEURL#<normalized>` with
   `attribute_not_exists(PK)`. That is O(1) and race-free. Today's
   read-then-write check can let a duplicate through: two simultaneous adds both
   pass, and because GSI reads are eventually consistent, a site added a moment
   earlier may not be visible in `byEntity` yet. Needs a one-time backfill and
   to be maintained on URL edit/delete.
4. **Cache the public list.** The list changes only on admin edits and ratings.
   Options: CloudFront cache on `GET /sites` with a short TTL, or write a
   precomputed JSON to S3 on change (the existing highlights/highest-rated cache
   generators are a template). This removes DynamoDB from the hot path entirely
   and is the right answer for search at moderate scale (filter client-side or
   in Lambda against the cached blob).
   - **Logo URL caveat:** `_addLogoUrls` returns presigned S3 GETs that expire
     after 1 hour when a site has only `logoKey`. Cache `logoKey`, not the
     presigned URL, and presign (or serve via a CDN path) at response time, or
     keep any response cache TTL well under an hour.
   - `GET /sites` works with or without auth (`fetchWithAuthOptional`); make sure
     the cache key doesn't vary on the Authorization header, or the cache is
     fragmented per user.
5. **Real search (only if needed).** At large scale or for fuzzy/relevance search:
   OpenSearch Serverless, or a DynamoDB Streams to search-index pipeline. Likely
   overkill for this site.

**Hot-partition note (reads, not writes):** every list request reads the whole
`entityType = SITE` key value, which lives in one partition. A single partition
serves about 3,000 RCU/s. DynamoDB may split hot key ranges by sort key under
load, but don't count on it. At the assumed 20 KB per item a list request costs
~332 RRU today, so roughly 9 req/s (a few users typing in search) could
throttle; at 1,000 sites (~2,500 RRU/request) it's 1-2 req/s. Options 1 (slim
projection) and 4 (cache) remove this risk; that's another reason to do them
first.

## Suggested order when the time comes

1 (slim projection) → 4 (cache) → 2 (createdAt index) → 3 (uniqueness item).
Measure first: run the `byEntity` query for `SITE` with
`--return-consumed-capacity TOTAL` and divide by the item count to get the real
average item size, then confirm the cost model before building anything.
