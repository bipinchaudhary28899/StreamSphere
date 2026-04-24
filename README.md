# StreamSphere — Video Streaming Platform

A full-stack YouTube-style video platform built with Angular 17 and Node.js/Express. StreamSphere supports Google OAuth login, direct-to-S3 video uploads, HLS adaptive streaming, a fully serverless AI pipeline (Whisper transcription + GPT-4o-mini vision + synthesis + HuggingFace categorization), comments, likes, watch history, a Netflix-style hero carousel, and a layered performance architecture that keeps the feed fast at scale.

---

## Table of Contents

- [Quick Start](#-quick-start)
- [Features](#-features)
  - [Google Login](#feature-1-google-login)
  - [Video Upload with HLS Transcoding](#feature-2-video-upload-with-hls-transcoding)
  - [AI Pipeline — Transcription, Visual Analysis & Auto-Categorization](#feature-3-ai-pipeline--transcription-visual-analysis--auto-categorization)
  - [Video Feed with Search & Filters](#feature-4-video-feed-with-search--filters)
  - [Video Player with Adaptive Quality](#feature-5-video-player-with-adaptive-quality)
  - [Like / Dislike](#feature-6-like--dislike)
  - [Comments](#feature-7-comments)
  - [Watch History](#feature-8-watch-history)
  - [Hero Carousel](#feature-9-hero-carousel)
  - [User Profile & Video Management](#feature-10-user-profile--video-management)
  - [Video Deletion](#feature-11-video-deletion)
- [⚡ Performance Architecture](#-performance-architecture)
- [🛡️ Resilience & Fallbacks](#️-resilience--fallbacks)
- [🔧 Technical Architecture](#-technical-architecture)
- [Environment Variables](#-environment-variables)

---

## 🚀 Quick Start

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
npm start
```

### Lambda (HLS transcoder)
```bash
cd stream-sphere-lambda
# Install production deps only — ffmpeg-static, ffprobe-static, and @aws-sdk/client-s3
# are devDependencies (provided by the Lambda layer / runtime), so --omit=dev keeps
# the zip small (~2.7 MB unzipped vs 148 MB if dev deps are included)
rm -rf node_modules package-lock.json
npm install --omit=dev
zip -r function.zip handler.js node_modules
# Upload to AWS Lambda via console or CLI
```

> **Lambda layer required:** The FFmpeg binary must be available at `/opt/bin/ffmpeg`.
> Use a pre-built layer (e.g. [github.com/nicktindall/lambda-ffmpeg-layer](https://github.com/nicktindall/lambda-ffmpeg-layer)) or build your own for `linux/x86_64`.
>
> **Runtime:** Node.js 20.x — required for native `fetch`, `FormData`, and `Blob` (used by the Whisper and OpenAI API calls). Memory: 2048 MB. Timeout: 12 min. Ephemeral storage: 2048 MB.

---

## 📋 Features

---

### Feature 1: Google Login

Users authenticate with a single click using Google OAuth. No passwords are stored.

**Flow:**
1. User clicks "Continue with Google" → Google OAuth popup
2. Google returns a credential token to the frontend
3. Frontend sends token to `POST /api/google-login`
4. Backend verifies token with Google's OAuth2Client, creates or updates the user in MongoDB
5. Backend returns a signed JWT + user object
6. Frontend stores token and user in `localStorage`, redirects to home

**Key points:**
- New users are created automatically on first login
- Existing users have their profile image synced from Google on every login
- All subsequent API calls include the JWT in the `Authorization` header

---

### Feature 2: Video Upload with HLS Transcoding

Videos are uploaded directly from the browser to S3 via a presigned URL, keeping the backend out of the data path. After upload, an AWS Lambda function automatically transcodes the video into HLS streams, generates a short preview clip, and extracts a thumbnail image.

**Upload flow:**
1. Frontend requests a presigned S3 URL from `POST /api/upload-url`
2. Browser uploads the file directly to S3 (progress tracked in the UI)
3. Frontend calls `POST /api/save-video` to store metadata — video is saved with `status: 'processing'`
4. S3 ObjectCreated event triggers the Lambda HLS transcoder
5. Lambda transcodes the video into 360p and 720p HLS streams, an 8-second MP4 preview clip, and a JPEG thumbnail (single frame extracted at the 1-second mark)
6. Lambda calls `POST /api/internal/hls-complete` (authenticated with a shared secret)
7. Backend updates the video: `status → 'ready'`, stores `hlsUrl`, `previewUrl`, and `thumbnailUrl`, busts Redis cache
8. The video appears in the feed with its thumbnail visible immediately

**During processing:**
- The uploader sees a "processing" banner in the feed (persists across page refreshes)
- A toast notification appears when the video becomes ready
- Processing videos are hidden from other users until `status === 'ready'`

**Client-side validation:**
- File must be a video type (`video/*`)
- Duration is checked using the HTML5 `<video>` element before upload (limit: 3 minutes)
- Backend enforces the same limit as a second check

---

### Feature 3: AI Pipeline — Transcription, Visual Analysis & Auto-Categorization

After transcoding, the Lambda function runs a multi-stage AI pipeline that enriches each video with a synthesized summary and an accurate category. The Node.js backend contains zero AI logic — it only stores the results delivered by Lambda via webhook.

**Pipeline stages (all in Lambda):**

**Phase 1 — FFmpeg:** HLS renditions (360p, 720p), 8-second MP4 preview, JPEG thumbnail, and a 90-second mono MP3 audio clip are all produced in parallel.

**Phase 2 — Deterministic metadata:** Audio detection runs via `ffmpeg -i` stderr parsing (no ffprobe needed — ffmpeg always writes stream info to stderr). If the output contains `"Audio:"`, transcription is added to the steps. Visual description always runs regardless.

**Phase 3 — Parallel AI:**
- *Whisper (OpenAI):* The 90-second mono MP3 is sent to the Whisper API. Transcripts with fewer than 20 words are discarded as music-only or near-silent audio.
- *GPT-4o-mini vision:* FFmpeg extracts up to 5 keyframes using scene-change detection (`select=gt(scene,0.3)`) — meaningful cuts rather than arbitrary timestamps. Falls back to fixed timestamps (1s / 10s / 30s) if scene detection yields nothing. Each frame is sent to GPT-4o-mini (`detail: low`, ~85 tokens/image) for a concise visual description.

Both steps run with `Promise.allSettled` — if one fails, the other still contributes.

**Phase 4 — Synthesis:** GPT-4o-mini (text) merges all available signals — video title, uploader description, Whisper transcript, and GPT-4o-mini visual summary — into a single rich `aiSummary` paragraph (3–4 sentences). This is stored on the video document and shown to viewers in the player page.

**Phase 5 — Categorization:** `facebook/bart-large-mnli` zero-shot classification scores the `aiSummary` against 44 candidate categories using the hypothesis template `"This video belongs to the {} genre or category."` — the genre/category framing gives the model sharper separation between content-type labels (Music, Gaming) and topic labels (Motivation, History). High-priority genre categories (Music, Gaming) are anchored at the top of the candidate list, taking advantage of bart-large-mnli's small positional preference when scores are close. Retries up to 3× on HTTP 429/503 with backoff.

**Result:** Lambda sends `category` and `aiSummary` in the webhook payload. The backend writes both to MongoDB in the same `$set` that flips the video to `ready`. The `aiSummary` is displayed as a collapsible section in the video player page.

**What goes into the summary (example — music video):**
```
Video title: UP!
Uploader description: Official music video...
Spoken content (transcript): [261 words of lyrics from Whisper]
Visual content (from keyframes): music video with two individuals in lively dance...
→ aiSummary: "The video for 'UP!' by Connor Price and Forrest Frank is an official
   music video featuring energetic choreography and vibrant visuals. The content
   blends hip-hop performance with motivational themes aimed at a young adult audience."
→ category: Music
```

**Categories supported (44 total):**
Music, Gaming, Sports, Movies, Comedy, Web Series, Learning, Podcasts, News, Fitness, Vlogs, Travel, Tech, Food & Recipes, Motivation, Short Films, Art & Design, Fashion, Kids, History, DIY, Documentaries, Spirituality, Real Estate, Automotive, Science, Nature, Animals, Health & Wellness, Business & Finance, Personal Development, Unboxing & Reviews, Live Streams, Events & Conferences, Memes & Challenges, Festivals, Interviews, Trailers & Teasers, Animation, Magic & Illusions, Comedy Skits, Parodies, Reaction Videos, ASMR.

**Lambda bundle size:** Only `axios` and `fluent-ffmpeg` are production dependencies. `@aws-sdk/client-s3` is provided natively by the Lambda Node.js 20 runtime and never bundled. `ffmpeg-static` and `ffprobe-static` are dev-only (the Lambda layer provides the FFmpeg binary at `/opt/bin/ffmpeg`). Final zip: ~2.7 MB.

**Error resilience:** Every AI phase is independently wrapped — a Whisper failure doesn't block vision, a vision failure doesn't block synthesis, and a synthesis failure falls back to concatenating the raw signals. The video always becomes `ready` regardless of AI failures; it just gets `category: 'General'` and `aiSummary: null` as fallbacks.

---

### Feature 4: Video Feed with Search & Filters

The home page feed supports category filtering, keyword search, and infinite scroll — all from a single component.

**Category filter:** Clicking a category in the header slider filters the feed to that category. The filter is applied server-side, not in the browser — only matching videos are fetched.

**Search:** A search bar in the header lets users search by title and description. Searches are debounced (350ms) so the API is only called when the user pauses typing. Search uses MongoDB's full-text index on `title` and `description` fields.

**Infinite scroll:** The feed loads 12 videos at a time using cursor-based pagination. As the user scrolls toward the bottom, an `IntersectionObserver` watching a sentinel element triggers the next page load before they even reach the end (800px pre-fetch margin). See the [Performance Architecture](#-performance-architecture) section for details.

---

### Feature 5: Video Player with Adaptive Quality

The video player uses HLS.js to play videos delivered as HLS adaptive streams, with a manual quality selector overlay.

**Playback:**
- HLS.js loads the `master.m3u8` playlist and automatically selects the best quality level based on network conditions (ABR — Adaptive Bitrate)
- Quality options: Auto, 360p, 720p
- The quality badge shows the actual level currently playing, even in Auto mode (e.g., "Auto (720p)")

**Quality selector:**
- A floating overlay button shows the current quality label
- Clicking it opens a menu of available levels
- Selecting a level immediately switches quality; selecting Auto re-enables ABR

**Video actions:**
- Like / dislike with toggle behavior (clicking the active reaction removes it)
- Delete button shown only to the video owner
- View count incremented once per page load
- Collapsible description section
- Collapsible **AI Summary** section — shown below the description when an `aiSummary` exists. Styled with a subtle purple-blue gradient border and a ✨ AI Summary badge to distinguish it from the user-written description.

**Processing state:**
- If a video's `status` is still `'processing'`, the player shows a "transcoding in progress" message instead of a broken player

---

### Feature 6: Like / Dislike

Users can like or dislike any video from the player page. Reactions are mutually exclusive — liking a disliked video automatically removes the dislike and vice versa.

**Toggle behavior:**
- Clicking the active reaction removes it (unlike / un-dislike)
- Clicking the opposite reaction switches it
- `isLiking` / `isDisliking` boolean flags prevent double-clicks during the API call

**Backend:** Each video document stores `likes` / `dislikes` counts and `likedBy` / `dislikedBy` arrays of user IDs. This lets the API return the user's current reaction on page load and enforce one-reaction-per-user at the database level.

---

### Feature 7: Comments

A comment section lives below the video player, allowing users to discuss videos.

**Frontend:**
- Comment input with character limit
- Comments displayed in reverse chronological order
- Delete button shown to comment owners
- Real-time UI update on post/delete (no page refresh)

**Backend:**
- `POST /api/videos/:videoId/comments` — Add a comment (JWT required)
- `GET /api/videos/:videoId/comments` — Fetch all comments for a video
- `DELETE /api/comments/:commentId` — Delete a comment (owner only)
- Comment model: `videoId`, `userId`, `userName`, `userProfileImage`, `text`, `createdAt`

---

### Feature 8: Watch History

Every video the user plays is automatically added to their watch history.

**How it works:**
- When the video player loads a video, it calls `POST /api/history` with the video ID
- The backend stores a `{ userId, videoId, watchedAt }` record
- Re-watching a video updates the `watchedAt` timestamp rather than creating a duplicate

**User profile:** The History tab in the user profile shows recently watched videos in reverse chronological order, displayed as standard video cards.

**Security:** All history endpoints require JWT authentication. Users can only see their own history.

---

### Feature 9: Hero Carousel

A full-width Netflix-style carousel on the home page that autoplays the top-liked videos as background video previews.

**Playback:**
- Each carousel slide plays an 8-second MP4 preview clip (generated by Lambda during transcoding)
- Videos autoplay muted; a "Watch with Sound" button lets users opt into audio
- After first interaction, a mute/unmute toggle replaces the sound button
- `IntersectionObserver` pauses playback when the carousel scrolls out of view; browser tab visibility API pauses it when the tab is hidden

**Navigation:**
- Previous / Next arrow buttons
- Auto-advances every 8 seconds
- Manual navigation resets the auto-advance timer

**Content:** Populated from `GET /api/videos/top-liked` — the 5 most-liked videos with `status: 'ready'`.

---

### Feature 10: User Profile & Video Management

The profile page is organized into sidebar tabs: My Videos, History, Liked Videos, and Disliked Videos.

**My Videos:** Shows all videos the user has uploaded, including ones still processing. Cards display the processing badge until the video is ready.

**Liked / Disliked Videos:** Fetched from dedicated endpoints (`GET /api/videos/liked`, `GET /api/videos/disliked`) filtered by the authenticated user's ID.

**Watch History:** Reverse-chronological list of videos the user has watched.

---

### Feature 11: Video Deletion

Videos can be deleted from three places: the video player, the user profile table, and the video card flip view.

**What gets deleted:**
- The video document in MongoDB (including all like/dislike data)
- The raw MP4 from S3 (`Videos/raw/<uuid>/`)
- All HLS files from S3 (`Videos/hls/<uuid>/` — master playlist, segment playlists, `.ts` chunks, `preview.mp4`, and `thumbnail.jpg`)

**Authorization:** The backend verifies that the requesting user's ID matches the video's `user_id` before deleting anything. The frontend hides the delete button for non-owners, but the backend enforces it regardless.

---

## ⚡ Performance Architecture

StreamSphere was built with several deliberate system design decisions to keep the feed fast and minimize unnecessary network traffic.

---

### HLS Adaptive Streaming

**Problem:** Serving a raw MP4 file to everyone regardless of their connection speed wastes bandwidth for users on slow connections and makes the player rebuffer on low-bandwidth links.

**Solution:** Every uploaded video is transcoded by an AWS Lambda function into two HLS renditions (360p at 800kbps and 720p at 2800kbps) using FFmpeg. The player uses HLS.js, which automatically selects the appropriate quality based on real-time network conditions (Adaptive Bitrate — ABR). Users on fast connections get 720p; users on slow connections get 360p without buffering.

HLS also enables faster video start times because the browser only needs to download the first 2–3 segments (about 12 seconds of video) before playback begins, rather than waiting for the whole file.

**Architecture:**
```
Upload → S3 (raw MP4)
            ↓
    Lambda (FFmpeg)
            ↓
    S3 (HLS files: master.m3u8, 360p.m3u8, 720p.m3u8, *.ts segments)
    S3 (preview.mp4 — 8-second clip at 480p)
    S3 (thumbnail.jpg — single frame at 1s, 854×480)
            ↓
    Webhook → Backend → DB (hlsUrl, previewUrl, thumbnailUrl, status: ready)
            ↓
    CloudFront serves all HLS, preview, and thumbnail files
```

---

### Preview MP4 for Carousel and Hover Previews

**Problem:** Using HLS.js in the hero carousel caused 500+ CloudFront requests on the home page. HLS.js defaults to buffering 30 seconds of video ahead, fetching all 16 segments per video before the user had even seen 8 seconds of it. With multiple carousel slides and the grid's hover previews each trying to buffer full HLS streams, the request count exploded.

**Solution:** The Lambda transcoder generates an 8-second MP4 preview clip (480p, 600kbps, with `+faststart` so the browser can begin playing before the whole file downloads). This preview is used:

- **Hero carousel:** Simple `<video [src]="previewUrl">` — no HLS.js at all. An 8-second clip loads ~60-80KB on `preload="metadata"` versus hundreds of megabytes for HLS.
- **Video card hover preview:** On mouse hover, the card loads the `previewUrl` instead of the full raw MP4.

HLS.js is used only in the actual video player (`/video/:id`), where adaptive quality switching genuinely helps.

---

### Cursor-Based Infinite Scroll

**Problem:** Traditional page-number pagination (`?page=2&limit=12`) has a well-known flaw: if new videos are uploaded between requests, page boundaries shift and users see duplicate or skipped videos. Offset-based queries also get slower as the offset grows because MongoDB must scan and discard all preceding documents.

**Solution:** The feed uses cursor-based pagination. Each page response includes a `nextCursor` (the `_id` of the last video on that page). The next page query is `{ _id: { $lt: cursor } }` — this is O(1) index lookup regardless of how far into the feed you are, and new uploads never affect existing cursors.

An `IntersectionObserver` watches a sentinel `<div>` at the bottom of the grid. When the sentinel comes within 800px of the viewport (about 2–3 card rows before the user reaches the end), the next page is prefetched. This creates the illusion of an infinitely long feed with no "Load more" button.

```
Grid cards
    ...
    ...
<div #sentinel>  ← IntersectionObserver fires 800px before this enters view
```

---

### Redis Caching with Graceful Degradation

**Problem:** MongoDB reads for the feed, top-liked videos, and individual video pages add latency on every request. Popular videos and the home feed are read far more often than they change.

**Solution:** Frequently read data is cached in Redis with TTLs:

| Cache key | TTL | Busted when |
|---|---|---|
| Feed page (all / by category) | 5 minutes | New video ready, video deleted |
| Individual video | 10 minutes | Video updated, deleted |
| Top-liked videos | 10 minutes | Any like/dislike changes |

**Graceful degradation:** If Redis is unavailable (connection timeout, network error), every cache method is a silent no-op and the request falls through to MongoDB. A Redis outage never crashes the API — it just means cache misses until Redis recovers.

**Cache invalidation:** When a video becomes `ready` (Lambda webhook), the backend busts the feed cache for all categories + the top-liked cache, so the new video appears in the feed immediately without waiting for TTL expiry.

---

### Stale-While-Revalidate Feed Refresh

**Problem:** When the feed refreshes (e.g., after a video upload), setting `isLoading = true` blanks out the entire grid and shows a skeleton, making existing videos unclickable while new data loads.

**Solution:** The feed only shows the skeleton on a cold first load (when `displayedVideos` is empty). On subsequent refreshes, existing videos remain visible and clickable while new data loads silently in the background. The grid updates only when the new data arrives, with no flash of empty content.

```typescript
if (!this.displayedVideos.length) {
  this.isLoading = true;  // cold load: show skeleton
}
// else: refresh silently, keep existing videos visible
```

---

### Lazy Loading (Route-Level Code Splitting)

Angular's router is configured to lazy-load every route. The JavaScript bundle for a page is only downloaded when the user navigates to it for the first time.

**Impact:** The initial bundle the user downloads on first visit contains only the code needed to render the home page. The upload form, profile page, video player, and admin panel are fetched on demand.

```typescript
{
  path: 'video/:id',
  loadComponent: () =>
    import('./components/video-player/video-player.component')
      .then(m => m.VideoPlayerComponent)
},
{
  path: 'upload',
  loadComponent: () =>
    import('./components/upload-video/upload-video.component')
      .then(m => m.UploadVideoComponent)
},
// all routes use loadComponent — never eagerly imported
```

---

### Thumbnail Images and Hover-Based Preview Loading

**Problem:** Rendering 12+ video cards on the home page with eager `<video>` elements fired a network request for every card immediately on load — even for videos far below the fold. Cards also showed a blank black area before the preview loaded, giving a poor first impression.

**Solution — Thumbnail:** Lambda extracts a single JPEG frame at the 1-second mark (`thumbnail.jpg`, 854×480, quality 2) during transcoding. The thumbnail is stored in S3 and served via CloudFront. Each video card displays this image as a static cover immediately on load — no video request needed.

**Solution — Hover preview:** The preview video only starts loading after the user hovers over a card for 2 seconds. A `<source>` element pointing to `previewUrl` is injected into the DOM after that delay, replacing the thumbnail with the playing clip:

```typescript
onThumbHover(): void {
  this.previewDelayTimer = setTimeout(() => {
    this.isPreviewPlaying = true;  // shows video, fades out thumbnail
  }, 2000);
}

onThumbLeave(): void {
  clearTimeout(this.previewDelayTimer);
  this.isPreviewPlaying = false;   // thumbnail fades back in
}
```

```html
<!-- Thumbnail visible until hover preview kicks in -->
<img class="thumb-cover" [class.thumb-cover--hidden]="isPreviewPlaying" [src]="video.thumbnailUrl" />

<!-- Preview video — source only injected on hover -->
<video preload="none">
  <source *ngIf="isPreviewPlaying" [src]="safeUrl" type="video/mp4" />
</video>
```

Zero video network requests on page load. Cards look fully populated from the first paint. Previews only load when the user intentionally hovers.

---

### Debounced Search

The search input fires API requests only after the user has stopped typing for 350ms, using RxJS `debounceTime` and `distinctUntilChanged`. This prevents a cascade of API calls on every keystroke.

```typescript
this.videoService.search$
  .pipe(debounceTime(350), distinctUntilChanged())
  .subscribe(term => {
    if (term.length >= 2) this.runSearch(term);
    else if (this.isSearchMode) this.resetAndLoad();
  });
```

Search uses MongoDB's full-text index on `title` and `description`, so results are ranked by relevance rather than just matched by substring.

---

### CloudFront CDN

All video files (HLS segments, preview clips, and the original raw MP4s) are stored in S3 and served exclusively through CloudFront. CloudFront caches content at edge locations around the world, so video data is served from a node close to each viewer rather than from the S3 origin in a single region.

**Benefits:**
- Lower latency for video start (first segment loads faster from the edge)
- Reduced S3 data transfer costs (CloudFront-to-S3 egress is cheaper than S3-to-internet)
- Automatic HTTPS on all video URLs
- HLS segments are highly cacheable (they never change once written), so edge cache hit rates are high

---

## 🛡️ Resilience & Fallbacks

Every layer of StreamSphere is designed so that a failure in one component degrades gracefully rather than taking down the whole application. This section documents what happens when each subsystem fails, and what the fallback behaviour is.

---

### Quick-Reference Table

| Component | What can fail | Fallback behaviour | App stays up? |
|---|---|---|---|
| Redis | Unreachable / crashed | All cache reads return `null` → every request falls through to MongoDB | ✅ Yes |
| Redis | `REDIS_URL` not set | Caching silently disabled; every method is a no-op | ✅ Yes |
| MongoDB | Startup failure | Server exits with a clear error (no MongoDB = no data, cannot operate) | ❌ Intentional crash |
| MongoDB | Mid-runtime disconnect | Mongoose auto-reconnects; in-flight requests return 500 until reconnected | ⚠️ Degraded |
| Lambda — Whisper | API error / key not set | `transcript = null`; synthesis continues with remaining signals | ✅ Yes |
| Lambda — Vision (GPT-4o-mini) | API error / no frames | `visualSummary = null`; synthesis continues with title + transcript | ✅ Yes |
| Lambda — Synthesis | API error | Falls back to concatenating title + description + visual summary | ✅ Yes |
| Lambda — HuggingFace | API error / key not set | `category = 'General'`; retries 3× on 429/503 before giving up | ✅ Yes |
| Lambda — scene detection | 0 keyframes found | Falls back to fixed-timestamp frames (1s / 10s / 30s) | ✅ Yes |
| Lambda — audio extraction | FFmpeg error | `audioExtracted = false`; Whisper step is skipped | ✅ Yes |
| Lambda — entire AI pipeline | All AI steps fail | Webhook still fires; video becomes `ready` with `category: 'General'`, `aiSummary: null` | ✅ Yes |
| Lambda — webhook never fires | Lambda crashes mid-run | Video stays at `status: 'processing'` permanently | ⚠️ Video stuck |
| HLS player | Browser doesn't support HLS.js | Falls back to native HLS (Safari's built-in MSE) | ✅ Yes |
| HLS player | Video still processing | Shows "processing" state instead of a broken player | ✅ Yes |
| HLS player | Network / load error | Error state with retry button | ✅ Yes |
| Rate limiter | Request limit hit | Returns structured JSON `{ error: "..." }` with correct HTTP status | ✅ Yes |
| JWT | Invalid / missing token | Returns `401 Unauthorized`; protected routes reject cleanly | ✅ Yes |
| View deduplication | Redis down | Dedup key unreadable → view may be counted more than once per session | ⚠️ Count inflated |
| CORS | Unknown origin | Request rejected at the CORS middleware before reaching any route | ✅ Yes |

---

### 1. Redis — Graceful Cache Degradation

Redis is a performance layer, not a critical path. Every single Redis method (`get`, `set`, `del`, `incr`, `delPattern`) is wrapped in a `try/catch` that swallows the error, logs it, and returns `null` or a no-op.

```
Redis unavailable
  → redisService.get() returns null
  → cache miss path executes
  → MongoDB query runs instead
  → response is slower (no cache hit) but 100% correct
```

**Connection settings that keep it safe:**
- `connectTimeout: 4000ms` — doesn't hang the startup sequence
- `commandTimeout: 3000ms` — a slow Redis command fails fast rather than blocking the request
- `maxRetriesPerRequest: 1` — single retry, then give up
- `retryStrategy` — exponential backoff up to 10s, abandons after 10 attempts (no infinite retry loop)

If `REDIS_URL` is not set at all (local dev without Redis), the client is never created and every method returns immediately. The app works without Redis.

---

### 2. MongoDB — The Only Hard Dependency

MongoDB is the only subsystem that can take the application down intentionally. If `mongoose.connect()` fails at startup, the process exits immediately with a clear error message. Trying to serve requests without a database would produce silent failures that are much harder to debug than a clean crash.

```
MongoDB connection fails at startup → process.exit(1)
  → deployment platform restarts the container
  → operator is alerted by crash logs
```

After startup, if MongoDB disconnects mid-runtime, Mongoose's built-in reconnect logic attempts to restore the connection. In-flight requests during the disconnect window will receive `500` errors, but the process stays alive and resumes serving once the connection is restored.

---

### 3. Lambda AI Pipeline — Every Phase is Independent

The AI pipeline is designed so that any single failure never prevents the video from becoming ready. Each phase is individually try/caught, and `Promise.allSettled` (not `Promise.all`) is used for the parallel Whisper + vision step so one rejection never cancels the other.

```
Phase 4a — Whisper fails
  → transcript = null
  → Phase 4b (vision) continues normally
  → Phase 5 (synthesis) uses: title + description + visual summary
  → Phase 6 (categorization) runs on the partial aiSummary

Phase 4b — Vision fails (0 frames / OpenAI error)
  → Scene detection falls back to fixed timestamps (1s, 10s, 30s)
  → If that also fails → visualSummary = null
  → Phase 5 (synthesis) uses: title + description + transcript

Phase 5 — Synthesis fails (OpenAI error)
  → aiSummary = title + " " + description + " " + visualSummary
    (raw concatenation — not beautiful, but better than nothing)

Phase 6 — HuggingFace fails
  → Retries up to 3× with linear backoff (1s → 2s → 3s) on HTTP 429/503
  → If all retries fail → category = 'General'

All AI phases fail
  → webhook fires with category = 'General', aiSummary = null
  → video.status flips to 'ready'
  → video is visible in the feed immediately
  → AI Summary section simply doesn't appear in the player (hidden by *ngIf)
```

**Missing API keys** are also handled: if `OPENAI_API_KEY` is absent, all three OpenAI calls (Whisper, vision, synthesis) are skipped with a warning log and return `null`. If `HUGGING_FACE_API_KEY` is absent, categorization returns `'General'` immediately.

---

### 4. Audio Detection — Fails Open

Audio detection uses `ffmpeg -i` stderr parsing instead of a separate `ffprobe` call. If `spawnSync` itself fails (binary error, timeout), the function returns `true` — it **assumes audio is present** rather than assuming silence. This means Whisper is called unnecessarily on a truly silent file, but it's never accidentally skipped on a file that has audio.

---

### 5. HLS Video Player — Three Layers of Fallback

```
Browser doesn't support HLS.js (older Android, niche browsers)
  → Checks canPlayType('application/vnd.apple.mpegurl')
  → If supported (Safari), uses native HLS via videoEl.src
  → If neither works, player is blank (no crash)

Video still transcoding (status = 'processing')
  → *ngIf renders the processing state div, not the <video> element
  → Uploader sees a spinner + message; others see "not yet available"
  → No broken player, no 404 on missing HLS segments

API call to load video fails
  → Error state renders with a "Try Again" button
  → retryLoad() re-fetches from the same video ID
```

HLS.js itself handles network interruptions during playback — it buffers ahead and retries failed segment requests automatically.

---

### 6. Rate Limiting — Structured Rejection

All four rate limiter tiers (`authLimiter`, `uploadLimiter`, `writeLimiter`, `globalLimiter`) use a shared JSON error formatter so clients always receive a machine-readable response:

```json
{ "error": "Too many login attempts — please wait 15 minutes and try again." }
```

No HTML error pages leak through to API consumers. The global backstop (300 req/15min) catches any route not covered by a specific limiter.

> **Note:** The default `MemoryStore` does not share state across multiple process instances. For a multi-instance deployment, swap it for [rate-limit-redis](https://github.com/wyattjoh/rate-limit-redis).

---

### 7. Webhook Authentication — Internal Endpoint Protection

The Lambda → backend webhook (`POST /api/internal/hls-complete`) is not protected by JWT — it's called by Lambda, not a browser user. Instead it uses a shared secret (`x-hls-secret` header). If the secret is missing or wrong, the controller returns `401` immediately before touching the database.

```
Lambda calls webhook with wrong / missing secret
  → 401 Unauthorized
  → Video stays at 'processing'
  → Operator should check Lambda env vars (HLS_WEBHOOK_SECRET must match backend)
```

---

### 8. View Count Deduplication — Acceptable Degradation

View deduplication uses a Redis key (`ss:view:<videoId>:<userId>`) with a 24-hour TTL to prevent a user from incrementing the counter on repeated page loads. If Redis is unavailable, the dedup key can't be read, so the view is always counted.

```
Redis down
  → dedup key unreadable (returns null)
  → every page load increments the counter
  → view count may be inflated until Redis recovers
  → not a crash, not a data loss event — just a metric inaccuracy
```

This is an accepted trade-off. View counts are a soft metric, not billing data.

---

### Known Gaps (No Fallback Today)

| Gap | Risk | Suggested fix |
|---|---|---|
| Lambda webhook never fires (Lambda crash mid-run) | Video stuck at `'processing'` permanently | Add a scheduled cleanup job: find videos with `status: 'processing'` older than 15 min and re-trigger or mark as `'failed'` |
| JWT tokens never expire | A stolen token is valid forever | Add `expiresIn: '7d'` to `jwt.sign()` and implement refresh tokens or re-login on expiry |
| Multi-instance rate limiting | Rate limits are per-process, not per-cluster | Replace `MemoryStore` with a Redis store (`rate-limit-redis`) |
| S3 presigned URL expiry | If the user's upload takes >1 hour the PUT returns a 403 from S3 | The frontend shows a generic error; consider a shorter TTL with a progress-aware retry |

---

## 🔧 Technical Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 17 (Standalone Components), Angular Material |
| Backend | Node.js, Express, TypeScript |
| Database | MongoDB with Mongoose |
| Cache | Redis (ioredis) |
| Auth | Google OAuth + JWT |
| Video storage | AWS S3 |
| CDN | Amazon CloudFront |
| HLS transcoding | AWS Lambda + FFmpeg |
| AI transcription | OpenAI Whisper API |
| AI vision | GPT-4o-mini (scene keyframes, `detail: low`) |
| AI synthesis | GPT-4o-mini (text — merges all signals into `aiSummary`) |
| AI categorization | HuggingFace `facebook/bart-large-mnli` zero-shot classification |
| Deployment | Vercel (backend + frontend), AWS Lambda |

### Key Design Patterns

**Direct-to-S3 upload:** The backend never touches the video binary. It issues a presigned URL, the browser uploads directly to S3, and the backend only handles metadata. This keeps the Express server fast and avoids large request payloads.

**Event-driven transcoding:** Lambda is triggered by an S3 ObjectCreated event — no polling, no queue management. The transcoding pipeline is fully serverless and scales automatically.

**Webhook with shared secret:** Lambda calls back to the backend via a POST endpoint protected by an `x-hls-secret` header. This keeps the internal endpoint from being publicly callable while avoiding the complexity of VPC networking.

**Graceful Redis degradation:** Every Redis operation is wrapped in a try/catch that logs the error and returns `null`. Cache misses fall through to MongoDB. A Redis outage is invisible to users.

---

## 🔑 Environment Variables

### Backend (`.env`)

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Secret key for signing JWT tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection URL (optional — caching disabled if absent) |
| `AWS_REGION` | AWS region (e.g., `ap-south-1`) |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_S3_BUCKET_NAME` | S3 bucket name |
| `CLOUDFRONT_URL` | CloudFront distribution base URL (no trailing slash) |
| `HLS_WEBHOOK_SECRET` | Shared secret for the Lambda → backend webhook |
| `BACKEND_URL` | Public URL of the backend (used by Lambda to call the webhook) |

### Lambda (AWS environment variables)

| Variable | Purpose |
|---|---|
| `AWS_S3_BUCKET_NAME` | Same bucket as the backend |
| `CLOUDFRONT_URL` | CloudFront base URL |
| `BACKEND_URL` | Public backend URL |
| `HLS_WEBHOOK_SECRET` | Must match the backend value |
| `OPENAI_API_KEY` | For Whisper transcription + GPT-4o-mini (vision + synthesis) |
| `HUGGING_FACE_API_KEY` | For `facebook/bart-large-mnli` zero-shot categorization |
