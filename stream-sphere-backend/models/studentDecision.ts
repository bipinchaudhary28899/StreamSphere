import mongoose, { Schema, Document } from 'mongoose';

/**
 * StudentDecision — logged on every prediction cycle answered by the Student
 * tier (confidence ≥ 60%) or returned with oracle_pending: true.
 *
 * Complements OracleDecision: together they give a complete picture of every
 * GenABR decision made in a session, regardless of which tier handled it.
 *
 * Key research use-case: see network degradation events (signal_degrading,
 * conn_2g, rtt_critical, etc.) that Student handled confidently and Oracle
 * never saw — previously invisible in the dashboard.
 *
 * TTL: 30 days (2_592_000 seconds), same as OracleDecision.
 */

export interface IStudentDecision extends Document {
  session_id:       string | null;
  timestamp:        Date;

  // ── Location + motion ─────────────────────────────────────────────────────
  lat:              number;
  lng:              number;
  speed_kmh:        number;
  speed_category:   string;

  // ── Risk breakdown ────────────────────────────────────────────────────────
  spatial_risk:     number;   // raw risk from Prediction Cone (before overlay)
  network_delta:    number;   // signed adjustment from computeNetworkDelta
  network_factors:  string[]; // e.g. ['conn_2g', 'rtt_critical(>1000ms)']
  effective_risk:   number;   // spatial_risk + network_delta, clamped [0,1]

  // ── Decision ──────────────────────────────────────────────────────────────
  recommendation:   string;   // 'normal' | 'prebuffer_moderate' | 'prebuffer_aggressive'
  confidence:       number;   // Student confidence 0–1

  // ── Network snapshot ──────────────────────────────────────────────────────
  connection_type:  string | null;
  latest_downlink:  number | null;  // Mbps
  latest_rtt:       number | null;  // ms

  // ── Meta ──────────────────────────────────────────────────────────────────
  oracle_pending:   boolean;  // true = Oracle was fired async this same cycle
}

const studentDecisionSchema = new Schema<IStudentDecision>(
  {
    session_id:      { type: String,  default: null, index: true },
    timestamp:       { type: Date,    required: true },
    lat:             { type: Number,  required: true },
    lng:             { type: Number,  required: true },
    speed_kmh:       { type: Number,  default: 0 },
    speed_category:  { type: String,  default: null },
    spatial_risk:    { type: Number,  required: true },
    network_delta:   { type: Number,  default: 0 },
    network_factors: { type: [String], default: [] },
    effective_risk:  { type: Number,  required: true },
    recommendation:  { type: String,  required: true },
    confidence:      { type: Number,  required: true },
    connection_type: { type: String,  default: null },
    latest_downlink: { type: Number,  default: null },
    latest_rtt:      { type: Number,  default: null },
    oracle_pending:  { type: Boolean, default: false },
  },
  { timestamps: false },
);

// TTL index — auto-delete after 30 days (same as OracleDecision)
studentDecisionSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2_592_000 });

// Query index — fetch by session for per-session research analysis
studentDecisionSchema.index({ session_id: 1, timestamp: 1 });

export const StudentDecision = mongoose.model<IStudentDecision>(
  'StudentDecision',
  studentDecisionSchema,
);
