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
