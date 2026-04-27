import { computeBufferTarget, BufferTarget, BranchResult } from './predictionCone.service';
import { RadioMapCache } from '../models/radioMapCache';
import { OracleDecision } from '../models/oracleDecision';
import { tileId } from '../utils/geo';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InferenceResult {
  buffer_target:    BufferTarget;
  tier_used:        'guard' | 'student' | 'oracle';
  confidence:       number;
  oracle_triggered: boolean;
  oracle_reason:    string | null;
  oracle_reasoning: string | null;   // full LLM explanation (research use)
}

// ── OpenAI client (dynamic require — avoids ESM/CJS issues at module load time) ─

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _openai: any = null;
function getOpenAI(): any {
  if (!_openai) {
    // Dynamic require so the openai package is only loaded when Oracle fires,
    // not at server startup — prevents ESM/CJS conflicts on Vercel cold starts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAI = require('openai').default ?? require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── Oracle rate limiter (in-memory, per-user, 10 calls/min) ──────────────────

const oracleCallLog = new Map<string, number[]>();
const ORACLE_MAX_PER_MIN = 10;

function oracleAllowed(userId: string): boolean {
  const now   = Date.now();
  const calls = (oracleCallLog.get(userId) ?? []).filter(t => now - t < 60_000);
  if (calls.length >= ORACLE_MAX_PER_MIN) return false;
  calls.push(now);
  oracleCallLog.set(userId, calls);
  return true;
}

// ── Student confidence scoring ────────────────────────────────────────────────
// Oracle is triggered when risk is near a decision boundary (Student uncertain).

const BOUNDARY_1 = 0.20;
const BOUNDARY_2 = 0.45;
const HALF_ZONE  = 0.125;

function studentConfidence(riskScore: number): number {
  const d1 = Math.abs(riskScore - BOUNDARY_1);
  const d2 = Math.abs(riskScore - BOUNDARY_2);
  return Math.min(Math.min(d1, d2) / HALF_ZONE, 1.0);
}

// ── Heuristic fallback (used when LLM call fails) ────────────────────────────

function heuristicAdjust(
  riskScore:       number,
  speedKmh:        number,
  recentDownlinks: number[],
): { adjustedRisk: number; reason: string } {
  let risk = riskScore;
  const reasons: string[] = [];

  if (speedKmh > 80)       { risk += 0.08; reasons.push('highway_speed'); }
  else if (speedKmh > 40)  { risk += 0.04; reasons.push('urban_speed'); }

  if (recentDownlinks.length >= 3) {
    const recent = recentDownlinks.slice(-3);
    const trend  = recent[recent.length - 1] - recent[0];
    if (trend < -2)  { risk += 0.12; reasons.push('signal_degrading'); }
    else if (trend > 2) { risk = Math.max(0, risk - 0.05); reasons.push('signal_recovering'); }
  }

  const h = new Date().getUTCHours();
  if ((h >= 7 && h <= 9) || (h >= 17 && h <= 20)) {
    risk += 0.05; reasons.push('peak_hours');
  }

  return {
    adjustedRisk: Math.min(Math.max(risk, 0), 1),
    reason: reasons.join('+') || 'no_adjustment',
  };
}

function riskToBuffer(risk: number): Pick<
  BufferTarget, 'max_buffer_length' | 'max_max_buffer_length' | 'recommendation'
> {
  if (risk >= 0.45) return { max_buffer_length: 30, max_max_buffer_length: 60, recommendation: 'prebuffer_aggressive' };
  if (risk >= 0.20) return { max_buffer_length: 20, max_max_buffer_length: 45, recommendation: 'prebuffer_moderate' };
  return                  { max_buffer_length: 10, max_max_buffer_length: 30, recommendation: 'normal' };
}

// ── Tile context lookup ───────────────────────────────────────────────────────

interface TileContext {
  tile_id:         string;
  sample_count:    number | null;
  avg_downlink:    number | null;
  avg_rtt:         number | null;
  signal_variance: number | null;
  avg_buffer_sec:  number | null;
  peak_downlink:   number | null;
  fused_score:     number | null;
}

async function getTileContext(lat: number, lng: number): Promise<TileContext> {
  const id  = tileId(lat, lng);
  const doc = await RadioMapCache.findOne({ tile_id: id }, {
    sample_count: 1, avg_downlink_mbps: 1, avg_rtt_ms: 1,
    signal_variance: 1, avg_buffer_sec: 1, fused_score: 1,
    peak_stats: 1,
  }).lean() as any;

  return {
    tile_id:         id,
    sample_count:    doc?.sample_count    ?? null,
    avg_downlink:    doc?.avg_downlink_mbps ?? null,
    avg_rtt:         doc?.avg_rtt_ms      ?? null,
    signal_variance: doc?.signal_variance ?? null,
    avg_buffer_sec:  doc?.avg_buffer_sec  ?? null,
    peak_downlink:   doc?.peak_stats?.avg_downlink_mbps ?? null,
    fused_score:     doc?.fused_score     ?? null,
  };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(
  riskScore:       number,
  confidence:      number,
  branches:        BranchResult[],
  tile:            TileContext,
  speedKmh:        number,
  recentDownlinks: number[],
): string {
  const h = new Date().getUTCHours();
  const isPeak = (h >= 7 && h <= 9) || (h >= 17 && h <= 20);

  // Describe downlink trend
  let trend = 'stable';
  if (recentDownlinks.length >= 2) {
    const delta = recentDownlinks[recentDownlinks.length - 1] - recentDownlinks[0];
    if (delta < -2)      trend = 'degrading fast';
    else if (delta < -0.5) trend = 'degrading slowly';
    else if (delta > 2)  trend = 'recovering fast';
    else if (delta > 0.5)  trend = 'recovering slowly';
  }

  // Summarise prediction cone branches
  const branchSummary = branches.map(b => {
    const dir = b.heading_offset === 0 ? 'straight'
      : b.heading_offset < 0 ? `${Math.abs(b.heading_offset)}° left`
      : `${b.heading_offset}° right`;
    const tileCoverages = b.points.map(p =>
      `  t+${p.seconds}s: tile=${p.tile_id.split(':').slice(1).join(',')}, coverage=${p.coverage.toFixed(2)}`,
    ).join('\n');
    return `Branch [${dir}, prob=${b.probability}] risk=${b.branch_risk.toFixed(3)}\n${tileCoverages}`;
  }).join('\n\n');

  return `
You are the Oracle tier of GenABR — a Generative-Contextual Adaptive Bitrate Streaming research system.
Your job: decide the optimal HLS buffer pre-loading strategy when the statistical model is uncertain.

══ PREDICTION CONE (next 90 seconds of travel) ══
Composite risk score: ${riskScore.toFixed(3)}  (Student confidence: ${(confidence * 100).toFixed(0)}% — too low, hence calling you)
Speed: ${speedKmh.toFixed(1)} km/h | UTC hour: ${h} (${isPeak ? '⚠ PEAK hours — higher congestion' : 'off-peak'})

${branchSummary}

══ CURRENT TILE OBSERVED STATS (${tile.sample_count ?? 0} real sessions) ══
Avg downlink : ${tile.avg_downlink !== null ? tile.avg_downlink.toFixed(2) + ' Mbps' : 'no data'}
Peak downlink: ${tile.peak_downlink !== null ? tile.peak_downlink.toFixed(2) + ' Mbps (peak hours)' : 'no data'}
Avg RTT      : ${tile.avg_rtt !== null ? tile.avg_rtt.toFixed(0) + ' ms' : 'no data'}
Signal var.  : ${tile.signal_variance !== null ? tile.signal_variance.toFixed(3) + ' (higher = unstable)' : 'no data'}
Avg buffer   : ${tile.avg_buffer_sec !== null ? tile.avg_buffer_sec.toFixed(1) + 's buffered historically' : 'no data'}
Fused score  : ${tile.fused_score !== null ? tile.fused_score.toFixed(3) : 'no data'} (0=dead zone, 1=excellent)

══ LIVE NETWORK READINGS ══
Recent downlinks: [${recentDownlinks.map(d => d.toFixed(1)).join(', ')} Mbps] — trend: ${trend}

══ YOUR TASK ══
The Student tier is uncertain (risk ${riskScore.toFixed(3)} is near a decision boundary).
Using ALL context above — spatial coverage ahead, observed tile history, live signal trend, speed, time —
determine the correct buffer pre-loading strategy.

Decision thresholds:
  normal             → risk < 0.20  (max_buffer=10s, max_max_buffer=30s)
  prebuffer_moderate → risk 0.20–0.45 (max_buffer=20s, max_max_buffer=45s)
  prebuffer_aggressive → risk ≥ 0.45 (max_buffer=30s, max_max_buffer=60s)

Respond with ONLY valid JSON (no markdown):
{
  "adjusted_risk": <0.0–1.0>,
  "recommendation": <"normal"|"prebuffer_moderate"|"prebuffer_aggressive">,
  "max_buffer_length": <10|20|30>,
  "max_max_buffer_length": <30|45|60>,
  "confidence": <0.0–1.0>,
  "reasoning": "<concise explanation of key factors that drove your decision, max 2 sentences>"
}`.trim();
}

// ── LLM Oracle ────────────────────────────────────────────────────────────────

interface LLMDecision {
  adjusted_risk:          number;
  recommendation:         'normal' | 'prebuffer_moderate' | 'prebuffer_aggressive';
  max_buffer_length:      number;
  max_max_buffer_length:  number;
  confidence:             number;
  reasoning:              string;
}

async function callLLMOracle(prompt: string): Promise<{
  decision: LLMDecision;
  promptTokens: number;
  completionTokens: number;
}> {
  const openai   = getOpenAI();
  const response = await openai.chat.completions.create({
    model:       'gpt-4o-mini',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.2,       // low temperature — this is a deterministic decision task
    max_tokens:  300,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as LLMDecision;

  // Validate + clamp
  const risk = Math.min(Math.max(Number(parsed.adjusted_risk ?? 0.3), 0), 1);
  const rec  = (['normal', 'prebuffer_moderate', 'prebuffer_aggressive'] as const)
    .includes(parsed.recommendation as any)
    ? parsed.recommendation
    : riskToBuffer(risk).recommendation;

  return {
    decision: {
      adjusted_risk:         risk,
      recommendation:        rec,
      max_buffer_length:     Number(parsed.max_buffer_length)     || riskToBuffer(risk).max_buffer_length,
      max_max_buffer_length: Number(parsed.max_max_buffer_length) || riskToBuffer(risk).max_max_buffer_length,
      confidence:            Math.min(Math.max(Number(parsed.confidence ?? 0.7), 0), 1),
      reasoning:             String(parsed.reasoning ?? ''),
    },
    promptTokens:     response.usage?.prompt_tokens     ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runInference(
  lat:             number,
  lng:             number,
  heading:         number,
  speedKmh:        number,
  recentDownlinks: number[] = [],
  userId           = 'anon',
  sessionId:       string | null = null,
): Promise<InferenceResult> {

  // Phase 4: prediction cone → raw risk
  const coneResult = await computeBufferTarget(lat, lng, heading, speedKmh);
  const riskScore  = coneResult.risk_score;

  // Student confidence
  const confidence = studentConfidence(riskScore);

  if (confidence >= 0.60) {
    return {
      buffer_target:    coneResult,
      tier_used:        'student',
      confidence,
      oracle_triggered: false,
      oracle_reason:    null,
      oracle_reasoning: null,
    };
  }

  // Rate limit check
  if (!oracleAllowed(userId)) {
    return {
      buffer_target:    coneResult,
      tier_used:        'student',
      confidence,
      oracle_triggered: false,
      oracle_reason:    'rate_limited',
      oracle_reasoning: null,
    };
  }

  // Heuristic baseline (always computed so we can compare with LLM)
  const heuristic = heuristicAdjust(riskScore, speedKmh, recentDownlinks);
  const heuristicRec = riskToBuffer(heuristic.adjustedRisk).recommendation;

  // Fetch tile context for the LLM
  const tile   = await getTileContext(lat, lng);
  const prompt = buildPrompt(riskScore, confidence, coneResult.branches, tile, speedKmh, recentDownlinks);

  let llmFailed = false;
  let fallbackReason: string | null = null;
  let decision: LLMDecision;
  let promptTokens    = 0;
  let completionTokens = 0;

  try {
    const result     = await callLLMOracle(prompt);
    decision         = result.decision;
    promptTokens     = result.promptTokens;
    completionTokens = result.completionTokens;
  } catch (err: any) {
    // LLM failed → fall back to heuristic silently
    llmFailed      = true;
    fallbackReason = err?.message ?? 'unknown_error';
    const heuristicBuffer = riskToBuffer(heuristic.adjustedRisk);
    decision = {
      adjusted_risk:         heuristic.adjustedRisk,
      recommendation:        heuristicBuffer.recommendation,
      max_buffer_length:     heuristicBuffer.max_buffer_length,
      max_max_buffer_length: heuristicBuffer.max_max_buffer_length,
      confidence:            0.5,
      reasoning:             `LLM unavailable; heuristic fallback: ${heuristic.reason}`,
    };
  }

  // Log to MongoDB (fire-and-forget — never block the response)
  OracleDecision.create({
    session_id:            sessionId,
    timestamp:             new Date(),
    lat, lng, speed_kmh:   speedKmh,
    student_risk:          riskScore,
    student_conf:          confidence,
    tile_id:               tile.tile_id,
    tile_sample_count:     tile.sample_count,
    tile_avg_downlink:     tile.avg_downlink,
    tile_signal_variance:  tile.signal_variance,
    model_used:            llmFailed ? 'heuristic_fallback' : 'gpt-4o-mini',
    prompt_tokens:         promptTokens    || null,
    completion_tokens:     completionTokens || null,
    oracle_risk:           decision.adjusted_risk,
    recommendation:        decision.recommendation,
    reasoning:             decision.reasoning,
    oracle_confidence:     decision.confidence,
    heuristic_recommendation: heuristicRec,
    diverged:              decision.recommendation !== heuristicRec,
    llm_failed:            llmFailed,
    fallback_reason:       fallbackReason,
  }).catch(() => {});   // log failure must never break inference

  const oracleTarget: BufferTarget = {
    ...coneResult,
    risk_score:            decision.adjusted_risk,
    max_buffer_length:     decision.max_buffer_length,
    max_max_buffer_length: decision.max_max_buffer_length,
    recommendation:        decision.recommendation,
  };

  return {
    buffer_target:    oracleTarget,
    tier_used:        'oracle',
    confidence:       decision.confidence,
    oracle_triggered: true,
    oracle_reason:    llmFailed ? `llm_failed:${fallbackReason}` : heuristic.reason,
    oracle_reasoning: decision.reasoning,
  };
}

// ── Force Oracle for testing ──────────────────────────────────────────────────
// Bypasses Student confidence gate — calls LLM directly with a mock risk score
// placed on a boundary (default 0.22) to simulate an ambiguous scenario.

export async function forceOracleTest(
  lat:             number,
  lng:             number,
  speedKmh:        number,
  recentDownlinks: number[],
  mockRisk:        number,
): Promise<InferenceResult & { test_mode: true; mock_risk: number }> {

  const coneResult  = await computeBufferTarget(lat, lng, 0, speedKmh);
  // Override the real risk with the mock value so Oracle always fires
  const mockCone    = { ...coneResult, risk_score: mockRisk };
  const confidence  = studentConfidence(mockRisk);

  const heuristic    = heuristicAdjust(mockRisk, speedKmh, recentDownlinks);
  const heuristicRec = riskToBuffer(heuristic.adjustedRisk).recommendation;
  const tile         = await getTileContext(lat, lng);
  const prompt       = buildPrompt(mockRisk, confidence, coneResult.branches, tile, speedKmh, recentDownlinks);

  let llmFailed      = false;
  let fallbackReason: string | null = null;
  let decision: LLMDecision;
  let promptTokens = 0, completionTokens = 0;

  try {
    const result     = await callLLMOracle(prompt);
    decision         = result.decision;
    promptTokens     = result.promptTokens;
    completionTokens = result.completionTokens;
  } catch (err: any) {
    llmFailed      = true;
    fallbackReason = err?.message ?? 'unknown_error';
    const heuristicBuffer = riskToBuffer(heuristic.adjustedRisk);
    decision = {
      adjusted_risk: heuristic.adjustedRisk,
      recommendation: heuristicBuffer.recommendation,
      max_buffer_length: heuristicBuffer.max_buffer_length,
      max_max_buffer_length: heuristicBuffer.max_max_buffer_length,
      confidence: 0.5,
      reasoning: `LLM unavailable; heuristic fallback: ${heuristic.reason}`,
    };
  }

  // Log to oracle_decisions with test flag in reasoning
  OracleDecision.create({
    session_id: null, timestamp: new Date(),
    lat, lng, speed_kmh: speedKmh,
    student_risk: mockRisk, student_conf: confidence,
    tile_id: tile.tile_id, tile_sample_count: tile.sample_count,
    tile_avg_downlink: tile.avg_downlink, tile_signal_variance: tile.signal_variance,
    model_used: llmFailed ? 'heuristic_fallback' : 'gpt-4o-mini',
    prompt_tokens: promptTokens || null, completion_tokens: completionTokens || null,
    oracle_risk: decision.adjusted_risk, recommendation: decision.recommendation,
    reasoning: `[TEST] ${decision.reasoning}`,
    oracle_confidence: decision.confidence,
    heuristic_recommendation: heuristicRec,
    diverged: decision.recommendation !== heuristicRec,
    llm_failed: llmFailed, fallback_reason: fallbackReason,
  }).catch(() => {});

  return {
    test_mode:        true,
    mock_risk:        mockRisk,
    buffer_target:    { ...mockCone, risk_score: decision.adjusted_risk, ...riskToBuffer(decision.adjusted_risk) },
    tier_used:        'oracle',
    confidence:       decision.confidence,
    oracle_triggered: true,
    oracle_reason:    llmFailed ? `llm_failed:${fallbackReason}` : heuristic.reason,
    oracle_reasoning: decision.reasoning,
  };
}
