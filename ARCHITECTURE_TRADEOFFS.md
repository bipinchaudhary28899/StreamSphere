# StreamSphere — Architecture Tradeoffs

A reference document explaining the deliberate design decisions in the caching, pagination, and data consistency layers — and what each tradeoff costs vs. gains.

---

## 1. Feed Cache (TTL: 2 minutes)

**What it does:** Each page of the home/category feed is stored in Redis for 2 minutes. The cache key encodes the cursor position and category, e.g. `ss:feed:all:first` or `ss:feed:cat:Sports:abc123`.

**Why:** MongoDB queries across thousands of videos on every scroll would be too slow and expensive at scale. Redis returns a cached feed page in under 1ms vs. 20–80ms for a MongoDB query.

**The tradeoff:** Video metadata shown on feed cards (views, likes, description) can be up to 2 minutes stale. If someone likes a video or a new video is uploaded, it won't appear on existing cached feed pages until those pages expire and are re-fetched from MongoDB.

**What gets busted immediately:** When a video is deleted or its likes change, the relevant feed cache patterns (`ss:feed:all:*`, `ss:feed:cat:<category>:*`) are wiped so stale content doesn't persist.

**View counts on cards specifically:** View counts on feed cards are the most visibly affected — they always lag behind the real-time count shown on the video player page. This is intentional and matches how YouTube, Netflix, and every other platform at scale handles it.

---

## 2. Single Video Cache (TTL: 10 minutes)

**What it does:** The full video document is cached in Redis after the first fetch, e.g. `ss:video:<id>`. The video player page reads from this cache.

**Why:** The video player page is a high-frequency, low-write endpoint. Caching for 10 minutes means a popular video being watched by hundreds of people simultaneously hits Redis rather than hammering MongoDB.

**The tradeoff:** Metadata on the player page (likes, dislikes, description) can be up to 10 minutes stale — except for operations that explicitly bust this cache.

**What gets busted immediately:** `likeVideo`, `dislikeVideo`, `recordView`, and `deleteVideo` all call `redisService.del(CK.singleVideo(id))` after writing to MongoDB. So the player page always reflects the current like count and view count immediately after the user interacts.

---

## 3. View Count Deduplication (Redis TTL: 24 hours)

**What it does:** When a user watches a video, a key `ss:view:<videoId>:<userId>` is set in Redis with a 24-hour TTL. If the same user returns within 24 hours, `recordView()` returns early without incrementing.

**Why:** Prevents view count inflation from page refreshes, accidental back-navigation, or automated requests.

**The tradeoff:** A genuine re-watch within the same day doesn't count as a new view. This is the same rule YouTube uses (approximately). After 24 hours the key expires and the next watch counts again.

**Anonymous users:** Logged-out users get a stable UUID stored in their browser's `localStorage` (key: `ss_session_id`). This UUID is sent as the `X-Anon-Session` header and used to build a per-browser dedup key (`ss:view:<videoId>:<uuid>`). If a user clears their browser storage, a new UUID is generated and their next watch counts as fresh.

---

## 4. Search Cache (TTL: 1 minute)

**What it does:** Search results for a given term + category combination are cached for 60 seconds, e.g. `ss:search:football:Sports`.

**Why:** Users often type, pause, retype the same query. Caching avoids redundant MongoDB regex scans for identical searches within a short window.

**The tradeoff:** A video uploaded in the last 60 seconds won't appear in search results until the cache expires. Also, newly liked/updated videos won't show their updated metadata in search results for up to 1 minute.

**Why 60 seconds and not longer:** Search results are more time-sensitive than the feed — users expect search to reflect recent uploads. 60 seconds is a reasonable middle ground between performance and freshness.

---

## 5. Top-Liked Cache (Hero Carousel, TTL: 5 minutes)

**What it does:** The 3 most-liked videos used in the hero carousel are cached for 5 minutes under the key `ss:top-liked`.

**Why:** This query (`sort: { likes: -1 }, limit: 3`) runs on every page load for every visitor. Without caching it would be one of the most expensive queries in the system.

**The tradeoff:** The hero carousel can show slightly outdated rankings for up to 5 minutes after a like/dislike event. In practice, the top 3 most-liked videos rarely change rapidly, so this is imperceptible to users.

**What gets busted immediately:** Any `likeVideo` or `dislikeVideo` call deletes `ss:top-liked`, so a fresh ranking is computed on the next page load.

---

## 6. Cursor-Based Pagination (No Offset)

**What it does:** The feed uses the MongoDB `_id` of the last seen video as a cursor instead of SQL-style `OFFSET n`. Each page fetches videos with `_id < cursor`, sorted descending.

**Why:** Offset-based pagination (`SKIP n`) gets slower as `n` grows — MongoDB still has to scan and discard the first `n` documents. With cursor pagination, the query is always `O(PAGE_SIZE)` regardless of how deep into the feed the user is.

**The tradeoff:** Users cannot jump to a specific page number (e.g. "go to page 5"). The feed is strictly sequential. This is the right tradeoff for an infinite-scroll feed where page numbers are meaningless anyway.

**Edge case:** If a video is deleted between two page fetches, the cursor remains valid — the gap just disappears silently on the next page. No errors or duplicate videos.

---

## 7. IntersectionObserver with 800px rootMargin

**What it does:** The infinite scroll sentinel element triggers a new page fetch when it enters a zone 800px below the visible viewport — roughly 2–3 card rows before the user would actually reach the bottom.

**Why:** Fetching only when the user hits the bottom causes a visible pause while the next batch loads. Pre-fetching 800px early means the new cards are already rendered before the user scrolls to them, giving a seamless scroll experience.

**The tradeoff:** On fast connections this works perfectly. On slow connections the 800px buffer might not be enough — the user could still catch up to the sentinel. In that case a brief loading indicator appears. Increasing the margin further would also increase how often unnecessary fetches fire on slow-scroll users.

---

## 8. Redis Graceful Degradation

**What it does:** All Redis operations are wrapped in try/catch. If Redis is down or not configured, every cache miss falls through to MongoDB. The API never crashes due to a Redis failure.

**Why:** Caching is a performance layer, not a correctness layer. The source of truth is always MongoDB. Redis going down should degrade performance, not availability.

**The tradeoff:** During a Redis outage, every request hits MongoDB directly. At low traffic this is fine. At high traffic this could overload MongoDB. The mitigation is Redis's built-in retry strategy (exponential backoff, capped at 10s, gives up after 10 attempts) so reconnection is automatic.

---

## Summary Table

| Layer | TTL | Gain | Cost |
|---|---|---|---|
| Feed pages | 2 min | Fast infinite scroll | Cards show stale views/likes |
| Single video | 10 min | Fast player page loads | Metadata stale (busted on writes) |
| View dedup | 24 hr | No inflation from refreshes | Re-watches same day don't count |
| Search results | 1 min | No redundant DB scans | New videos missing for 60s |
| Top-liked (hero) | 5 min | Cheap hero carousel | Rankings lag by up to 5 min |
| Cursor pagination | — | O(1) deep-scroll queries | No random page access |
| 800px prefetch | — | Seamless scroll | Slightly more API calls |
| Redis fallback | — | 100% uptime during outage | MongoDB takes full load |
