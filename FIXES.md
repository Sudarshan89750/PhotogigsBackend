# PhotoGigs Backend — What Was Fixed (v1.0 → v1.1)

## CRITICAL fixes

### Fix 1 — Redis-backed rate limiter (`express.loader.ts`)
**Problem:** `express-rate-limit` default uses in-memory counters. With 2+ Node pods, each pod has its own counter — an attacker can bypass limits by splitting requests across instances.  
**Fix:** Switched to `rate-limit-redis` with `RedisStore`. All pods share one counter in Upstash.

### Fix 2 — Socket.io Redis adapter (`socket.loader.ts`)
**Problem:** Socket.io rooms are in-process. User on pod A never receives messages emitted to a room on pod B — chat breaks the moment you run 2 instances.  
**Fix:** Added `@socket.io/redis-adapter`. All pods share one pub/sub channel through Redis.

### Fix 3 — Missing PostgreSQL indexes (`schema.sql`)
**Problem:** No geo index on `(latitude, longitude)`. No index on reviews for aggregate rating. At 1M users, location queries full-scan the users table.  
**Fix:** Added `idx_users_location` partial index on `(latitude, longitude) WHERE status = 'approved'`, `idx_reviews_reviewee` for rating lookups, GIN index on `skills` array, full-text GIN index for name/city search.

### Fix 4 — N+1 unread count queries in `getConversations` (`chat.service.ts`)
**Problem:** 20 conversations = 21 DB round trips (1 find + 20 countDocuments). At scale this is a death spiral.  
**Fix:** Replaced with a single MongoDB `$aggregate` pipeline using `$lookup` + `$count` to fetch all unread counts in one query.

### Fix 5 — Following feed blows up memory for power users (`feed.service.ts`)
**Problem:** `followModel.find({ followerId })` with no limit — a user following 10K people loads 10K docs into Node memory, then sends a 10K-element `$in` to MongoDB.  
**Fix:** Added `.limit(500)` cap. Long-term fix is write-time fanout to a `user_feed` collection.

### Fix 6 — Campaign view tracking: serial Redis round-trips in hot path (`feed.service.ts`)
**Problem:** 3 Redis calls per campaign (GET, INCR, EXPIRE) in a loop, in the feed request critical path.  
**Fix:** Batch reads with one `pipeline().get()` per campaign, then a single write pipeline for all eligible increments.

### Fix 7 — FCM push was a stub (`notification.service.ts`)
**Problem:** `sendPush()` was a logger.debug no-op. Users never received push notifications.  
**Fix:** Integrated Firebase Admin SDK. Reads FCM tokens from `fcm_tokens` table. Uses `sendEachForMulticast`. Automatically removes stale/invalid tokens from the DB.

## IMPORTANT fixes

### Fix 8 — Upload size limits (`upload.middleware.ts`)
**Problem:** 20MB max for all files buffered in Node's heap. 100 concurrent video uploads = 2GB heap.  
**Fix:** Separated `upload` (10MB, images/PDFs) from `uploadVideo` (100MB). Documented that large files should use Cloudinary signed upload on the frontend.

### Fix 9 — Postgres pool size (`postgres.loader.ts`)
**Problem:** `max: 20` per pod × N pods can exhaust Neon's connection limit. No query timeout.  
**Fix:** Reduced to `max: 10`. Added `statement_timeout: 30000`. Deployment guide explains adding pgBouncer when scaling to multiple pods.

### Fix 10 — Refresh tokens stored Redis-only (`schema.sql`)
**Problem:** If Redis goes down, all users are silently logged out. The `refresh_tokens` table existed in the schema but was never used.  
**Fix:** Added proper indexes to `refresh_tokens` table, added expiry index for nightly cleanup. Note: `AuthService` still uses Redis as primary fast path — the table is available as fallback and audit log when needed.

### Fix 11 — No correlation IDs (`express.loader.ts`, `error.middleware.ts`, `express.d.ts`)
**Problem:** No request ID meant zero traceability — impossible to correlate logs to a specific request.  
**Fix:** `app.use` middleware attaches `crypto.randomUUID()` to `req.requestId` on every request. `errorHandler` includes `requestId` in all error responses.

### Fix 12 — Concurrent signup race condition (`auth.service.ts`)
**Problem:** `ON CONFLICT DO NOTHING` silently swallowed duplicate inserts. Two concurrent signups for the same email: first user gets OTP, second gets no error and no OTP.  
**Fix:** Changed to `ON CONFLICT DO NOTHING RETURNING id`. If returned row is null, throw `ConflictError` explicitly.

### Fix 13 — Shallow health check (`express.loader.ts`)
**Problem:** `/health` returned static `{ status: 'ok' }` even if Postgres/Redis were down. Load balancers would keep sending traffic to a broken pod.  
**Fix:** `/health` now runs `SELECT 1` against Postgres and `PING` against Redis. Returns `503` with `status: 'degraded'` and per-component check results if either is unhealthy.

## MINOR fixes

### Pagination limit cap
Reduced from 100 to 50 items per page to reduce accidental heavy reads.

### `trust proxy` setting
Added `app.set('trust proxy', 1)` so rate limiting uses real client IP behind Railway's reverse proxy instead of the proxy's IP (which would rate-limit all users together).
