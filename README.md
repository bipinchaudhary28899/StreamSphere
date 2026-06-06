# StreamSphere — Video Streaming Platform

A full-stack, YouTube-style video platform built with Angular 19 and Node.js/Express. StreamSphere supports Google OAuth login, direct-to-S3 video uploads, HLS adaptive streaming, a fully serverless AI enrichment pipeline (Whisper transcription + GPT-4o-mini vision + synthesis + HuggingFace categorization), comments, likes, watch history, a Netflix-style hero carousel, and a layered performance architecture that keeps the feed fast at scale.
---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Solution](#solution)
- [Features](#features)
- [High-Level Design (HLD)](#high-level-design-hld)
- [Low-Level Design (LLD)](#low-level-design-lld)
- [Performance Architecture](#performance-architecture)
- [Architecture Tradeoffs](#architecture-tradeoffs)
- [Resilience & Fallbacks](#resilience--fallbacks)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Environment Variables](#environment-variables)
- [Quick Start](#quick-start)
- [Problems Faced While Building](#problems-faced-while-building)

---

## Problem Statement

Building a video platform that behaves like YouTube at small-team scale exposes a set of hard, interlocking problems:

**Delivery.** Serving a single raw MP4 to every viewer wastes bandwidth for users on slow links and rebuffers on poor connections. Videos need to adapt to each viewer's network in real time.

**Cost and server load.** Routing gigabyte-scale uploads through an API server buffers huge files in memory, blows past serverless timeouts, and is expensive. Reading the feed and popular videos from the database on every request adds latency and load that grows with traffic.

**Discovery and metadata.** Videos arrive with sparse, inconsistent metadata. Manual categorization does not scale, and a feed without reliable categories, search, and rich summaries is hard to browse.

**Feed correctness at scale.** Naive page-number pagination produces duplicate or skipped videos when new uploads shift page boundaries, and gets slower the deeper a user scrolls.

**Resilience.** A platform that stitches together MongoDB, Redis, S3, CloudFront, Lambda, and multiple third-party AI APIs has many failure points. Any one of them going down should degrade the experience gracefully — not take the whole app offline.

**Security.** Passwords, large request bodies, unbounded request rates, and publicly callable internal endpoints are all attack surface that must be closed without adding friction for legitimate users.

---

## Solution

StreamSphere addresses each of these with a deliberate architectural choice:

- **HLS adaptive streaming** — every upload is transcoded by AWS Lambda into 360p/720p HLS renditions; HLS.js picks quality per viewer based on live network conditions.
- **Direct-to-S3 uploads** — the browser uploads straight to S3 via a presigned URL, so the API server never touches video bytes and stays stateless and fast.
- **Event-driven, serverless processing** — an S3 `ObjectCreated` event triggers Lambda transcoding and a multi-stage AI pipeline; the backend just stores results delivered via webhook.
- **AI enrichment** — Whisper transcription + GPT-4o-mini vision and synthesis produce a rich `aiSummary`; HuggingFace `bart-large-mnli` zero-shot classification assigns one of 44 categories with no training data.
- **Cursor-based pagination + infinite scroll** — `O(1)` deep-scroll queries that are stable under concurrent inserts.
- **Redis caching with graceful degradation** — frequently read data is cached with tuned TTLs; a Redis outage silently falls through to MongoDB.
- **CloudFront CDN** — all video files served from edge locations close to viewers.
- **Layered resilience** — every subsystem has a defined fallback so a single failure degrades rather than crashes.
- **Defense-in-depth security** — Google OAuth (no passwords), JWT, tiered rate limiting, CORS whitelist, body-size limits, Zod validation, and S3 key sanitisation.

---

## Features

### 1. Google Login
One-click authentication via Google OAuth — no passwords stored. The frontend sends the Google credential token to `POST /api/google-login`; the backend verifies it with Google's `OAuth2Client`, upserts the user in MongoDB (creating new accounts on first login, syncing the profile image on every login), and returns a signed JWT plus the user object. The token and user are stored in `localStorage` and attached to every subsequent API call.

### 2. Video Upload with HLS Transcoding
Videos upload directly from the browser to S3 via a presigned `PUT` URL, keeping the backend out of the data path. The flow: request a presigned URL (`POST /api/upload-url`) → browser uploads to S3 with progress tracking → save metadata (`POST /api/save-video`, `status: 'processing'`) → S3 `ObjectCreated` triggers the Lambda transcoder → Lambda produces 360p/720p HLS, an 8-second MP4 preview, and a JPEG thumbnail → Lambda calls `POST /api/internal/hls-complete` (shared-secret authenticated) → backend flips `status → 'ready'`, stores `hlsUrl`/`previewUrl`/`thumbnailUrl`, busts the cache. During processing, the uploader sees a persistent "processing" banner and a toast when the video is ready; processing videos are hidden from other users. Client-side validation checks the file is `video/*` and under 3 minutes (the backend enforces the same limit).

### 3. AI Pipeline — Transcription, Visual Analysis & Auto-Categorization
After transcoding, Lambda runs a multi-stage AI pipeline; the backend contains zero AI logic and only stores the results.

- **Phase 1 — FFmpeg:** HLS renditions, 8-second preview, JPEG thumbnail, and a 90-second mono MP3 audio clip produced in parallel.
- **Phase 2 — Deterministic metadata:** audio detection via `ffmpeg -i` stderr parsing (no ffprobe needed). If `"Audio:"` appears, transcription is added; visual description always runs.
- **Phase 3 — Parallel AI:** *Whisper* transcribes the MP3 (transcripts under 20 words discarded as music/silence); *GPT-4o-mini vision* describes up to 5 scene-change keyframes (`select=gt(scene,0.3)`, falling back to fixed timestamps). Both run under `Promise.allSettled` so one failure does not block the other.
- **Phase 4 — Synthesis:** GPT-4o-mini merges title, uploader description, transcript, and visual summary into a single rich `aiSummary` paragraph.
- **Phase 5 — Categorization:** `facebook/bart-large-mnli` zero-shot classification scores the `aiSummary` against 44 candidate categories using the hypothesis template `"This video belongs to the {} genre or category."`; high-priority genres (Music, Gaming) are anchored at the top. Retries up to 3× on HTTP 429/503.

The 44 supported categories: Music, Gaming, Sports, Movies, Comedy, Web Series, Learning, Podcasts, News, Fitness, Vlogs, Travel, Tech, Food & Recipes, Motivation, Short Films, Art & Design, Fashion, Kids, History, DIY, Documentaries, Spirituality, Real Estate, Automotive, Science, Nature, Animals, Health & Wellness, Business & Finance, Personal Development, Unboxing & Reviews, Live Streams, Events & Conferences, Memes & Challenges, Festivals, Interviews, Trailers & Teasers, Animation, Magic & Illusions, Comedy Skits, Parodies, Reaction Videos, ASMR. Every AI phase is independently wrapped — the video always becomes `ready`, falling back to `category: 'General'` and `aiSummary: null` if everything fails. The Lambda bundle ships only `axios` and `fluent-ffmpeg` as production deps (final zip ~2.7 MB).

### 4. Video Feed with Search & Filters
A single component drives category filtering (applied server-side), keyword search (debounced 350ms, backed by a MongoDB full-text index on `title` and `description`), and infinite scroll (cursor-based pagination, 10 videos per page). An `IntersectionObserver` watching a sentinel element prefetches the next page 800px before the user reaches the end.

### 5. Video Player with Adaptive Quality
HLS.js loads `master.m3u8` and auto-selects quality via ABR; a floating overlay offers manual selection (Auto / 360p / 720p) and shows the level actually playing (e.g. "Auto (720p)"). The player supports like/dislike, owner-only delete, a per-load view increment, a collapsible description, and a collapsible **AI Summary** section (styled with a purple-blue gradient border and ✨ badge). If a video is still processing, the player shows a transcoding message instead of a broken player.

### 6. Like / Dislike
Reactions are mutually exclusive with toggle behaviour (clicking the active reaction removes it; clicking the opposite switches it). `isLiking`/`isDisliking` flags prevent double-clicks. Each video stores `likes`/`dislikes` counts and `likedBy`/`dislikedBy` arrays, enforcing one reaction per user at the database level and returning the user's current reaction on page load.

### 7. Comments and Threaded Replies
A comment section below the player supports two-level threading (top-level comments and replies via a `parent_id` field), create/edit/delete (edit and delete restricted to the author), and real-time UI updates with no page refresh. Endpoints: `POST /api/videos/:videoId/comments`, `GET /api/videos/:videoId/comments`, `DELETE /api/comments/:commentId`. The feed-card comment count is fetched separately so it does not inflate the main video payload.

### 8. Watch History
Opening the player calls `POST /api/history/:videoId`; the backend upserts a `{ userId, videoId, watchedAt }` record (re-watching updates the timestamp rather than duplicating). The profile History tab lists recent videos reverse-chronologically. All history endpoints require JWT auth and are scoped to the requesting user.

### 9. Hero Carousel
A full-width Netflix-style carousel autoplays the top-liked videos as muted 8-second MP4 preview clips. A "Watch with Sound" button opts into audio (then becomes a mute/unmute toggle). `IntersectionObserver` pauses playback when scrolled out of view; the tab visibility API pauses it when the tab is hidden. Previous/Next arrows and an 8-second auto-advance (reset on manual navigation) handle navigation. Content comes from `GET /api/videos/top-liked`.

### 10. User Profile & Video Management
Sidebar tabs for My Videos (including still-processing uploads with a processing badge), Watch History, Liked Videos, and Disliked Videos (the latter two from dedicated endpoints filtered by user ID). The profile image comes from Google with an avatar fallback that hides a broken image element.

### 11. Video Deletion
Deletable from the player, the profile table, and the card flip view. Deletion removes the MongoDB document (including reaction data), the raw MP4 from S3 (`Videos/raw/<uuid>/`), and all HLS files (`Videos/hls/<uuid>/` — playlists, `.ts` chunks, `preview.mp4`, `thumbnail.jpg`). The backend verifies the requester owns the video before deleting anything; the frontend hides the button for non-owners but the backend enforces it regardless.

---

## High-Level Design (HLD)

```
Browser (Angular SPA)
        │  HTTPS
        ▼
  Express API  ──── MongoDB Atlas (users, videos, comments, history)
        │
        ├────────── Redis / Upstash (cache + counters)
        │
        ├────────── AWS S3 (video files, presigned PUT)
        │
        ├────────── AWS CloudFront (CDN — playback URLs)
        │
        ├────────── AWS CloudWatch (CloudFront metrics for dev dashboard)
        │
        └────────── HuggingFace BART-MNLI (AI category detection)

Upload → S3 (raw MP4)
            │  S3 ObjectCreated event
            ▼
    AWS Lambda (FFmpeg + AI pipeline)
            │
            ├─► S3: HLS (master.m3u8, 360p/720p .m3u8, *.ts), preview.mp4, thumbnail.jpg
            └─► Webhook POST /api/internal/hls-complete (x-hls-secret)
                    │
                    ▼
            Backend → MongoDB (hlsUrl, previewUrl, thumbnailUrl, category, aiSummary, status: ready)
                    │
                    ▼
            CloudFront serves all HLS, preview, and thumbnail files
```

Both the Angular SPA and the Express API are deployed on Vercel — the backend as a serverless function via `vercel.json`. MongoDB Atlas handles persistence; Redis (Upstash) handles caching and lightweight analytics counters; AWS S3 (ap-south-1) + CloudFront store and deliver video. The IAM user has minimal permissions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `cloudwatch:GetMetricStatistics`.

### Key Design Patterns

**Direct-to-S3 upload** — the backend issues a presigned URL and only handles metadata; it never buffers video binaries, keeping the serverless function fast and within memory/timeout limits.

**Event-driven transcoding** — Lambda is triggered by an S3 `ObjectCreated` event (no polling, no queue), so the pipeline is fully serverless and auto-scaling.

**Webhook with shared secret** — Lambda calls back via `POST /api/internal/hls-complete` protected by an `x-hls-secret` header, avoiding VPC networking while keeping the internal endpoint non-public.

**Stateless API** — every request carries its JWT; there is no server-side session store, so any API instance can serve any request and horizontal scaling is trivial.

---

## Low-Level Design (LLD)

### Authentication — Google OAuth + JWT
The frontend receives a Google ID token, posts it to `POST /api/google-login`; the backend verifies it with `google-auth-library` against `GOOGLE_CLIENT_ID`, upserts the user, and issues an HS256 JWT containing `userId`, `email`, `name`, `profileImage`, signed with `JWT_SECRET`. An Angular HTTP interceptor attaches `Authorization: Bearer <token>` to every request except `amazonaws.com` URLs, and clears `localStorage` + redirects to `/home` on any 401. There is no password, email verification, or refresh token — session lifetime equals JWT lifetime.

### Cursor-Based Pagination
Each feed response returns 10 videos, a `nextCursor` (the `_id` of the last video), and a `hasMore` flag. The next query is `{ _id: { $lt: cursor } }` with `sort({ _id: -1 })`. Because ObjectIDs embed a timestamp this is newest-first without a separate `createdAt` index, it is `O(PAGE_SIZE)` regardless of depth, and it is stable under concurrent inserts. The cost: no random page access (correct for an infinite-scroll feed).

### MongoDB Document Design
Users, videos, comments, and watch history are separate collections. Videos embed `likedBy`/`dislikedBy` as string-ID arrays so reaction lookups are a single document read. Profile images live on the User document, not on each Video — a feed query does one batch lookup to populate `user_profile_image` across the page via a Map, avoiding N+1 queries. The Comment model carries `videoId`, `userId`, `userName`, `userProfileImage`, `text`, `parent_id`, `createdAt`.

### Direct-to-S3 Upload Flow
1. `POST /api/upload-url` returns a presigned `PUT` URL (valid 1 hour) with a UUID-prefixed key (`Videos/<uuid>/<sanitised-filename>`).
2. The browser PUTs the binary directly to S3 (the interceptor skips JWT injection for S3 URLs).
3. `POST /api/save-video` stores metadata; transcoding and AI run later in Lambda.

The UUID prefix (122 bits) makes identical-filename uploads collision-proof and neutralises path-traversal filenames.

### View Counting with Deduplication
On watch, the client sends `POST /api/videos/:id/view` with its JWT (logged-in) or a stable `localStorage` UUID via the `X-Anon-Session` header (anonymous). The backend builds a Redis key `ss:view:<videoId>:<userId-or-anonId>` with a 24-hour TTL; if it exists, the view is not recounted; otherwise it is written and `views` is atomically `$inc`-ed, then the single-video cache is invalidated.

### Reactions — Like / Dislike Toggle
Toggle logic lives entirely in the backend service: liking a video already liked removes the like; liking a disliked video removes the dislike and adds the like in a single save. After any change, the single-video and top-liked caches are invalidated.

### Redis Cache Key Scheme
Keys follow `ss:<type>:<params>` from a central factory object (`CK`) to prevent typos. Cache invalidation is targeted — a like deletes only the affected video cache and top-liked cache; a delete uses a SCAN-based `delPattern` to remove the category and all-feed pages without blocking the Redis event loop.

### Admin / Dev Dashboard
`GET /api/admin/stats` is restricted to the owner email on both the route guard and the API handler. It aggregates CloudFront request count + data transfer (CloudWatch), S3 storage size + object count (`ListObjectsV2`), monthly upload count and API request counts (Redis counters), and total video/user/comment counts — all assembled with `Promise.allSettled` so one AWS failure does not crash the response.

### Session and State Management
The JWT lives in `localStorage` under `token`; user metadata under `user`. `localStorage` (over cookies) means the token survives refresh and spans tabs — the accepted trade-off is XSS exposure, tolerable given no payment data or sensitive PII. An `AuthService` `BehaviorSubject<boolean>` tracks login state reactively, initialised from `localStorage` in the constructor and updated via a `setTimeout`-deferred `next()` to avoid `ExpressionChangedAfterItHasBeenCheckedError`. Anonymous viewers get a `crypto.randomUUID()` stored under `ss_session_id`. A guarded route's intended URL is saved to `sessionStorage` under `redirectUrl` for post-login redirect.

### Frontend UX Details
CSS flip cards (front = player + metadata, back = description + delete) with `stopPropagation` to avoid triggering navigation; a `triggerFeedRefresh()`/`feedRefresh$` Subject so a new upload appears without a manual refresh; `formatViews()` (1500 → "1.5K", 1000000 → "1M"); a `ThemeService` dark/light toggle persisted across refreshes; a horizontal category slider driven by a `category$` `BehaviorSubject`.

---

## Performance Architecture

**HLS Adaptive Streaming** — each upload is transcoded into 360p (800kbps) and 720p (2800kbps) HLS renditions; HLS.js picks quality from real-time network conditions. Playback starts after only the first 2–3 segments (~12s) download, not the whole file.

**Preview MP4 for carousel and hover** — using HLS.js in the carousel caused 500+ CloudFront requests on the home page (HLS.js buffers 30s ahead, fetching all 16 segments per video). The fix: Lambda generates an 8-second 480p MP4 preview (`+faststart`) used by the carousel (`<video [src]="previewUrl">`, ~60–80KB on `preload="metadata"`) and by card hover previews. HLS.js is used only in the actual player where adaptive switching matters.

**Cursor-based infinite scroll** — see [LLD](#cursor-based-pagination). An `IntersectionObserver` with an 800px `rootMargin` prefetches the next page ~2–3 rows early for seamless scrolling.

**Redis caching** — feed pages, individual videos, and top-liked videos are cached with tuned TTLs (see [Tradeoffs](#architecture-tradeoffs)); cache is busted on the relevant write so new content appears immediately.

**Stale-while-revalidate feed refresh** — the skeleton shows only on a cold first load (`displayedVideos` empty); subsequent refreshes keep existing videos visible and clickable while new data loads silently.

**Lazy loading** — Angular's router lazy-loads every route via `loadComponent`, so the first-visit bundle contains only home-page code.

**Thumbnail + hover preview loading** — Lambda extracts a 854×480 JPEG thumbnail at the 1s mark, shown as a static cover immediately (zero video requests on load). The preview video source is injected only after a 2-second hover, then removed on leave.

**Debounced search** — RxJS `debounceTime(350)` + `distinctUntilChanged()` fire the API only after the user pauses; results use a MongoDB full-text index for relevance ranking.

**CloudFront CDN** — all video files served from edge locations, lowering start latency and S3 egress cost, with automatic HTTPS and high edge cache hit rates on immutable HLS segments.

### Reducing TTFB (Time To First Byte)

The home page fires `feed`, `top-liked`, and `mine` concurrently on load. On Vercel's serverless runtime the dominant cost was **per-invocation connection setup on cold containers** (Mongo Atlas TLS handshake + Redis connect), surfacing as ~3.5–4s `Waiting for server response` while content download stayed ~7ms — i.e. the slowness was never payload size. The following changes target that first-byte latency:

**Edge caching on public reads** — `feed`, `feed/search`, `top-liked`, and single-video endpoints set `Cache-Control: s-maxage=60, stale-while-revalidate=300`, so Vercel's edge serves repeat requests in well under 100ms without ever invoking Node/Mongo. A global default of `Cache-Control: private, no-store` is applied to every response first, and only public read endpoints override it on their success path — so nothing user-specific (mine, liked/disliked, reactions, history, admin) can ever land in the shared edge cache.

**Reused MongoDB connection** — the connection is cached as a shared *promise* (not a boolean), so concurrent cold-start requests reuse a single `mongoose.connect()` instead of racing, and a failed connect resets cleanly for the next retry. The connection guard is registered **before** the API routes so it actually runs for `/api` traffic (previously it was mounted after the routes and never executed, leaving queries to rely on Mongoose command buffering).

**Non-blocking cache writes** — cache-population `redis.set(...)` calls on read paths are fire-and-forget, so a slow-but-connected Redis can never add latency before the response is sent. Cache *reads* already fail open (return `null` if Redis isn't `ready`) and fall through to MongoDB, so Redis only ever speeds requests up — it never blocks them.

**CloudFront + Redis layers** (above) — keep the steady-state, warm-path TTFB low even when the edge cache misses.

### Reducing TBT (Total Blocking Time)

TBT is driven by main-thread work and request contention during load. With ~46 of 71 requests firing on the home page, the browser's 6-connections-per-host limit queued API XHRs behind media (~2.4s `Queueing` observed). These measures keep the main thread and the request queue clear:

**Deferred media fetching** — card preview videos use `preload="none"` and only inject their `<source>` after a 1s hover delay; thumbnails render as static JPEG covers so the initial load issues zero card-video requests. The hero carousel uses `preload="metadata"` (~60–80KB) rather than full downloads.

**Immutable asset caching** — every processed asset (HLS segments/playlists, `preview.mp4`, `thumbnail.jpg`) is uploaded from the Lambda pipeline with `Cache-Control: public, max-age=31536000, immutable`. These objects are write-once and UUID-keyed, so the browser reuses them from disk cache instead of re-fetching. This fixed a bandwidth sink where the hero carousel, looping through its 3 slides, re-downloaded the same 500KB–1MB preview MP4s on every cycle (the network trace showed identical files fetched repeatedly as `206` range requests). The CloudFront `/Videos/hls/*` behavior uses **Managed-CachingOptimized**, which honors and forwards the origin `Cache-Control`, so the header reaches the viewer; previously, with no origin header, CloudFront edge-cached but emitted no viewer `Cache-Control`, leaving the browser to re-fetch.

**Route-level code splitting** — Angular lazy-loads every route via `loadComponent`, so the first-visit bundle ships only home-page code, reducing parse/compile/execute time on the main thread.

**Debounced search** — `debounceTime(350)` + `distinctUntilChanged()` prevent a burst of keystroke-triggered work and network calls.

**Stale-while-revalidate UI** — refreshes keep existing cards interactive while new data loads silently, avoiding layout-thrash skeletons after the first cold load.

### Measured Impact

TTFB numbers below are measured from Chrome DevTools (Network → Timing) before and after the edge-cache + connection-reuse changes, on the same home-page load (`feed`, `top-liked`, `mine` firing concurrently):

| Endpoint | TTFB before | TTFB after | TTFB reduction | End-to-end before | End-to-end after | E2E reduction |
|---|---|---|---|---|---|---|
| `feed` | 3.44 s | 68 ms | **−98.0%** (≈51× faster) | 5.86 s | 68 ms | **−98.8%** |
| `top-liked` | 3.91 s | 61 ms | **−98.4%** (≈64× faster) | 6.33 s | 61 ms | **−99.0%** |
| `mine` | ~3.45 s | 71 ms | **≈−97.9%** | — | 71 ms | — |

*"TTFB" = DevTools "Waiting for server response"; "End-to-end" = `Queued`→finish (includes ~2.4s of browser request-queueing that disappears once the API calls aren't stuck behind media). Content download was ~7ms throughout — confirming the bottleneck was never payload size.*

**Immutable asset caching (projected — pending Lambda redeploy + CloudFront invalidation of existing objects):** the home page transferred 36.9 MB across 127 requests, dominated by `preview.mp4` files re-fetched on every carousel loop (same files appearing 2×+ in the trace). With immutable caching, repeat fetches of an already-seen asset cost **0 network bytes** (served from disk cache), so steady-state carousel bandwidth drops from N×(previews-per-loop) to a single fetch per asset per session. Exact post-fix MB will be re-measured after the metadata backfill + invalidation land.

---

## Architecture Tradeoffs

| Layer | TTL | Gain | Cost |
|---|---|---|---|
| Feed pages (`ss:feed:all:*`, `ss:feed:cat:<category>:*`) | 2 min | Sub-1ms feed page vs 20–80ms MongoDB query | Cards show stale views/likes; busted on delete/like |
| Single video (`ss:video:<id>`) | 10 min | Fast player loads under concurrent viewers | Metadata stale; busted on like/dislike/view/delete |
| View dedup (`ss:view:<videoId>:<userId>`) | 24 hr | No inflation from refreshes/back-nav | Same-day re-watch doesn't count |
| Search (`ss:search:<term>:<category>`) | 1 min | No redundant regex scans on repeat queries | New videos missing from search for up to 60s |
| Top-liked / hero (`ss:top-liked`) | 5 min | Cheap hero carousel on every page load | Rankings lag up to 5 min; busted on like/dislike |
| Cursor pagination | — | `O(1)` deep-scroll queries, insert-stable | No random page access |
| 800px prefetch | — | Seamless scroll | Slightly more API calls; may lag on slow links |
| Redis fallback | — | 100% uptime during a Redis outage | MongoDB takes full load during the outage |

These staleness windows are intentional and match how large platforms (YouTube, Netflix) handle the same trade-offs — feed-card view counts always lag the real-time count on the player page, which busts its own cache on interaction.

---

## Resilience & Fallbacks

Every layer is designed so a single failure degrades gracefully rather than taking down the app.

| Component | What can fail | Fallback | App up? |
|---|---|---|---|
| Redis | Unreachable / `REDIS_URL` unset | Every cache method is a no-op → falls through to MongoDB | ✅ |
| MongoDB | Startup failure | `process.exit(1)` with a clear error (no DB = cannot operate) | ❌ Intentional |
| MongoDB | Mid-runtime disconnect | Mongoose auto-reconnects; in-flight requests get 500 until restored | ⚠️ Degraded |
| Lambda — Whisper | API error / no key | `transcript = null`; synthesis continues | ✅ |
| Lambda — Vision | API error / no frames | Scene detection falls back to fixed timestamps; else `visualSummary = null` | ✅ |
| Lambda — Synthesis | API error | Falls back to concatenating title + description + visual summary | ✅ |
| Lambda — HuggingFace | API error / no key | Retries 3× on 429/503, then `category = 'General'` | ✅ |
| Lambda — entire AI pipeline | All steps fail | Webhook still fires; video `ready` with `General` / `null` | ✅ |
| Lambda — webhook never fires | Lambda crash mid-run | Video stuck at `processing` (known gap) | ⚠️ |
| HLS player | No HLS.js support | Native HLS (Safari MSE) | ✅ |
| HLS player | Video processing | Shows processing state, not a broken player | ✅ |
| HLS player | Network/load error | Error state with retry button | ✅ |
| Rate limiter | Limit hit | Structured JSON `{ error }` with correct status | ✅ |
| JWT | Invalid / missing | `401 Unauthorized` | ✅ |
| View dedup | Redis down | Key unreadable → view may count more than once | ⚠️ Count inflated |
| CORS | Unknown origin | Rejected at middleware before any route | ✅ |

**Redis safety settings:** `connectTimeout: 4000ms`, `commandTimeout: 3000ms`, `maxRetriesPerRequest: 1`, exponential-backoff `retryStrategy` capped at 10s (abandons after 10 attempts). **Audio detection fails open** — if `spawnSync` errors it assumes audio is present rather than skipping Whisper. **Webhook auth** — a wrong/missing `x-hls-secret` returns 401 before touching the DB.

### Known Gaps (no fallback today)

| Gap | Risk | Suggested fix |
|---|---|---|
| Lambda webhook never fires | Video stuck at `processing` forever | Scheduled job: re-trigger or mark `failed` videos older than 15 min |
| JWT never expires | A stolen token is valid forever | Add `expiresIn: '7d'` + refresh tokens |
| Multi-instance rate limiting | Limits are per-process, not per-cluster | Replace `MemoryStore` with `rate-limit-redis` |
| S3 presigned URL expiry | Uploads over 1 hour get a 403 | Shorter TTL with progress-aware retry |

---

## Security

- **Google OAuth as sole identity provider** — eliminates password attacks (credential stuffing, brute force, rainbow tables); the ID token is verified server-side and audience-checked.
- **JWT (HS256)** — verified on every authenticated request by `authenticateJWT`, rejecting missing/tampered tokens with 401.
- **HTTP interceptor** — auto-injects the bearer token (except for S3 URLs) and force-logs-out on 401.
- **Route guard** — `AuthGuard` requires both a token and a valid `user` JSON with `userId`; malformed JSON is treated as unauthenticated; redirects use `replaceUrl: true`.
- **Tiered rate limiting** (`express-rate-limit`): auth 10/15min, upload 20/hour, writes 60/15min, global backstop 300/15min — all returning JSON errors.
- **CORS whitelist** — only origins in `CLIENT_URL` are accepted.
- **JSON body limit** — `express.json({ limit: '10kb' })` blocks oversized-body DoS.
- **Zod validation** — key endpoints validate request bodies before the controller, returning structured 400s.
- **Admin protection** — `GET /api/admin/stats` checks the email allowlist on both server and client.
- **S3 key sanitisation** — `path.basename()` + whitespace replacement + UUID prefix neutralise path traversal.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 19 (standalone components), Angular Material, RxJS, TypeScript |
| Backend | Node.js, Express, TypeScript, Mongoose, ioredis, @aws-sdk v3, jsonwebtoken, google-auth-library, express-rate-limit, Zod |
| Database | MongoDB Atlas |
| Cache / Analytics | Redis (Upstash, via ioredis) |
| Auth | Google OAuth + JWT |
| Storage / CDN | AWS S3 (ap-south-1) + CloudFront |
| HLS transcoding | AWS Lambda + FFmpeg |
| AI transcription | OpenAI Whisper |
| AI vision + synthesis | GPT-4o-mini |
| AI categorization | HuggingFace `facebook/bart-large-mnli` (zero-shot) |
| Tests | Karma + Jasmine |
| Deployment | Vercel (frontend + backend), AWS Lambda |

---

## Environment Variables

### Backend (`.env`)

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs JWT tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis URL (optional — caching disabled if absent) |
| `AWS_REGION` | AWS region (e.g. `ap-south-1`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `AWS_S3_BUCKET_NAME` | S3 bucket name |
| `CLOUDFRONT_URL` | CloudFront base URL (no trailing slash) |
| `HLS_WEBHOOK_SECRET` | Shared secret for the Lambda → backend webhook |
| `BACKEND_URL` | Public backend URL (used by Lambda to call the webhook) |
| `CLIENT_URL` | Comma-separated CORS origin allowlist |

### Lambda (AWS environment variables)

| Variable | Purpose |
|---|---|
| `AWS_S3_BUCKET_NAME` | Same bucket as the backend |
| `CLOUDFRONT_URL` | CloudFront base URL |
| `BACKEND_URL` | Public backend URL |
| `HLS_WEBHOOK_SECRET` | Must match the backend value |
| `OPENAI_API_KEY` | Whisper + GPT-4o-mini (vision + synthesis) |
| `HUGGING_FACE_API_KEY` | `bart-large-mnli` categorization |

---

## Quick Start

### Backend
```bash
cd stream-sphere-backend
npm install
cp .env.example .env   # fill in your values
npm run dev
```

### Frontend
```bash
cd stream-sphere-client
npm install
npm start            # or: ng serve  → http://localhost:4200/
```

### Lambda (HLS transcoder)
```bash
cd stream-sphere-lambda
# ffmpeg-static, ffprobe-static, and @aws-sdk/client-s3 are devDependencies
# (provided by the Lambda layer / runtime), so --omit=dev keeps the zip small
# (~2.7 MB unzipped vs 148 MB with dev deps).
rm -rf node_modules package-lock.json
npm install --omit=dev
zip -r function.zip handler.js node_modules
# Upload to AWS Lambda via console or CLI
```

> **Lambda layer required:** the FFmpeg binary must be at `/opt/bin/ffmpeg` (use a pre-built `linux/x86_64` layer or build your own).
> **Runtime:** Node.js 20.x (native `fetch`, `FormData`, `Blob`). Memory 2048 MB, timeout 12 min, ephemeral storage 2048 MB.

---

## Problems Faced While Building

**Carousel request explosion.** Using HLS.js for the hero carousel and grid hover previews fired 500+ CloudFront requests on the home page, because HLS.js buffers ~30 seconds ahead and fetched every segment of every visible video before the user had seen 8 seconds of any of them. Solved by generating a dedicated 8-second MP4 preview clip in Lambda and using a plain `<video>` element for previews, reserving HLS.js for the real player.

**Blank cards and eager video loads.** Rendering 12+ cards with eager `<video>` elements fired a network request per card on load (even below the fold) and showed an ugly black area before the preview loaded. Solved by extracting a static JPEG thumbnail in Lambda (shown immediately, zero video requests) and only injecting the preview source after a deliberate 2-second hover.

**Pagination correctness.** Page-number pagination produced duplicate/skipped videos whenever a new upload shifted page boundaries, and got slower the deeper users scrolled. Solved by switching to cursor (keyset) pagination keyed on `_id`, which is `O(PAGE_SIZE)` at any depth and insert-stable.

**Feed refresh blanking the grid.** Setting `isLoading = true` on every refresh blanked the entire grid and made existing videos unclickable. Solved with a stale-while-revalidate pattern: the skeleton shows only on a cold first load, and refreshes update the grid silently in the background.

**Serverless upload limits.** Routing gigabyte uploads through the Express function would buffer huge files in memory and blow past Vercel's serverless timeouts. Solved with the presigned-URL direct-to-S3 pattern, keeping the API stateless and bandwidth-free for uploads.

**Cold-start latency.** On Vercel each request may hit a fresh container, and a slow Redis connect would stall requests. Solved with `lazyConnect: true`, a 4-second connect timeout, and `maxRetriesPerRequest: 1` so Redis fails fast rather than hanging the request.

**Redis as an accidental hard dependency.** Early on, a Redis hiccup could throw and break requests. Solved by wrapping every Redis operation in try/catch that logs and returns `null`/no-op, making caching a pure performance layer — MongoDB is always the source of truth.

**View-count inflation.** Page refreshes and back-navigation inflated view counts. Solved with a 24-hour Redis dedup key per user (or per anonymous-browser UUID), accepting that a Redis outage may transiently over-count — a soft metric, not billing data.

**AI pipeline fragility.** A single failing AI call (Whisper, vision, synthesis, or categorization) could otherwise have blocked a video from ever becoming playable. Solved by wrapping each phase independently and using `Promise.allSettled` for the parallel steps, so the video always reaches `ready` with sensible fallbacks (`General` / `null`).

**Music-only and silent audio.** Whisper returns noisy or empty transcripts for music videos and near-silent clips. Solved by discarding transcripts under 20 words and detecting audio presence via `ffmpeg -i` stderr parsing (which fails open — assumes audio rather than skipping it).

**Vision keyframe selection.** Sampling fixed timestamps often captured black frames or transitions. Solved with FFmpeg scene-change detection (`select=gt(scene,0.3)`) to pick meaningful frames, falling back to fixed 1s/10s/30s timestamps if scene detection yields nothing.

**Categorization accuracy.** Plain label lists confused content-type genres (Music, Gaming) with topic labels (Motivation, History). Solved with the genre-framed hypothesis template `"This video belongs to the {} genre or category."` and anchoring high-priority genres at the top of the candidate list to exploit the model's small positional preference.

**Lambda bundle size.** Bundling FFmpeg and the AWS SDK ballooned the zip to ~148 MB. Solved by treating `ffmpeg-static`, `ffprobe-static`, and `@aws-sdk/client-s3` as dev-only (the Lambda layer/runtime provides them) and installing with `--omit=dev`, shrinking the final zip to ~2.7 MB.

**Angular change-detection error.** Updating the auth `BehaviorSubject` synchronously triggered `ExpressionChangedAfterItHasBeenCheckedError`. Solved by deferring `next()` inside a `setTimeout` to the next change-detection cycle.

**Broken Google avatars.** Expired or failing Google CDN image URLs rendered broken-image icons. Solved with an `onAvatarError()` handler that hides the image element (`display: none`).

**Path-traversal filenames.** A crafted filename like `../../etc/passwd` could otherwise poison S3 keys. Solved by sanitising with `path.basename()`, replacing whitespace, and prefixing every key with a UUID v4.
