# StreamSphere — System Design, Features & Architecture

---

## 1. Project Overview

StreamSphere is a full-stack video streaming platform inspired by YouTube. It lets users upload, browse, search, like, comment on, and watch videos. The project is built as a single-page Angular application backed by an Express/Node.js REST API, with MongoDB as the primary database, Redis for caching and analytics, and AWS S3 + CloudFront for video storage and delivery.

---

## 2. High-Level Architecture

```
Browser (Angular SPA)
        │
        │  HTTPS
        ▼
  Express API  ──── MongoDB Atlas (documents)
        │
        ├────────── Redis (cache + counters)
        │
        ├────────── AWS S3 (video files, presigned PUT)
        │
        ├────────── AWS CloudFront (CDN — video playback URLs)
        │
        ├────────── AWS CloudWatch (CloudFront metrics for dev dashboard)
        │
        └────────── HuggingFace BART-MNLI (AI category detection)
```

The backend is deployed on Vercel as a serverless Node.js function. The frontend is also hosted on Vercel. MongoDB Atlas handles persistence; Redis (Upstash) handles caching and lightweight analytics counters.

---

## 3. Tech Stack

**Frontend:** Angular 19 (standalone components), Angular Material, RxJS, TypeScript, Karma + Jasmine (unit tests), Vercel

**Backend:** Node.js, Express, TypeScript, Mongoose, ioredis, @aws-sdk v3, jsonwebtoken, google-auth-library, express-rate-limit, Zod (validation), Vercel

**Database:** MongoDB Atlas — stores users, videos, comments, watch history

**Cache / Analytics:** Redis (ioredis) — feed pages, search results, view dedup, API traffic counters, upload counters

**Storage / CDN:** AWS S3 (ap-south-1) + CloudFront — videos uploaded directly from the browser via presigned URLs, served via CloudFront CDN

**AI:** HuggingFace `facebook/bart-large-mnli` — zero-shot classification to auto-detect video category from title + description

---

## 4. Core Features

### 4.1 Authentication — Google OAuth + JWT

Users sign in exclusively via Google OAuth. The frontend receives a Google ID token from the Google Sign-In SDK, then sends it to `POST /api/google-login`. The backend verifies the token using `google-auth-library`, upserts the user in MongoDB (creating a new account on first login, or refreshing the profile image and name on subsequent logins), and issues a signed JWT containing `userId`, `email`, `name`, and `profileImage`. The JWT is stored in `localStorage` and attached to API requests by the Angular HTTP interceptor. There is no password, no email verification flow, and no refresh token — session lifetime equals JWT lifetime.

### 4.2 Video Feed with Cursor-Based Pagination

The home feed is powered by cursor-based pagination (also called keyset pagination). Each API response returns a page of 10 videos, a `nextCursor` value (the `_id` of the last video on the page), and a `hasMore` flag. The client passes the cursor back as a query parameter to fetch the next page. MongoDB uses `_id < cursor` with `sort({ _id: -1 })` — because MongoDB ObjectIDs embed a timestamp, this is equivalent to newest-first ordering without a separate `createdAt` index.

This approach was chosen over offset pagination for two reasons: it avoids the "skip N rows" performance problem that degrades on large collections, and it is stable under concurrent inserts — a new video appearing while the user scrolls does not shift earlier rows and produce duplicates or skipped items.

### 4.3 Category Filtering

Videos are tagged with one of 44 categories (Music, Gaming, Tech, Travel, etc.). The category is auto-detected using the HuggingFace BART-MNLI zero-shot classification model at upload time — the video title and description are passed as the input text and the 44 category labels are passed as candidates. No training data is required; the model scores each label and returns the highest-confidence match. An exponential backoff retry (up to 3 attempts, 1 s / 2 s delays) handles HuggingFace rate limits (HTTP 429) and model cold-start delays (HTTP 503). If the API is unavailable the video is categorised as "Other" without blocking the upload.

On the frontend, a horizontal category slider at the top of the feed lets users filter by category. Selecting a category re-fetches the feed from page one with the `category` query parameter. The active category is managed by a `BehaviorSubject` in `VideoService` so all components that care about it (feed list, search) stay in sync reactively.

### 4.4 Video Upload — Presigned S3 URL Flow

To avoid routing large video files through the API server, uploads go directly from the browser to S3 using a two-step presigned URL flow:

1. The client calls `POST /api/upload-url` with the filename and MIME type. The backend generates a presigned `PUT` URL (valid 1 hour) with a UUID-prefixed S3 key (`Videos/<uuid>/<sanitised-filename>`) to prevent key collisions and directory traversal. It returns the signed URL and the key.
2. The client PUTs the video binary directly to S3 using the signed URL. The Angular HTTP interceptor skips `amazonaws.com` URLs so no JWT is appended to S3 requests.
3. After the S3 upload completes, the client calls `POST /api/save-video` with the metadata (title, description, S3 key). The backend runs HuggingFace category detection, constructs the CloudFront URL, and saves the video document to MongoDB.

This design keeps API server bandwidth and memory consumption near zero regardless of file size.

### 4.5 View Counting with Deduplication

View counts are incremented at most once per user (or per anonymous browser) per video per 24 hours. When a logged-in user watches a video, the client sends `POST /api/videos/:id/view` with its JWT in the `Authorization` header. When an anonymous user watches, the client sends a stable UUID stored in `localStorage` (created on first visit) in the `X-Anon-Session` header. The backend builds a Redis key `ss:view:<videoId>:<userId-or-anonId>` with a 24-hour TTL. If the key already exists, the view is not counted again. If it does not exist, the key is written and `views` is atomically incremented on the Video document with `$inc`. The single-video Redis cache is then invalidated so the next fetch reflects the new count.

### 4.6 Reactions — Like / Dislike Toggle

Likes and dislikes are mutually exclusive. The Video document stores `likedBy[]` and `dislikedBy[]` arrays and scalar `likes` / `dislikes` counters. When a user likes a video they are already in `likedBy`, the like is removed (un-like). If they are in `dislikedBy`, the dislike is removed and the like is added in a single save. This toggle logic lives entirely in the backend service. After any reaction change, the single-video cache and the top-liked cache in Redis are invalidated.

### 4.7 Comments and Threaded Replies

The comment system supports two-level threading: top-level comments on a video, and replies to a comment (stored with a `parent_id` field on the Comment document). Comments can be created, edited, and deleted. Editing is restricted to the author. The comment count shown on the feed card is fetched separately via `GET /api/videos/:id/comments/count` so it does not inflate the main video payload.

### 4.8 Watch History

Every time a user opens the video player page, the client calls `POST /api/history/:videoId` with the `userId` in the body. The backend upserts a WatchHistory document keyed on `(userId, videoId)` and updates a `watchedAt` timestamp. The watch history page retrieves the user's full history sorted by most recent.

### 4.9 User Profile

Each user has a profile page showing their uploaded videos, liked videos, and disliked videos. The profile image comes from Google and is refreshed on every login. An avatar fallback chain in the UI hides the broken image element if the Google CDN URL fails to load.

### 4.10 Admin / Dev Dashboard

A dashboard component is accessible only to the owner's email address (`bkumar28899@gmail.com`), enforced on both the route guard (frontend) and the API handler (backend). It aggregates:

- CloudFront request count and data transfer (GB) for the current month, pulled from AWS CloudWatch
- S3 bucket storage size and object count (via `ListObjectsV2` pagination)
- Monthly upload count (Redis counter incremented by the upload controller)
- Monthly and daily API request counts (Redis counters incremented by `statsMiddleware` on every request)
- Total video, user, and comment counts from MongoDB

All of this is assembled with `Promise.allSettled` so a single AWS API failure does not crash the entire dashboard response.

---

## 5. System Design Decisions

### 5.1 Redis Caching Strategy

Redis is used as a read-through cache in front of MongoDB. Cache keys follow a consistent naming scheme (`ss:<type>:<params>`) defined in a central factory object (`CK`) to prevent typos. TTLs are tuned to the expected staleness tolerance of each endpoint:

- Home / category feed pages: 2 minutes — acceptable for a scrolling feed
- Search results: 1 minute — searches are frequent but results change slowly
- Top-liked videos (hero carousel): 5 minutes — changes only when likes accumulate
- Individual video documents: 10 minutes — metadata changes rarely

All Redis operations are wrapped in try/catch and errors are swallowed with a log line. If Redis is down or not configured (`REDIS_URL` absent), every method is a no-op and the API falls back to direct MongoDB queries transparently. This graceful degradation means Redis is a performance layer, not a dependency.

Cache invalidation is targeted: when a video is liked, only the affected video cache and top-liked cache are deleted. When a video is deleted, a SCAN-based `delPattern` removes all feed pages for that video's category and the all-feed namespace without blocking the Redis event loop.

### 5.2 MongoDB Document Design

Videos, users, comments, and watch history are separate collections. Videos embed `likedBy` and `dislikedBy` as arrays of string user IDs. This keeps reaction lookups to a single document read, acceptable at the current scale. Profile images are stored on the User document, not embedded in each Video — on any feed query, a single batch lookup populates `user_profile_image` across all videos in the page using a Map, avoiding N+1 queries.

### 5.3 Cursor vs Offset Pagination

Offset pagination (`LIMIT n OFFSET k`) requires MongoDB to scan and skip `k` documents on every page request. At scale this is expensive. Cursor pagination (`_id < lastSeenId`) uses the clustered ObjectID index and scales to millions of documents. It also prevents duplicate/missing items caused by concurrent inserts shifting row positions.

### 5.4 Direct-to-S3 Upload Architecture

Routing video uploads through the API would require the server to buffer potentially gigabyte-sized files in memory, consuming bandwidth and causing timeouts on serverless platforms like Vercel. The presigned URL pattern offloads all bytes to S3 directly from the browser, keeping the API server stateless and bandwidth-free for uploads. The UUID prefix on every S3 key (122 bits of randomness) makes simultaneous uploads with identical filenames collision-proof.

### 5.5 Serverless on Vercel

Both the frontend and backend are deployed on Vercel. The backend runs as a serverless Express function via `vercel.json`. This means there is no persistent process — each request may spin up a fresh container. Redis uses `lazyConnect: true` with a short connect timeout (4 s) and `maxRetriesPerRequest: 1` to fail fast and not stall requests during cold starts. MongoDB connections are established per cold-start and reused within a warm container.

---

## 6. UX Optimisations

### 6.1 Hero Carousel for Top-Liked Videos

The landing page opens with a hero carousel showing the top 3 most-liked videos. This drives engagement by surfacing the best content immediately. The list is cached in Redis for 5 minutes and invalidated whenever a like/dislike changes, keeping it reasonably fresh without hammering MongoDB on every page load.

### 6.2 Flip Card Video Cards

Each video card on the feed is a CSS flip card. The front shows the video player, title, and metadata. Clicking the info icon flips the card to show the description and the delete button (for the owner). The flip state is local component state (`flip: boolean`) toggled on click, with `stopPropagation` preventing the flip click from also triggering video navigation.

### 6.3 Infinite Scroll / Load More

The feed loads 10 videos per page. A "Load More" button (or scroll trigger) appends the next page to the existing list. The cursor from the last page is retained in component state and passed to the next `getFeed()` call. When `hasMore` is false the button is hidden.

### 6.4 Debounced Search with Category Scope

The search input in the header uses a debounce so the API is not called on every keystroke. The search term and the active category are both managed as `BehaviorSubject` observables in `VideoService`. Search results automatically respect whichever category is currently selected — the `category` query parameter is included in search requests unless the category is "All".

### 6.5 Feed Refresh Signal After Upload

After a successful video upload, the upload dialog emits a `triggerFeedRefresh()` call on `VideoService`. The home feed component subscribes to `feedRefresh$` (a `Subject<void>`) and re-fetches the first page of the feed when it fires. This means the user sees their newly uploaded video appear in the feed without a manual refresh.

### 6.6 View Count Format (K/M Abbreviation)

The `formatViews()` method on the video card component converts raw numbers to human-readable strings: 1500 → "1.5K", 1000000 → "1M", with trailing ".0" stripped. Locale-formatted strings are returned for values under 1000.

### 6.7 Avatar Fallback

If the Google CDN URL for a user's profile image fails to load (network error, expired token), the `onAvatarError()` handler sets the image element's `display` to `none`, preventing a broken image icon from appearing.

### 6.8 Dark / Light Theme Toggle

A `ThemeService` manages a dark/light mode preference. The toggle is available in the sidebar. The chosen theme is persisted so it survives page refreshes.

### 6.9 Category Slider

A scrollable horizontal chip row at the top of the feed lets users filter by category without leaving the page. The active chip is highlighted. Selecting a chip calls `setCategory()` on `VideoService`, which propagates through the `category$` observable to trigger a fresh page-one feed fetch.

---

## 7. Security

### 7.1 Google OAuth — No Password Attack Surface

By using Google as the sole identity provider, the platform eliminates the entire class of password-based attacks (credential stuffing, brute-force, rainbow tables). The Google ID token is verified server-side using `google-auth-library` against the configured `GOOGLE_CLIENT_ID`. Replay attacks are mitigated because each ID token has a short expiry and is audience-checked.

### 7.2 JWT Authentication

The backend issues a signed JWT containing `userId`, `email`, `name`, and `profileImage`. The JWT is signed with `JWT_SECRET` using jsonwebtoken's default HS256 algorithm. The token is verified on every authenticated request by the `authenticateJWT` middleware, which rejects missing or tampered tokens with HTTP 401.

### 7.3 HTTP Interceptor — Automatic Header Injection and 401 Handling

The Angular `AuthInterceptor` is a functional interceptor registered at the application level. It automatically attaches `Authorization: Bearer <token>` to every outgoing request except those to `amazonaws.com` (presigned S3 URLs, which carry their own auth). If any API response returns HTTP 401, the interceptor clears `localStorage` (removes `token` and `user`) and redirects to `/home`, ensuring the user cannot continue in a broken authenticated state.

### 7.4 Route Guard

`AuthGuard` protects routes that require authentication (upload, profile, watch history). It checks for both a `token` and a valid JSON `user` object with a `userId` field in `localStorage`. Malformed JSON (e.g., from a corrupted store) is caught and treated as unauthenticated. On failure, the guard navigates to `/home` with `replaceUrl: true` so the protected URL does not remain in browser history.

### 7.5 Tiered Rate Limiting

Four rate limit tiers are applied using `express-rate-limit`:

- Auth endpoint (`/google-login`): 10 requests per IP per 15 minutes — slow-down for token brute-forcing
- Upload endpoints (`/upload-url`, `/save-video`): 20 requests per IP per hour — cost control for S3 and HuggingFace
- Write operations (likes, dislikes, comments, history): 60 requests per IP per 15 minutes — spam/flooding prevention
- Global backstop (all routes): 300 requests per IP per 15 minutes — general DoS mitigation

All limiters return consistent JSON error responses so no HTML leaks to API clients.

### 7.6 CORS Whitelist

The Express CORS middleware reads `CLIENT_URL` from the environment as a comma-separated list of allowed origins. Requests from unlisted origins are rejected with a CORS error. This prevents cross-site request forgery from arbitrary web pages.

### 7.7 JSON Body Size Limit

Express is configured with `express.json({ limit: '10kb' })`. This rejects abnormally large JSON payloads and prevents a class of denial-of-service attacks that send oversized bodies to exhaust server memory.

### 7.8 Input Validation (Zod)

Request bodies for key endpoints are validated with Zod schemas before reaching the controller. Invalid inputs receive a structured 400 response immediately.

### 7.9 Admin Endpoint Protection

The `GET /api/admin/stats` endpoint checks the authenticated user's email against a hardcoded allowlist (the owner's email). Any other authenticated user receives 403. This is enforced on both the backend route (server-side) and the Angular route (client-side), so the dashboard component is never mounted for non-admin users.

### 7.10 S3 Key Sanitisation

Upload filenames are sanitised via `path.basename()` (strips directory components) and whitespace is replaced with underscores before constructing the S3 key. A UUID v4 prefix is prepended to every key, so even if an attacker crafts a path-traversal filename like `../../etc/passwd`, the resulting key is `Videos/<uuid>/passwd` — harmless.

---

## 8. Session and State Management

### 8.1 JWT in localStorage

The JWT returned by `/google-login` is stored in `localStorage` under the key `token`. A JSON object with user metadata (userId, name, email, profileImage, role) is stored under `user`. Both are cleared on logout or on any 401 response from the API (via the interceptor).

The choice of `localStorage` over cookies means the token persists across browser tabs and survives page refreshes. The trade-off is that it is accessible to JavaScript, making it theoretically vulnerable to XSS. For the current use case (no payment data, no PII beyond Google profile info) this is accepted.

### 8.2 AuthService BehaviorSubject

A `BehaviorSubject<boolean>` in `AuthService` tracks the current login state reactively. Components subscribe to `getLoginState()` to show/hide login-dependent UI without polling `localStorage`. The state is initialised from `localStorage` in the constructor (so a page refresh correctly restores the logged-in state), and updated via `updateLoginState()` which wraps the `next()` call in a `setTimeout` to defer it to the next change-detection cycle, avoiding `ExpressionChangedAfterItHasBeenCheckedError`.

### 8.3 Anonymous Session UUID for View Deduplication

Unauthenticated users are assigned a stable session UUID on their first visit. It is generated with `crypto.randomUUID()` and stored in `localStorage` under `ss_session_id`. This ID is sent as the `X-Anon-Session` header on view-count requests so the backend can build a per-browser dedup key without requiring a login. The UUID persists until the user clears their browser storage, giving reasonable (if not perfect) deduplication for anonymous viewers.

### 8.4 SessionStorage for Redirect URL

When an unauthenticated user tries to access a guarded route, the intended URL can be saved to `sessionStorage` under `redirectUrl`. After a successful login, `AuthService.getRedirectUrl()` retrieves it so the user is sent to their intended destination rather than the home page.

### 8.5 No Server-Side Sessions

The API is fully stateless. Every request must carry its JWT. There is no session store, no cookies, and no concept of a server-side session object. This makes horizontal scaling trivial — any API instance can handle any request as long as it has `JWT_SECRET`.

---

## 9. Testing Strategy

The frontend has a Jasmine / Karma unit test suite covering:

- **AuthService** — login state initialisation, googleLogin HTTP call, BehaviorSubject behaviour, deferred state updates, logout flow
- **VideoService** — cursor/category feed pagination, search, auth-gated endpoints, view recording (JWT vs anon UUID), reactive observables
- **CommentService** — CRUD operations, reply threading, error propagation
- **AuthInterceptor** — JWT header injection, S3 bypass, 401 auto-logout
- **AuthGuard** — allow/deny logic, malformed JSON, redirect URL
- **VideoCardComponent** — ngOnInit ownership detection, flip toggle, delete confirmation dialog, formatViews formatting

`HttpClientTestingModule` and `HttpTestingController` are used to mock HTTP calls. Modern Angular standalone component testing uses `provideHttpClient()` + `provideHttpClientTesting()` + `provideRouter([])` in place of module imports. The `fakeAsync` + `tick()` pattern handles `setTimeout`-deferred state changes.

---

## 10. Infrastructure and Deployment

Both the Angular SPA and the Express API are deployed on Vercel. The backend `vercel.json` routes all requests to the Express entry point as a serverless function. Environment variables (JWT secret, MongoDB URI, Redis URL, AWS credentials, HuggingFace key) are set in the Vercel project settings and never committed to git. MongoDB Atlas is used for managed database hosting. Redis is provided by Upstash (a serverless Redis service compatible with ioredis). AWS S3 stores video files; CloudFront serves them via CDN. The IAM user has minimal permissions: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `cloudwatch:GetMetricStatistics`.
