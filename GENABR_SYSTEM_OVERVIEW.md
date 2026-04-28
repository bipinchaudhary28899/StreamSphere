# StreamSphere — GenABR System Overview
*Technical deep-dive: architecture, data flow, limitations, and advantages*

---

## What Is GenABR?

GenABR (Generative Adaptive Bitrate) is a predictive video streaming engine built on top of standard HLS.js. Where conventional ABR (Adaptive Bitrate) is **reactive** — it only changes video quality after the buffer runs low or a stall occurs — GenABR is **predictive**: it uses the user's real-time GPS location, movement speed, historical network dead zones, and a GPT-4o-mini language model to anticipate network degradation *before* it happens, and pre-buffers video aggressively *before* the user enters a poor-coverage area.

The platform it runs on is **StreamSphere**, a full-stack video streaming application (Angular frontend, Node.js/Express backend, MongoDB, Redis, AWS S3/CloudFront).

---

## System Architecture — The Three Tiers

GenABR uses a **tiered inference engine**. Each tier costs more but knows more. The system tries to answer with the cheapest tier that can do so confidently.

```
Incoming prediction request (every 25 seconds)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  TIER 1 — GUARD  (local, zero cost, ~1ms)                   │
│  Checks: connection type, buffer level, recent stalls        │
│  If network is clearly fine → return "normal" immediately    │
│  If uncertain → pass to Student                              │
└──────────────────────────────┬──────────────────────────────┘
                               │ (only if uncertain)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  TIER 2 — STUDENT  (statistical, ~25ms)                     │
│  Runs the Prediction Cone + Corridor Scanner                │
│  Computes a risk score 0.0–1.0                              │
│  If confidence ≥ 60% → return recommendation immediately    │
│  If confidence < 60% → return Student answer NOW,           │
│                         fire Oracle in background           │
└──────────────────────────────┬──────────────────────────────┘
                               │ (background, async)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  TIER 3 — ORACLE  (GPT-4o-mini, ~2–4s but async)           │
│  Full LLM reasoning with location, speed, network context   │
│  Result cached in Redis (5 min) per user+tile               │
│  Next poll cycle reads cache → instant Oracle answer        │
└─────────────────────────────────────────────────────────────┘
```

**Key design insight**: The user never waits for the Oracle. Student answers in ~25ms. Oracle runs in the background and its result is ready on the *next* 25-second cycle.

---

## Component 1 — Prediction Cone

The core spatial model. When a user is at a GPS coordinate moving at a given speed and heading, the system projects a "cone" of possible positions up to 60 seconds into the future. It:

1. Generates branch points at 5-second intervals along the heading
2. Fans out ±30° to model realistic path uncertainty
3. For each branch point, fetches the network quality tile from the **Shadow Network Map**
4. Aggregates tile-level signal quality into a single risk score (0.0 = safe, 1.0 = imminent dead zone)
5. Translates risk into buffer targets:
   - `risk < 0.20` → Normal (HLS.js default 10s buffer)
   - `0.20 ≤ risk < 0.45` → Moderate Prebuffer (20s)
   - `risk ≥ 0.45` → Aggressive Prebuffer (45s)

---

## Component 2 — Corridor Scanner

Runs inside every Prediction Cone call. It projects 200m steps ahead (up to 5km) along the user's exact heading and finds the first dead zone the user will enter. It then computes:

- `dead_zone_entry_sec` — how many seconds until the dead zone starts
- `dead_zone_duration_sec` — how long the dead zone lasts
- `required_buffer` = `dead_zone_duration_sec × 1.30` (30% safety margin)
- `achievable_buffer` = `entry_seconds × bandwidth_Mbps / bitrate_Mbps`
- `corridor_feasible` = whether the device can pre-buffer enough before entering the dead zone

This gives the Oracle concrete numbers to reason about, e.g. *"dead zone starts in 14 seconds, lasts 8 seconds, you need 10.4 seconds of buffer, you can achieve 9.1 seconds — not feasible."*

---

## Component 3 — Shadow Network Map

A geospatial database of network quality tiles (~1km grid squares, using a geohash scheme). Each tile stores:

- Mean signal strength
- Downlink median and variance
- Number of dead zone reports
- Source (inferred from stall events, or user-reported)

**How tiles are populated:**
- Every time a session stall occurs at a GPS location, that location is automatically ingested as a dead zone signal
- At session end, all telemetry pings for that session are aggregated into their respective tiles, updating running statistics
- Tiles are cached in a `radio_map_cache` MongoDB collection with a 2-day TTL on raw ping data

---

## Component 4 — Oracle Engine (GPT-4o-mini)

When the Student is uncertain (confidence < 60%), the Oracle fires asynchronously. It builds a natural-language prompt containing:

- Current GPS coordinates and speed category (stationary / urban / suburban / highway)
- Recent downlink history (last 5 measurements)
- Prediction cone risk score and branch breakdown
- Corridor scanner output (dead zone details if any)
- Current bitrate and buffer level

GPT-4o-mini returns a structured JSON decision:
- `recommendation` — normal / moderate / aggressive
- `confidence` — 0.0–1.0
- `risk_adjustment` — how much to shift the student risk score
- `reasoning` — full natural-language explanation

The Oracle can **diverge** from the Student (adjust the recommendation up or down). Every decision is logged to MongoDB as an `OracleDecision` document for research analysis.

**Rate limiting**: Each user is limited to a fixed number of Oracle calls per day to control OpenAI API costs.

**Cache**: Oracle results are cached in Redis per `userId + tileId` for 5 minutes. When a mobile user moves into a new tile, the cache key changes → fresh Oracle call. When stationary (laptop/desktop), the same cache key persists → Oracle re-fires every 5 minutes rather than every 25 seconds.

---

## Component 5 — Telemetry Pipeline

Every 4 seconds, the frontend measures:

| Field | Source |
|---|---|
| `lat`, `lng`, `speed_kmh`, `heading` | `navigator.geolocation` |
| `downlink_mbps`, `rtt_ms`, `connection_type` | `navigator.connection` (Network Information API) |
| `buffer_level_sec` | HLS.js `mainForwardBufferInfo.len` |
| `bitrate_kbps` | HLS.js `LEVEL_SWITCHED` event |
| `battery_level` | `navigator.getBattery()` |

Pings are **change-detected** before buffering: a reading is only kept if the buffer level changed by >2 seconds, the user moved >50 metres, or 15 seconds elapsed with no push. This reduces storage by ~70% for stationary sessions.

Pings are **batched** (10 at a time) and sent in a single HTTP call to reduce API overhead.

**Stall events** are recorded separately with duration and GPS location.

**Bitrate switches** are recorded with the `reason` field:
- `abr_auto` — HLS.js changed quality based on bandwidth
- `genabr_override` — GenABR proactively forced a quality step-down
- `user_manual` — user changed quality manually

---

## Component 6 — Proactive Quality Management

This is the core behavioral difference between GenABR and standard HLS.js:

**Standard HLS.js ABR (reactive):**
1. Buffer drains below threshold
2. HLS.js fetches next segment at lower quality
3. Quality switch happens *after* the problem started

**GenABR (predictive):**
1. Corridor scanner detects dead zone ahead
2. Oracle confirms aggressive prebuffer recommendation
3. `hls.nextLevel` is set to a lower quality tier *immediately*
4. `maxBufferLength` is increased to 45 seconds
5. HLS.js fetches the next segment at lower quality AND buffers more of it
6. User enters the dead zone with 45s of pre-buffered low-quality video → no stall

When the Oracle returns to "normal", GenABR waits 2 consecutive normal cycles then releases `hls.nextLevel = -1`, handing quality control back to HLS.js auto-select.

---

## Component 7 — QoE Metric: Φ Score

Every session is scored with the **Φ (Phi) score** — a quality-of-experience-to-cost ratio:

```
Φ = (avgVMAF − 0.30·σVMAF − 0.05·N_stall·T_stall_sec) / session_duration_min
```

- `avgVMAF` — estimated video quality (derived from bitrate using an industry lookup table)
- `σVMAF` — quality instability (standard deviation of VMAF across the session)
- `N_stall × T_stall` — stall penalty (number of stalls × total stall seconds)
- `session_duration_min` — normalises for session length

Higher Φ = better quality, more stability, fewer stalls, relative to how long the session ran.

VMAF is estimated from bitrate (not measured from frames) using this lookup:

| Bitrate | Estimated VMAF |
|---|---|
| ≥ 8000 kbps | 93 |
| ≥ 5000 kbps | 90 |
| ≥ 3000 kbps | 85 |
| ≥ 1500 kbps | 78 |
| ≥ 800 kbps | 70 |
| ≥ 400 kbps | 62 |
| ≥ 200 kbps | 52 |
| < 200 kbps | 42 |

---

## Admin Research Dashboard

The dev dashboard (admin-only) shows:

- **GenABR vs Baseline comparison table** — Φ score, avg VMAF, σVMAF, stalls, buffer depth, with % improvement columns
- **GenABR ON/OFF master toggle** — switches the entire system globally. When OFF, sessions run with standard HLS.js and are recorded as `genabr_active: false`, accumulating real baseline data for comparison
- **Oracle Engine Intelligence** — 30-day LLM call log: success rate, divergence rate, token usage, recommendation breakdown, trigger reason tag cloud, recent decision log with full LLM reasoning text
- **Corridor Scanner stats** — dead zone detection rate, feasibility rate, avg entry/duration seconds
- **Infrastructure monitoring** — AWS CloudFront requests/data, S3 storage, API request counts

---

## Current Limitations

### 1. GPS Dependency for Location Features
The corridor scanner, dead zone prediction, and speed categorisation all require GPS. On laptops and desktops, `navigator.geolocation` either returns null or provides a rough IP-based location that doesn't move. Oracle still runs on laptops (using network context only), but the spatial prediction is meaningless without real movement data.

### 2. VMAF is Estimated, Not Measured
VMAF is computed from bitrate using a static lookup table, not from actual video frame analysis. Real VMAF requires decoding video frames and running a perceptual model (e.g. Netflix's VMAF library), which is expensive on the client and impractical for mobile. The estimation is a reasonable proxy but won't match ground-truth VMAF for content-specific quality differences (e.g. a still documentary vs a fast-action sport clip at the same bitrate).

### 3. Shadow Map is Sparse Until Populated
The dead zone map starts empty. It only becomes useful after enough users have streamed through an area and their stall events have been ingested. In areas with no prior sessions, the cone always scores low risk regardless of actual network quality. The map improves with usage (crowd-sourced), but is not useful out of the box in new regions.

### 4. Φ Score is Session-Duration-Sensitive
The Φ formula divides by session duration. A 2-minute session with good quality scores higher than a 10-minute session with the same quality, because the cost denominator is smaller. This makes short test sessions artificially inflate Φ. For fair comparison, sessions should be filtered to a minimum duration (recommended: 5+ minutes) or this normalisation should be noted in the methodology.

### 5. Oracle Cannot Diverge Enough on Stable Network
When the user is stationary with stable network (common on desktop), the Student's risk score hovers around 0.412 and Oracle always agrees. The 61% historical divergence rate comes from mobile sessions where real signal changes provided different context. Without movement or signal change, Oracle's LLM reasoning produces consistent decisions that don't diverge from the heuristic.

### 6. No Live A/B Testing Within a Session
GenABR is either fully ON or OFF per the admin toggle — there is no per-user split. The comparison data (with/without GenABR) is collected across different time windows rather than simultaneous control/treatment groups. This is a methodological limitation for research purposes. True A/B testing would require randomly assigning individual sessions to GenABR or standard ABR at session creation time.

### 7. HLS.js Buffer Cap Doesn't Flush Existing Buffer
When GenABR reduces `maxBufferLength` (on recovery), HLS.js does not flush the existing buffer — it simply stops fetching new segments until the buffer drains naturally through playback. This means there's a lag of up to `current_buffer_length` seconds before HLS.js resumes fetching at the new (lower) target. This is HLS.js behaviour and cannot be overridden without destructive player intervention.

### 8. Network Information API is Not Universal
`navigator.connection` (downlink, rtt, connection type) is a Chrome/Android API. Safari and Firefox do not support it. On unsupported browsers, `downlink_mbps` and `rtt_ms` are always null, which degrades Oracle context quality and prevents the Guard tier from using signal strength as a quick-pass criterion.

---

## Advantages of This Model

### 1. Proactive, Not Reactive
The fundamental advantage: GenABR acts before problems happen. Standard ABR reacts to buffer drain → quality drops → user potentially sees a stall. GenABR sees the dead zone coming → steps quality down → fills 45 seconds of buffer → user rides through the dead zone without interruption.

### 2. Zero Latency for the User
The tiered architecture means the user never waits for the LLM. The Student tier answers in ~25ms using local statistical computation. Oracle runs silently in the background and its result is applied on the next cycle. From the user's perspective, GenABR feels instant.

### 3. Cost-Efficient LLM Use
Oracle only fires when Student is uncertain (confidence < 60%). The Guard tier filters out clearly-stable sessions before Student even runs. Oracle results are cached per geographic tile for 5 minutes. This means in practice, GPT-4o-mini is only called when it can actually add value — uncertain network territory — not on every ping.

### 4. Self-Improving Shadow Map
Every stall event anywhere in the world automatically updates the dead zone map. Every session end aggregates ping data into tiles. The system gets smarter the more it is used, with no manual labelling or training required.

### 5. Full Observability for Research
Every Oracle decision is logged with: session ID, GPS coordinates, speed category, student risk, oracle risk, divergence flag, corridor scan results, dead zone entry/duration, token usage, and full LLM reasoning text. This creates a complete research audit trail for the paper.

### 6. Real Measured Comparison Data
The admin toggle allows collecting genuinely comparable baseline data (standard HLS.js) and GenABR data on the same platform, same video content, and same user population — making the comparison more valid than using third-party benchmarks.

### 7. Graceful Degradation
- No GPS → Oracle still runs on network context alone
- No Network Information API → Guard tier passes, Student handles decision
- Redis down → Oracle caching disabled, falls back to Student on every cycle
- OpenAI API down → rate limiter catches it, Student answers
- GenABR admin toggle OFF → standard HLS.js takes over seamlessly

The system never crashes the player. Every failure mode has a defined fallback.

### 8. Demonstrates a Novel Research Claim
The combination of spatial dead zone prediction + LLM reasoning + proactive buffer management is not present in any existing open ABR implementation (BOLA, Pensieve, RobustMPC, etc.). GenABR specifically addresses the "last-mile mobility problem" — the quality degradation that occurs when mobile users move through areas of variable cellular coverage — which existing systems don't model.

---

## Data Flow Summary

```
User watches video on mobile
        │
        ├─► GPS + network sampled every 4s
        │         │
        │         ▼
        │   Change detection filter
        │         │
        │         ▼
        │   Batch buffer (10 pings)
        │         │
        │         ▼
        │   POST /telemetry/pings ──► MongoDB TelemetryPing collection
        │
        ├─► Every 25s: POST /genabr/decision
        │         │
        │         ▼
        │   Guard tier (local check)
        │         │ (if uncertain)
        │         ▼
        │   Prediction Cone + Corridor Scanner
        │         │
        │         ├─► (confidence ≥ 60%) → Student answer returned
        │         │
        │         └─► (confidence < 60%) → Student answer returned immediately
        │                                   + Oracle fires in background
        │                                   + Oracle result cached in Redis (5 min)
        │                                   + Oracle result applied next cycle
        │
        ├─► HLS.js reads buffer target
        │         │
        │         ├─► maxBufferLength adjusted
        │         └─► hls.nextLevel forced down (if aggressive) ──► LEVEL_SWITCHED event
        │                                                              │
        │                                                              ▼
        │                                                    POST /telemetry/bitrate-switch
        │
        └─► Session end: POST /telemetry/session/:id/end
                  │
                  ▼
          qoe.service: computes avgVMAF, σVMAF, Φ score,
                       buffer stats, movement type
                  │
                  ▼
          StreamingSession updated in MongoDB
                  │
                  ▼
          Shadow Map tiles updated from session pings
```

---

*Generated: April 2026 — StreamSphere / GenABR research project*
