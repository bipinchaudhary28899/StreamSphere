import mongoose, { Schema, Document } from 'mongoose';

// ── Stores every GenAI Oracle invocation for research analysis ────────────────
// Logged whenever the Student tier is uncertain (confidence < 0.60) and the
// Oracle LLM is called.  Enables offline analysis of when/why the LLM diverges
// from the heuristic and how its decisions correlate with actual QoE outcomes.

export interface IOracleDecision extends Document {
  session_id:       string | null;   // linked session (anon = null)
  timestamp:        Date;
  lat:              number;
  lng:              number;
  speed_kmh:        number;
  speed_category:   string;          // 'stationary' | 'urban' | 'suburban' | 'highway'

  // Student context
  student_risk:     number;          // raw risk score from prediction cone
  student_conf:     number;          // Student confidence (reason Oracle was called)
  oracle_reason:    string | null;   // heuristic adjustments that fired: e.g. "highway_speed+signal_degrading"

  // Tile context passed to the LLM
  tile_id:          string;
  tile_sample_count: number | null;
  tile_avg_downlink: number | null;
  tile_signal_variance: number | null;

  // LLM input / output
  model_used:       string;          // e.g. "gpt-4o-mini"
  prompt_tokens:    number | null;
  completion_tokens: number | null;

  // Decision
  oracle_risk:      number;          // adjusted risk returned by LLM
  recommendation:   string;          // normal / prebuffer_moderate / prebuffer_aggressive
  reasoning:        string;          // LLM's free-text explanation
  oracle_confidence: number;

  // Did LLM diverge from the heuristic baseline?
  heuristic_recommendation: string;  // what the old heuristic would have returned
  diverged:         boolean;

  // Corridor scanner results at the time of this Oracle call
  has_dead_zone:          boolean | null;
  dead_zone_entry_sec:    number | null;   // seconds until dead zone entry
  dead_zone_duration_sec: number | null;   // seconds the dead zone lasts
  corridor_feasible:      boolean | null;  // can we prefetch enough before entering?

  // Error fallback
  llm_failed:       boolean;         // true if OpenAI call threw / timed out
  fallback_reason:  string | null;
}

const oracleDecisionSchema = new Schema<IOracleDecision>(
  {
    session_id:            { type: String, default: null },
    timestamp:             { type: Date,   required: true },
    lat:                   { type: Number, required: true },
    lng:                   { type: Number, required: true },
    speed_kmh:             { type: Number, default: 0 },
    speed_category:        { type: String, default: 'stationary' },

    student_risk:          { type: Number, required: true },
    student_conf:          { type: Number, required: true },
    oracle_reason:         { type: String, default: null },

    tile_id:               { type: String, required: true },
    tile_sample_count:     { type: Number, default: null },
    tile_avg_downlink:     { type: Number, default: null },
    tile_signal_variance:  { type: Number, default: null },

    model_used:            { type: String, required: true },
    prompt_tokens:         { type: Number, default: null },
    completion_tokens:     { type: Number, default: null },

    oracle_risk:           { type: Number, required: true },
    recommendation:        { type: String, required: true },
    reasoning:             { type: String, required: true },
    oracle_confidence:     { type: Number, required: true },

    heuristic_recommendation: { type: String, required: true },
    diverged:              { type: Boolean, required: true },

    has_dead_zone:          { type: Boolean, default: null },
    dead_zone_entry_sec:    { type: Number,  default: null },
    dead_zone_duration_sec: { type: Number,  default: null },
    corridor_feasible:      { type: Boolean, default: null },

    llm_failed:            { type: Boolean, default: false },
    fallback_reason:       { type: String,  default: null },
  },
  { timestamps: false },
);

// Query by session, by time, or scan all Oracle calls for research
oracleDecisionSchema.index({ timestamp: -1 });
oracleDecisionSchema.index({ session_id: 1, timestamp: 1 });
oracleDecisionSchema.index({ diverged: 1, timestamp: -1 });
oracleDecisionSchema.index({ speed_category: 1, timestamp: -1 });
oracleDecisionSchema.index({ recommendation: 1, timestamp: -1 });

// TTL — Oracle logs are research data; keep for 90 days
oracleDecisionSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86_400 * 90 });

export const OracleDecision = mongoose.model<IOracleDecision>(
  'OracleDecision',
  oracleDecisionSchema,
);
