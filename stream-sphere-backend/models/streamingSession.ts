import mongoose, { Schema, Document } from 'mongoose';

// ── Sub-document interfaces ───────────────────────────────────────────────────
// Pings are no longer embedded — they live in the telemetry_pings collection.
// Stall events and bitrate switches stay embedded: both are infrequent (typically
// 0–20 per session) and will never approach the 16 MB document limit.

interface IStallEvent {
  timestamp:   Date;
  duration_ms: number;
  lat:         number;
  lng:         number;
}

interface IBitrateSwitch {
  timestamp: Date;
  from_kbps: number;
  to_kbps:   number;
  reason:    'abr_auto' | 'genabr_override' | 'user_manual';
}

// ── Main session interface ────────────────────────────────────────────────────

export interface IStreamingSession extends Document {
  session_id:       string;
  user_id:          string | null;
  video_id:         string;
  started_at:       Date;
  ended_at:         Date | null;
  stall_events:     IStallEvent[];
  bitrate_switches: IBitrateSwitch[];

  // ── QoE / VMAF fields ───────────────────────────────────────────────────
  avg_vmaf:         number | null;
  sigma_vmaf:       number | null;
  total_stall_ms:   number;
  genabr_active:    boolean;
  phi_score:        number | null;

  // ── Buffer telemetry (computed from pings at session end) ───────────────
  avg_buffer_sec:   number | null;   // mean buffer level
  min_buffer_sec:   number | null;   // worst-case buffer depth observed
  max_buffer_sec:   number | null;   // peak buffer depth (GenABR target effect)
  // Fraction of pings with buffer_level_sec < 0.5s — proxy for stall risk
  rebuffer_ratio:   number | null;   // 0.0–1.0

  // ── Bitrate telemetry (from pings, not just switches) ───────────────────
  // Variance of raw bitrate_kbps readings — high = unstable ABR decisions
  bitrate_variance: number | null;

  // ── Mobility classification ─────────────────────────────────────────────
  // Derived from median speed_kmh across pings.
  // stationary < 2 km/h | walking 2–10 km/h | driving > 10 km/h
  movement_type:    'stationary' | 'walking' | 'driving' | null;

  // ── GenABR tier usage counters ──────────────────────────────────────────
  // Incremented on every POST /genabr/decision for this session.
  // guard   = Guard tier fast-passed (network clearly fine, no backend call)
  // student = Student tier answered (statistical model, confidence ≥ 60%)
  // oracle  = Oracle tier answered (LLM result — from cache or fresh call)
  tier_counts: {
    guard:   number;
    student: number;
    oracle:  number;
  };

  // ── Per-session inference cost (USD) ────────────────────────────────────
  // Sum of (prompt_tokens × prompt_rate) + (completion_tokens × completion_rate)
  // across all OracleDecision records for this session, computed at session end.
  // Required for Φ score per paper Eq. 9: Φ = (VMAF − α·σ − β·N·T) / C_session
  // For baseline (no Oracle calls), a $0.0001 floor is applied so Φ stays finite.
  oracle_cost_usd:  number | null;

  // ── Route identifier (for "K unique routes" research claim) ─────────────
  // Stable hash derived from start + end GPS tile at session end.
  // Same physical commute → same route_id → enables grouping for analysis.
  route_id:         string | null;
}

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const stallSchema = new Schema<IStallEvent>(
  {
    timestamp:   { type: Date,   required: true },
    duration_ms: { type: Number, required: true },
    lat:         { type: Number, required: true },
    lng:         { type: Number, required: true },
  },
  { _id: false },
);

const switchSchema = new Schema<IBitrateSwitch>(
  {
    timestamp: { type: Date,   required: true },
    from_kbps: { type: Number, required: true },
    to_kbps:   { type: Number, required: true },
    reason: {
      type:    String,
      enum:    ['abr_auto', 'genabr_override', 'user_manual'],
      default: 'abr_auto',
    },
  },
  { _id: false },
);

// ── Main schema ───────────────────────────────────────────────────────────────

const streamingSessionSchema = new Schema<IStreamingSession>(
  {
    session_id:       { type: String,  required: true, unique: true },
    user_id:          { type: String,  default: null },
    video_id:         { type: String,  required: true },
    started_at:       { type: Date,    required: true },
    ended_at:         { type: Date,    default: null },
    stall_events:     [stallSchema],
    bitrate_switches: [switchSchema],
    avg_vmaf:         { type: Number,  default: null },
    sigma_vmaf:       { type: Number,  default: null },
    total_stall_ms:   { type: Number,  default: 0 },
    genabr_active:    { type: Boolean, default: false },
    phi_score:        { type: Number,  default: null },
    avg_buffer_sec:   { type: Number,  default: null },
    min_buffer_sec:   { type: Number,  default: null },
    max_buffer_sec:   { type: Number,  default: null },
    rebuffer_ratio:   { type: Number,  default: null },
    bitrate_variance: { type: Number,  default: null },
    movement_type: {
      type:    String,
      enum:    ['stationary', 'walking', 'driving'],
      default: null,
    },
    tier_counts: {
      guard:   { type: Number, default: 0 },
      student: { type: Number, default: 0 },
      oracle:  { type: Number, default: 0 },
    },
    oracle_cost_usd:  { type: Number,  default: null },
    route_id:         { type: String,  default: null, index: true },
  },
  { timestamps: true },
);

// session_id unique index is already created by { unique: true } on the field above
streamingSessionSchema.index({ user_id: 1, started_at: -1 });
streamingSessionSchema.index({ video_id: 1 });

export const StreamingSession = mongoose.model<IStreamingSession>(
  'StreamingSession',
  streamingSessionSchema,
);
