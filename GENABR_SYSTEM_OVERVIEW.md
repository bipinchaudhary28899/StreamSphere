# StreamSphere — GenABR System Overview
*Technical deep-dive: architecture, data flow, function-level flow, limitations, and advantages*

---

## What Is GenABR?

GenABR (Generative Adaptive Bitrate) is a predictive video streaming engine built on top of standard HLS.js. Where conventional ABR (Adaptive Bitrate) is **reactive** — it only changes video quality after the buffer runs low or a stall occurs — GenABR is **predictive**: it uses the user's real-time GPS location, movement speed, historical network dead zones, live RTT and connection-type signals, and a GPT-4o-mini language model to anticipate network degradation *before* it happens, and pre-buffers video aggressively *before* the user enters a poor-coverage area.

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
│  Applies Network Overlay (RTT + connection type + trend)    │
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
│  Prompt now includes RTT history + connection type          │
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

## Component 3 — Network Overlay (NEW)

Applied inside `runInference()` immediately after the Prediction Cone returns its spatial risk score. The overlay adds a signed risk delta (`−0.20` to `+0.50`) based on live network signals that the spatial model cannot see:

### `computeNetworkTrend(values: number[]): NetworkTrend`
Uses **Ordinary Least Squares (OLS) linear regression** to compute the slope of a signal window. This replaces the previous `last − first` delta approach, which silently misclassified plateau-then-drop patterns.

Example: `[1.3, 1.3, 1.3, 0.35, 0.35]`
- Old delta: `0.35 − 1.3 = −0.95` — triggered only if > 2.0 threshold → **missed**
- OLS slope: `≈ −0.33 Mbps/sample` → `direction: 'degrading'` → **correctly detected**

Returns: `{ slope, volatility (std dev), direction: 'degrading'|'stable'|'improving' }`

### `computeNetworkDelta(recentDownlinks, recentRtts, connectionType): NetworkDelta`
Accumulates risk adjustments from multiple signal factors:

| Factor | Condition | Delta |
|---|---|---|
| Downlink degrading | OLS slope < −0.15 | +0.10 to +0.20 (scaled by slope) |
| Signal volatile | std dev > 1.5 Mbps | +0.08 |
| Downlink improving | OLS slope > +0.15 | −0.08 |
| RTT critical | latest RTT > 1000ms | +0.25 |
| RTT high | latest RTT > 500ms | +0.12 |
| RTT elevated | latest RTT > 200ms | +0.05 |
| RTT rising fast | RTT OLS slope > 100 | +0.10 |
| RTT rising | RTT OLS slope > 30 | +0.05 |
| Connection 2G/slow-2G | effectiveType ∈ {2g, slow-2g} | +0.30 |
| Connection 3G | effectiveType = 3g | +0.10 |

**Final risk** = `clamp(spatialRisk + networkDelta, 0, 1)`

This breaks the static-score problem: a stationary user on a degrading 3G connection will now receive `prebuffer_moderate` instead of the previous constant `normal` (which resulted from a fixed spatial score when no shadow map data exists for their tile).

---

## Component 4 — Shadow Network Map

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

## Component 5 — Oracle Engine (GPT-4o-mini)

When the Student is uncertain (confidence < 60%), the Oracle fires asynchronously. It builds a natural-language prompt containing:

- Current GPS coordinates and speed category (stationary / urban / suburban / highway)
- Recent downlink history (last 5 measurements) with OLS trend description
- **Recent RTT history (last 5 readings) with latest RTT level classification** *(new)*
- **Connection type and network delta factors** *(new)*
- Prediction cone risk score and branch breakdown
- Corridor scanner output (dead zone details if any)
- Current tile historical statistics from RadioMapCache

GPT-4o-mini returns a structured JSON decision:
- `recommendation` — normal / moderate / aggressive
- `confidence` — 0.0–1.0
- `adjusted_risk` — final risk score after LLM reasoning
- `reasoning` — concise natural-language explanation (2 sentences)

The Oracle can **diverge** from the Student (adjust the recommendation up or down). Every decision is logged to MongoDB as an `OracleDecision` document for research analysis.

**Rate limiting**: Each user is limited to 10 Oracle calls per minute to control OpenAI API costs.

**Cache**: Oracle results are cached in Redis per `userId + tileId` for 5 minutes. When a mobile user moves into a new tile, the cache key changes → fresh Oracle call. When stationary, the same cache key persists → Oracle re-fires every 5 minutes rather than every 25 seconds.

---

## Component 6 — Telemetry Pipeline

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
- `abr_auto` — HLS.js changed quality based on bandwidth estimation
- `genabr_override` — GenABR proactively forced a quality step-down
- `user_manual` — user changed quality manually via the quality selector

---

## Component 7 — Proactive Quality Management

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

## Component 8 — QoE Metric: Φ Score

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

## Detailed Function-Level Flow

This section maps every significant function call in the GenABR pipeline, showing the call chain, what each function does, what it returns, and when it fires.

### 1. Frontend Measurement Loop (every 4 seconds)

```
TelemetryService.collectPing()
  │
  ├─► getConnectionInfo()
  │     Reads navigator.connection: { downlink, rtt, effectiveType }
  │     Returns: { downlink: number|null, rtt: number|null, type: string|null }
  │     NOTE: This is an OS-level API — unaffected by DevTools network throttling
  │
  ├─► PredictionService.updateNetworkContext(type, downlink, bufferLevel, bitrateKbps, rttMs)
  │     Updates: connectionType, bufferLevelSec, currentBitrateKbps
  │     Appends downlinkMbps → downlinkHistory[] (max 5)
  │     Appends rttMs       → rttHistory[]       (max 5)   ← NEW
  │
  ├─► shouldPush(ping) — change detection filter
  │     Returns true if: first ping | heartbeat (>15s) | buffer delta >2s |
  │                      bitrate changed | connection type changed | moved >50m
  │
  └─► pingBuffer.push(ping)
        When buffer reaches 10 → flushPings()
          POST /api/telemetry/pings  { sessionId, pings: PingData[] }
```

### 2. Prediction Poll (every 25 seconds + on GPS fix + on shadow map update)

```
PredictionService.fetchTarget()
  │
  ├─► GuardTierService.evaluate({ connectionType, downlinkMbps, bufferLevelSec, recentStallCount })
  │     Checks three fast-pass rules (all must pass to block Oracle):
  │       • connection is 4g/wifi
  │       • downlink > threshold
  │       • buffer > threshold
  │       • no recent stalls
  │     Returns: { pass: boolean }
  │     If pass → return (no backend call, keep current target)
  │
  └─► (if guard fails) HTTP POST /api/genabr/decision
        Body: {
          lat, lng, heading, speed_kmh,
          recent_downlinks,           ← downlinkHistory[]
          recent_rtts,                ← rttHistory[]        NEW
          connection_type,            ← connectionType       NEW
          session_id, bitrate_kbps, bandwidth_mbps
        }
        On response:
          targetSubject.next(result.buffer_target)
          inferenceSubject.next(result)
          If recommendation !== 'normal' → genabrWasActive = true
```

### 3. Backend Decision Endpoint: `POST /api/genabr/decision`

```
genabrDecisionController(req, res)
  │
  ├─► redisService.get(CK.genabrEnabled())
  │     If false → return { enabled: false }  (admin killed GenABR)
  │
  ├─► Destructures req.body:
  │     { lat, lng, heading, speed_kmh, recent_downlinks, session_id,
  │       bitrate_kbps, bandwidth_mbps,
  │       recent_rtts,      ← NEW
  │       connection_type } ← NEW
  │
  └─► runInference(lat, lng, heading, speedKmh, recentDownlinks, userId,
                   sessionId, bitrateKbps, bandwidthMbps,
                   recentRtts, connectionType)
```

### 4. Core Inference: `runInference()` in inferenceEngine.service.ts

```
runInference(lat, lng, heading, speedKmh, recentDownlinks, userId,
             sessionId, bitrateKbps, bandwidthMbps, recentRtts, connectionType)
  │
  ├─► computeBufferTarget(lat, lng, heading, speedKmh, bitrateKbps, bandwidthMbps)
  │     → coneResult: { risk_score (spatial), branches, corridor, ... }
  │
  ├─► computeNetworkDelta(recentDownlinks, recentRtts, connectionType)  ← NEW
  │     Internally calls computeNetworkTrend() on downlinks and RTTs
  │     Returns: { delta: number, factors: string[] }
  │
  ├─► adjustedRisk = clamp(coneResult.risk_score + networkDelta, 0, 1)
  │     effectiveCone = { ...coneResult, risk_score: adjustedRisk, ...riskToBuffer(adjustedRisk) }
  │
  ├─► studentConfidence(adjustedRisk)
  │     Measures distance from decision boundaries (0.20, 0.45)
  │     Returns confidence in [0, 1]
  │
  ├─► If confidence ≥ 0.60 → return Student result immediately
  │     (oracle_reason: "network_overlay(...)" if delta was non-zero)
  │
  ├─► oracleAllowed(userId) — rate limit check (10 calls/min per user)
  │     If over limit → return Student result with oracle_reason: 'rate_limited'
  │
  ├─► redisService.get(CK.oracleResult(userId, tileId))
  │     If cached → return Oracle result immediately (tier_used: 'oracle')
  │
  └─► fireOracleAsync(lat, lng, speedKmh, recentDownlinks, adjustedRisk,
                      confidence, branches, userId, sessionId, cacheKey,
                      corridor, recentRtts, connectionType)   ← NEW params
        Return Student result with oracle_pending: true
```

### 5. Spatial Risk: `computeBufferTarget()` in predictionCone.service.ts

```
computeBufferTarget(lat, lng, heading, speedKmh, bitrateKbps, bandwidthMbps)
  │
  ├─► If speedKmh < 2 (stationary):
  │     Returns a default mid-range risk (~0.412) with no corridor scan
  │     NOTE: This is a known limitation — no spatial prediction without movement
  │           The Network Overlay in runInference() compensates for stationary users
  │
  ├─► Generates prediction cone branches (every 10° from -30° to +30°)
  │     For each branch:
  │       ├─► Project GPS positions at t=5,10,15,...,60s
  │       ├─► tileId(lat, lng) for each position
  │       └─► RadioMapCache.findOne(tile_id) → signal quality lookup
  │
  ├─► runCorridorScanner(lat, lng, heading, speedKmh, bitrateKbps, bandwidthMbps)
  │     Projects 200m steps up to 5km
  │     Returns: { has_dead_zone, entry_seconds, duration_seconds, feasible }
  │
  └─► Returns: BufferTarget { risk_score, max_buffer_length, max_max_buffer_length,
                              recommendation, branches, corridor }
```

### 6. OLS Trend + Network Delta: `computeNetworkTrend()` and `computeNetworkDelta()`

```
computeNetworkTrend(values: number[])
  │
  ├─► OLS: computes slope (Mbps/sample) + std dev (volatility)
  │     slope < -0.15 → direction: 'degrading'
  │     slope >  0.15 → direction: 'improving'
  │     else          → direction: 'stable'
  └─► Returns: { slope, volatility, direction }

computeNetworkDelta(recentDownlinks, recentRtts, connectionType)
  │
  ├─► computeNetworkTrend(recentDownlinks) → apply downlink slope + volatility adjustments
  ├─► Latest RTT level check → apply RTT spike adjustments
  ├─► computeNetworkTrend(recentRtts) → apply RTT trend adjustments
  ├─► connectionType check → apply 2G/3G penalty
  └─► Returns: { delta: clamp(sum, -0.20, +0.50), factors: string[] }
```

### 7. Background Oracle: `fireOracleAsync()`

```
fireOracleAsync(lat, lng, speedKmh, recentDownlinks, riskScore, confidence,
                branches, userId, sessionId, cacheKey, corridor,
                recentRtts, connectionType)   ← NEW
  │  (runs in background — HTTP response already sent before this completes)
  │
  ├─► heuristicAdjust(riskScore, speedKmh, recentDownlinks)
  │     Speed penalty: highway +0.08, urban +0.04
  │     OLS trend penalty: degrading +0.12, improving -0.05   ← NOW USES OLS
  │     Peak hours penalty: +0.05
  │
  ├─► getTileContext(lat, lng) → RadioMapCache lookup for historical stats
  │
  ├─► buildPrompt(riskScore, confidence, branches, tile, speedKmh,
  │               recentDownlinks, recentRtts, connectionType)   ← NEW params
  │     Prompt now includes:
  │       • Recent RTT history + latest RTT classification
  │       • Connection type
  │       • Network delta factors (what drove the risk adjustment)
  │
  ├─► callLLMOracle(prompt) → GPT-4o-mini  (or heuristic fallback if API down)
  │     Returns: { adjusted_risk, recommendation, confidence, reasoning }
  │
  ├─► redisService.set(cacheKey, result, TTL.oracleResult)  ← ready for next cycle
  │
  └─► OracleDecision.create({ ...all fields... })  ← MongoDB audit log
```

### 8. HLS.js Integration: `VideoPlayerComponent`

```
HLS.js events → VideoPlayerComponent
  │
  ├─► LEVEL_SWITCHED
  │     reason = genabrForcedLevel ? 'genabr_override'
  │            : userManualLevel   ? 'user_manual'
  │            : 'abr_auto'
  │     telemetry.updateBitrate(newKbps, reason)
  │       → if changed: POST /api/telemetry/bitrate-switch
  │
  ├─► ERROR (buffer stall detected)
  │     telemetry.reportStall(durationMs)
  │       → prediction.notifyStall()   (increments stall counter for Guard tier)
  │       → POST /api/telemetry/stall
  │
  └─► PredictionService.bufferTargetChanged$ (subscription)
        If recommendation changes:
          ├─► hls.config.maxBufferLength     = target.max_buffer_length
          ├─► hls.config.maxMaxBufferLength  = target.max_max_buffer_length
          └─► If 'prebuffer_aggressive':
                genabrForcedLevel = true
                hls.nextLevel = stepDownIndex  ← proactive quality drop
              If 'normal' (2 consecutive cycles):
                hls.nextLevel = -1             ← hand back to HLS.js ABR
```

### 9. Session End Pipeline

```
TelemetryService.stopSession()
  │
  ├─► flushPings(sessionId)  ← send any remaining buffered pings
  │
  └─► PATCH /api/telemetry/session/:id/end  { genabr_active: boolean }
        │
        └─► qoe.service.computeQoE(sessionId)
              │
              ├─► Aggregates bitrate switches → avgVMAF, σVMAF (VMAF variance)
              ├─► Counts stall events → N_stall, T_stall_sec
              ├─► Calculates Φ score
              ├─► Calculates rebuffer_ratio, min/max buffer stats
              └─► StreamingSession.findByIdAndUpdate({ ...qoe fields })
                    │
                    └─► shadowMap.ingestSession(sessionId)
                          For each ping in session:
                            RadioMapCache.updateOne(tileId, { running stats })
```

---

## Current Limitations

### 1. GPS Dependency for Spatial Features
The corridor scanner, dead zone prediction, and speed categorisation all require GPS. On laptops and desktops, `navigator.geolocation` either returns null or provides a rough IP-based location that doesn't move. The **Network Overlay** (RTT + connection type + signal trend) now provides meaningful risk adjustments for stationary users even without spatial prediction, but the corridor scanner and branch cone require real movement to be useful.

### 2. VMAF is Estimated, Not Measured
VMAF is computed from bitrate using a static lookup table, not from actual video frame analysis. Real VMAF requires decoding video frames and running a perceptual model (e.g. Netflix's VMAF library), which is expensive on the client and impractical for mobile. The estimation is a reasonable proxy but won't match ground-truth VMAF for content-specific quality differences (e.g. a still documentary vs a fast-action sport clip at the same bitrate).

### 3. Shadow Map is Sparse Until Populated
The dead zone map starts empty. It only becomes useful after enough users have streamed through an area and their stall events have been ingested. In areas with no prior sessions, the cone always scores low risk regardless of actual network quality. The Network Overlay partially compensates (RTT and connection type are always live), but tile-based spatial prediction is not useful out of the box in new regions.

### 4. Φ Score is Session-Duration-Sensitive
The Φ formula divides by session duration. A 2-minute session with good quality scores higher than a 10-minute session with the same quality, because the cost denominator is smaller. This makes short test sessions artificially inflate Φ. For fair comparison, sessions should be filtered to a minimum duration (recommended: 5+ minutes) or this normalisation should be noted in the methodology.

### 5. Stationary Spatial Prediction Returns a Fixed Score
When `speedKmh < 2`, `computeBufferTarget()` returns a constant default risk (~0.412) because the prediction cone requires trajectory to scan future tiles. The **Network Overlay** (`computeNetworkDelta`) is specifically designed to compensate: RTT spikes, 2G connections, and degrading downlink signals will push the effective risk above 0.412 for stationary users experiencing real network problems, triggering `prebuffer_moderate` or `prebuffer_aggressive` as appropriate. However, the corridor scanner and dead zone entry prediction remain unavailable without movement.

### 6. No Live A/B Testing Within a Session
GenABR is either fully ON or OFF per the admin toggle — there is no per-user split. The comparison data (with/without GenABR) is collected across different time windows rather than simultaneous control/treatment groups. This is a methodological limitation for research purposes. True A/B testing would require randomly assigning individual sessions to GenABR or standard ABR at session creation time.

### 7. HLS.js Buffer Cap Doesn't Flush Existing Buffer
When GenABR reduces `maxBufferLength` (on recovery), HLS.js does not flush the existing buffer — it simply stops fetching new segments until the buffer drains naturally through playback. This means there's a lag of up to `current_buffer_length` seconds before HLS.js resumes fetching at the new (lower) target. This is HLS.js behaviour and cannot be overridden without destructive player intervention.

### 8. Network Information API is Not Universal
`navigator.connection` (downlink, rtt, connection type) is a Chrome/Android API. Safari and Firefox do not support it. On unsupported browsers, `downlink_mbps`, `rtt_ms`, and `connection_type` are always null, which degrades the Network Overlay's risk adjustments and prevents the Guard tier from using signal strength as a quick-pass criterion. On these browsers, GenABR falls back to spatial-only prediction.

### 9. DevTools Network Throttling Does Not Affect GenABR Network Signals
`navigator.connection` reads OS-level network information. Browser DevTools network throttling is applied at the browser's fetch layer, after the OS reports the connection. Therefore, artificially throttling the network in DevTools will NOT change `downlink_mbps`, `rtt_ms`, or `connection_type` — these remain at the real OS values. To test GenABR's network overlay behaviour, real network condition changes (switching from WiFi to cellular, or actual bandwidth reduction at the router/OS level) are required.

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

### 7. Dynamic Risk for Stationary Users via Network Overlay
Prior to the Network Overlay, stationary devices always received the same spatial risk score (~0.412) regardless of network conditions. The `computeNetworkDelta()` function now provides a meaningful, dynamic risk adjustment based on live RTT, connection type, and OLS-detected signal trends. A stationary device on a degrading 3G connection with high RTT will now correctly trigger aggressive prebuffering without needing to move.

### 8. Accurate Trend Detection via OLS Regression
The previous trend detector computed `last − first` across the downlink history window and required a >2 Mbps change to trigger — a threshold that was never reached in typical network fluctuations (0.35–1.3 Mbps range). The OLS slope approach detects gradual or plateau-then-drop degradation patterns at a sensitivity of 0.15 Mbps/sample, making it responsive to real-world signal variations.

### 9. Graceful Degradation
- No GPS → Network Overlay still provides dynamic risk adjustments
- No Network Information API → Guard tier passes, Student handles spatial-only prediction
- Redis down → Oracle caching disabled, falls back to Student on every cycle
- OpenAI API down → heuristic fallback provides a deterministic decision
- GenABR admin toggle OFF → standard HLS.js takes over seamlessly

The system never crashes the player. Every failure mode has a defined fallback.

### 10. Demonstrates a Novel Research Claim
The combination of spatial dead zone prediction + LLM reasoning + proactive buffer management + live network signal overlay is not present in any existing open ABR implementation (BOLA, Pensieve, RobustMPC, etc.). GenABR specifically addresses the "last-mile mobility problem" — the quality degradation that occurs when mobile users move through areas of variable cellular coverage — which existing systems don't model.

---

## Data Flow Summary

```
User watches video on mobile
        │
        ├─► GPS + network sampled every 4s (TelemetryService.collectPing)
        │         │
        │         ├─► conn.rtt passed to PredictionService.updateNetworkContext()  ← NEW
        │         │     rttHistory[] maintained (last 5)
        │         ▼
        │   Change detection filter (shouldPush)
        │         │
        │         ▼
        │   Batch buffer (10 pings)
        │         │
        │         ▼
        │   POST /telemetry/pings ──► MongoDB TelemetryPing collection
        │
        ├─► Every 25s: POST /genabr/decision
        │     Body now includes: recent_rtts[], connection_type  ← NEW
        │         │
        │         ▼
        │   Guard tier (local check — no backend call if network clearly fine)
        │         │ (if uncertain)
        │         ▼
        │   computeBufferTarget → spatial risk from Prediction Cone + Corridor Scanner
        │         │
        │         ▼
        │   computeNetworkDelta → RTT + trend + connection overlay  ← NEW
        │         │
        │         ▼
        │   effectiveRisk = clamp(spatialRisk + networkDelta, 0, 1)  ← NEW
        │         │
        │         ├─► (confidence ≥ 60%) → Student answer returned with network overlay
        │         │
        │         └─► (confidence < 60%) → Student answer returned immediately
        │                                   + Oracle fires in background
        │                                   + Oracle prompt includes RTT + connection  ← NEW
        │                                   + Oracle result cached in Redis (5 min)
        │                                   + Oracle result applied next cycle
        │
        ├─► HLS.js reads buffer target
        │         │
        │         ├─► maxBufferLength adjusted
        │         └─► hls.nextLevel forced down (if aggressive) ──► LEVEL_SWITCHED event
        │                                                              │
        │                                                              ▼
        │                                            reason = genabr_override | user_manual | abr_auto
        │                                                              │
        │                                                              ▼
        │                                                    POST /telemetry/bitrate-switch
        │
        └─► Session end: PATCH /telemetry/session/:id/end
                  │
                  ▼
          qoe.service: computes avgVMAF, σVMAF, Φ score,
                       buffer stats, movement type
                  │
                  ▼
          StreamingSession updated in MongoDB
                  │
                  ▼
          Shadow Map tiles updated from session pings (radioMapCache)
```

---

## Changelog

| Date | Change |
|---|---|
| April 2026 | Lambda parallelisation: orchestrator + renditionWorker + aiWorker. 360p/720p/1080p + AI now transcode in parallel. Processing time reduced from ~180s to ~145s. |
| April 2026 | Added `computeNetworkTrend()` — OLS linear regression slope replaces broken `last−first` delta for downlink trend detection. |
| April 2026 | Added `computeNetworkDelta()` — live network overlay applied on top of spatial risk score. RTT spikes, connection type penalty, signal volatility now contribute to the risk score. |
| April 2026 | Threaded `recent_rtts[]` and `connection_type` through telemetry → prediction service → POST body → controller → `runInference()` → Oracle prompt. |
| April 2026 | Fixed `user_manual` bitrate switches being misclassified as `abr_auto`. Added `_userManualLevel` flag to `VideoPlayerComponent`. |
| April 2026 | Oracle prompt expanded with RTT history, connection type, and network delta factors section. |

---

*Generated: April 2026 — StreamSphere / GenABR research project*
