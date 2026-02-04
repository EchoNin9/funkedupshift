# DynamoDB single-table design

Table name: `fus-main` (or value of `var.dynamoTableName`).  
Partition key: **PK** (String). Sort key: **SK** (String).  
Billing: **PAY_PER_REQUEST**.

## GSIs

| GSI name   | Partition key | Sort key  | Use case                          |
|-----------|----------------|-----------|-----------------------------------|
| **byEntity** | entityType (S) | entitySk (S) | List all sites: `entityType=SITE` |
| **byTag**    | tag (S)        | siteId (S)   | Sites by tag: `tag=javascript`    |
| **byStars**  | starRating (N) | siteId (S)   | Ratings by value: `starRating=5`  |

## Item types and access patterns

### 1. Site (catalog entry)

One item per site. Only admins create/update; everyone can read.

| PK          | SK       | Attributes (examples) |
|-------------|----------|------------------------|
| SITE#\<id\> | METADATA | url, title, description, scrapedContent, tags (list), createdAt, updatedAt, **entityType**=SITE, **entitySk**=SITE#\<id\> |

- **Get site:** `GetItem(PK=SITE#\<id\>, SK=METADATA)`.
- **List all sites:** Query GSI **byEntity** with `entityType=SITE`, sort by `entitySk` (or add createdAt to entitySk for ordering).

### 2. Site–tag (for query by tag)

One item per tag per site. Write when a site’s tags change.

| PK          | SK        | Attributes   |
|-------------|-----------|--------------|
| SITE#\<id\> | TAG#\<tag\> | **tag**=\<tag\>, **siteId**=SITE#\<id\> |

- **Sites by tag:** Query GSI **byTag** with `tag=\<tagValue\>`.

### 3. User rating (stars + note)

One item per user per site. Logged-in users write their own.

| PK        | SK           | Attributes |
|-----------|--------------|------------|
| USER#\<id\> | SITE#\<siteId\> | stars (1–5), note, updatedAt, **starRating** (same as stars), **siteId**=SITE#\<siteId\> |

- **My rating for a site:** `GetItem(PK=USER#\<userId\>, SK=SITE#\<siteId\>)`.
- **My ratings:** Query `PK=USER#\<userId\>` (all my SITE#... items).
- **All 5-star ratings:** Query GSI **byStars** with `starRating=5`.

### 4. Comment (per user per site)

| PK        | SK                  | Attributes   |
|-----------|---------------------|--------------|
| USER#\<id\> | SITE#\<siteId\>#COMMENT#\<commentId\> | body, createdAt, updatedAt |

- **Comments for a site:** Query `PK=SITE#\<siteId\>`, `SK begins_with COMMENT#` — *or* store under site with SK=COMMENT#\<id\> and use a GSI if needed.  
  Simpler: store under user; to list “all comments for site X” use a GSI (e.g. **bySite** with PK=siteId, SK=COMMENT#\<id\>) or scan (avoid at scale).  
  For v1, “comments for site” can be implemented later with a GSI or secondary item type under the site.

## Summary

- **PK/SK:** Generic (USER#..., SITE#..., TAG#...).
- **GSIs:** byEntity (list sites), byTag (sites by tag), byStars (ratings by 1–5).
- **Roles:** Admins create/update sites; any logged-in user creates/updates their own ratings and comments.
