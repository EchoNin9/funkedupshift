# DynamoDB single-table design

Table name: `fus-main` (or value of `var.dynamoTableName`).  
Partition key: **PK** (String). Sort key: **SK** (String).  
Billing: **PAY_PER_REQUEST**.

## GSIs

| GSI name   | Partition key | Sort key  | Use case                          |
|-----------|----------------|-----------|-----------------------------------|
| **byEntity** | entityType (S) | entitySk (S) | List all sites: `entityType=SITE`; list groups: `entityType=GROUP` |
| **byTag**    | tag (S)        | siteId (S)   | Sites by tag: `tag=javascript`    |
| **byStars**  | starRating (N) | siteId (S)   | Ratings by value: `starRating=5`  |
| **byGroup**  | groupName (S)  | userId (S)   | List users in custom group        |
| **bySquashDate** | squashDate (S) | matchId (S) | Squash matches by date (YYYY-MM-DD) |

## Item types and access patterns

### 1. Site (catalog entry)

One item per site. Only admins create/update; everyone can read.

| PK          | SK       | Attributes (examples) |
|-------------|----------|------------------------|
| SITE#\<id\> | METADATA | url, title, description, scrapedContent, tags (list), createdAt, updatedAt, **entityType**=SITE, **entitySk**=SITE#\<id\> |

- **Get site:** `GetItem(PK=SITE#\<id\>, SK=METADATA)`.
- **List all sites:** Query GSI **byEntity** with `entityType=SITE`, sort by `entitySk` (or add createdAt to entitySk for ordering).

### 2. Site–tag (for query by tag)

One item per tag per site. Write when a site's tags change.

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
  Simpler: store under user; to list "all comments for site X" use a GSI (e.g. **bySite** with PK=siteId, SK=COMMENT#\<id\>) or scan (avoid at scale).  
  For v1, "comments for site" can be implemented later with a GSI or secondary item type under the site.

### 5. Custom RBAC group (DynamoDB)

| PK             | SK         | Attributes                                                                 |
|----------------|------------|----------------------------------------------------------------------------|
| GROUP#\<name\> | METADATA   | name, description, permissions (list), createdAt, updatedAt, **entityType**=GROUP, **entitySk**=GROUP#\<name\> |

- **List all groups:** Query GSI **byEntity** with `entityType=GROUP`.
- **Get group:** `GetItem(PK=GROUP#\<name\>, SK=METADATA)`.

### 6. User membership in custom group

| PK                  | SK                       | Attributes                                      |
|---------------------|--------------------------|-------------------------------------------------|
| USER#\<cognitoSub\> | MEMBERSHIP#\<groupName\> | groupName, userId (cognito sub), addedAt, addedBy |

- **User's custom groups:** Query `PK=USER#\<sub\>` where `SK begins_with MEMBERSHIP#`.
- **Group members:** Query GSI **byGroup** with `groupName=\<name\>`.

### 7. User profile (avatar, description, last login)

| PK                  | SK       | Attributes                                            |
|---------------------|----------|-------------------------------------------------------|
| USER#\<cognitoSub\> | PROFILE  | avatarKey (S3 key), description, updatedAt, lastLoginAt, lastLoginIp |

- **Get profile:** `GetItem(PK=USER#\<sub\>, SK=PROFILE)`.
- Avatar stored in s3-media at `profile/avatars/{userId}/{uuid}.{ext}`.

### 8. Squash player

| PK                  | SK       | Attributes                                                                 |
|---------------------|----------|-----------------------------------------------------------------------------|
| SQUASH#PLAYER#\<uuid\> | METADATA | name, email (optional), userId (optional Cognito sub for linking), entityType=SQUASH_PLAYER, entitySk=SQUASH#PLAYER#\<id\>, createdAt, updatedAt |

- **List players:** Query GSI **byEntity** with `entityType=SQUASH_PLAYER`.
- **Get player:** `GetItem(PK=SQUASH#PLAYER#\<id\>, SK=METADATA)`.

### 9. Squash match

| PK                 | SK       | Attributes                                                                                                                                 |
|--------------------|----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| SQUASH#MATCH#\<uuid\> | METADATA | date (YYYY-MM-DD), squashDate, matchId, teamAPlayer1Id, teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id, winningTeam (A\|B), teamAGames (0-3), teamBGames (0-3), entityType=SQUASH_MATCH, entitySk, createdAt, updatedAt |

- **Constraint:** Winning team always has 3 games; losing team has 0, 1, or 2. No player in both teams.
- **List by date:** Query GSI **bySquashDate** with `squashDate=YYYY-MM-DD`.
- **List by date range:** Query GSI **bySquashDate** with `squashDate BETWEEN dateFrom AND dateTo`.

### 10. Squash match participation (for player search)

| PK                  | SK            | Attributes   |
|---------------------|---------------|--------------|
| SQUASH#PLAYER#\<playerId\> | MATCH#\<matchId\> | matchId, squashDate |

- **Matches for a player:** Query `PK=SQUASH#PLAYER#\<playerId\>` where `SK begins_with MATCH#`.

## Summary

- **PK/SK:** Generic (USER#..., SITE#..., TAG#..., GROUP#..., SQUASH#PLAYER#..., SQUASH#MATCH#...).
- **GSIs:** byEntity (list sites/groups/squash players/matches), byTag (sites by tag), byStars (ratings by 1–5), byGroup (users in custom group), bySquashDate (squash matches by date).
- **Roles:** Admins create/update sites; any logged-in user creates/updates their own ratings and comments.
- **Squash section:** Visible only to users in the Squash custom group or SuperAdmin. SuperAdmin and managers (when in Squash group) can add/edit/delete players and matches.
