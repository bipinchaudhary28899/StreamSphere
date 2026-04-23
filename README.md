# StreamSphere — Video Streaming Platform

A full-stack YouTube-style video platform built with Angular 17 and Node.js/Express. StreamSphere supports Google OAuth login, direct-to-S3 video uploads, HLS adaptive streaming, AI-powered auto-categorization, comments, likes, watch history, a Netflix-style hero carousel, and a layered performance architecture that keeps the feed fast at scale.

---

## Table of Contents

- [Quick Start](#-quick-start)
- [Features](#-features)
  - [Google Login](#feature-1-google-login)
  - [Video Upload with HLS Transcoding](#feature-2-video-upload-with-hls-transcoding)
  - [AI Auto-Categorization](#feature-3-ai-auto-categorization)
  - [Video Feed with Search & Filters](#feature-4-video-feed-with-search--filters)
  - [Video Player with Adaptive Quality](#feature-5-video-player-with-adaptive-quality)
  - [Like / Dislike](#feature-6-like--dislike)
  - [Comments](#feature-7-comments)
  - [Watch History](#feature-8-watch-history)
  - [Hero Carousel](#feature-9-hero-carousel)
  - [User Profile & Video Management](#feature-10-user-profile--video-management)
  - [Video Deletion](#feature-11-video-deletion)
- [⚡ Performance Architecture](#-performance-architecture)
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
npm install
zip -r function.zip handler.js node_modules
# Upload to AWS Lambda via console or CLI
```

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

Videos are uploaded directly from the browser to S3 via a presigned URL, keeping the backend out of the data path. After upload, an AWS Lambda function automatically transcodes the video into HLS streams and generates a short preview clip.

**Upload flow:**
1. Frontend requests a presigned S3 URL from `POST /api/upload-url`
2. Browser uploads the file directly to S3 (progress tracked in the UI)
3. Frontend calls `POST /api/save-video` to store metadata — video is saved with `status: 'processing'`
4. S3 ObjectCreated event triggers the Lambda HLS transcoder
5. Lambda transcodes the video into 360p and 720p HLS streams plus an 8-second MP4 preview
6. Lambda calls `POST /api/internal/hls-complete` (authenticated with a shared secret)
7. Backend updates the video: `status → 'ready'`, stores `hlsUrl` and `previewUrl`, busts Redis cache
8. The video appears in the feed

**During processing:**
- The uploader sees a "processing" banner in the feed (persists across page refreshes)
- A toast notification appears when the video becomes ready
- Processing videos are hidden from other users until `status === 'ready'`

**Client-side validation:**
- File must be a video type (`video/*`)
- Duration is checked using the HTML5 `<video>` element before upload (limit: 3 minutes)
- Backend enforces the same limit as a second check

---

### Feature 3: AI Auto-Categorization

When a video is uploaded, the backend automatically assigns it a category using zero-shot classification via the Hugging Face inference API.

**How it works:**
- Model: `facebook/bart-large-mnli` (zero-shot text classification)
- The video's title and description are combined into a single input string
- The model scores each of 44 possible categories (Music, Gaming, Tech, Travel, etc.) against the hypothesis: *"This video is about {}."*
- The highest-scoring category is assigned to the video
- If the Hugging Face API returns HTTP 429 or 503 (rate limit / model loading), the service retries up to 3 times with exponential backoff (1s → 2s)

**Categories supported:**
Music, Gaming, Sports, Movies, Comedy, Web Series, Learning, Podcasts, News, Fitness, Vlogs, Travel, Tech, Food & Recipes, Motivation, Short Films, Art & Design, Fashion, Kids, History, DIY, Documentaries, Spirituality, Real Estate, Automotive, Science, Nature, Animals, Health & Wellness, Business & Finance, and more.

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
- All HLS files from S3 (`Videos/hls/<uuid>/` — master playlist, segment playlists, `.ts` chunks, and `preview.mp4`)

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
            ↓
    Webhook → Backend → DB (hlsUrl, previewUrl, status: ready)
            ↓
    CloudFront serves all HLS + preview files
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

### Hover-Based Lazy Loading for Video Previews

**Problem:** Rendering 12+ video cards on the home page, each with a `<video>` element pointing to a CloudFront URL, caused the browser to fire a network request for every card immediately on page load — even for videos far below the fold.

**Solution:** Video card previews use `preload="none"` and a lazy source injection pattern. The `<source>` element that points to the video URL is only added to the DOM when the user hovers over a card:

```typescript
previewLoaded = false;

onThumbHover(): void {
  this.previewLoaded = true;  // triggers *ngIf on the <source> element
}
```

```html
<video preload="none">
  <source *ngIf="previewLoaded" [src]="safeUrl" type="video/mp4" />
</video>
```

Zero video network requests on page load. Previews only load when the user actively hovers over a card.

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
| AI categorization | Hugging Face (facebook/bart-large-mnli) |
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
| `HUGGING_FACE_API_KEY` | Hugging Face inference API key for auto-categorization |
| `HLS_WEBHOOK_SECRET` | Shared secret for the Lambda → backend webhook |
| `BACKEND_URL` | Public URL of the backend (used by Lambda to call the webhook) |

### Lambda (AWS environment variables)

| Variable | Purpose |
|---|---|
| `AWS_S3_BUCKET_NAME` | Same bucket as the backend |
| `CLOUDFRONT_URL` | CloudFront base URL |
| `BACKEND_URL` | Public backend URL |
| `HLS_WEBHOOK_SECRET` | Must match the backend value |
