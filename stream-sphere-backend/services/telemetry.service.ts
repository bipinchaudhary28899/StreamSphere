import { randomUUID } from 'crypto';
import { StreamingSession } from '../models/streamingSession';
import { TelemetryPing }    from '../models/telemetryPing';
import { ingestDeadZone }   from './shadowMap.service';
import { finaliseSession }  from './qoe.service';

// ── Session lifecycle ─────────────────────────────────────────────────────────

export async function createSession(
  videoId: string,
  userId:  string | null,
): Promise<string> {
  const sessionId = randomUUID();
  await StreamingSession.create({
    session_id: sessionId,
    user_id:    userId,
    video_id:   videoId,
    started_at: new Date(),
  });
  return sessionId;
}

// ── Ping writes ───────────────────────────────────────────────────────────────

interface PingData {
  timestamp:        Date;
  lat:              number;
  lng:              number;
  speed_kmh:        number;
  heading:          number;
  signal_strength:  number | null;
  downlink_mbps:    number | null;
  rtt_ms:           number | null;
  connection_type:  string | null;
  battery_level:    number | null;
  buffer_level_sec: number | null;
  bitrate_kbps:     number | null;
}

/** Enrich a ping object with the GeoJSON `location` field required by the
 *  2dsphere index.  Coordinates are [lng, lat] per the GeoJSON spec. */
function withLocation(p: PingData): PingData & { location: { type: 'Point'; coordinates: [number, number] } } {
  return { ...p, location: { type: 'Point', coordinates: [p.lng, p.lat] } };
}

/** Single ping — kept for backward-compat with the deprecated /telemetry/ping route */
export async function appendPing(sessionId: string, ping: PingData): Promise<void> {
  await TelemetryPing.create({ session_id: sessionId, ...withLocation(ping) });
}

/** Batch insert — used by the /telemetry/pings route.  insertMany is a single
 *  round-trip regardless of batch size and bypasses Mongoose validation overhead
 *  on individual saves, making it ~10× faster than looped creates. */
export async function appendPings(sessionId: string, pings: PingData[]): Promise<void> {
  if (pings.length === 0) return;
  await TelemetryPing.insertMany(
    pings.map((p) => ({ session_id: sessionId, ...withLocation(p) })),
    { ordered: false },   // partial success on duplicates / validation errors
  );
}

// ── Stall events ──────────────────────────────────────────────────────────────

export async function appendStall(
  sessionId:   string,
  stall:       object,
  signalScore?: number,
): Promise<void> {
  await StreamingSession.updateOne(
    { session_id: sessionId },
    {
      $push: { stall_events: stall },
      $inc:  { total_stall_ms: (stall as any).duration_ms ?? 0 },
    },
  );

  // Auto-ingest dead zone at stall location.
  // Derive signal score from reported downlink if available, otherwise fall
  // back to the passed-in signalScore or a conservative default of 0.15
  // (stalls indicate genuinely bad signal regardless of throughput).
  const s = stall as any;
  if (s.lat != null && s.lng != null) {
    let score: number;
    if (signalScore !== undefined) {
      score = signalScore;
    } else if (s.downlink_mbps != null) {
      score = s.downlink_mbps < 0.20 ? 0.02
            : s.downlink_mbps < 0.50 ? 0.08
            : s.downlink_mbps < 1.00 ? 0.18
            : 0.25;   // stalled despite decent downlink — transient spike
    } else {
      score = 0.15;   // unknown conditions but we know it stalled
    }
    ingestDeadZone(s.lat, s.lng, score, 'inferred').catch(() => {});
  }
}

// ── Bitrate switches ──────────────────────────────────────────────────────────

export async function appendBitrateSwitch(sessionId: string, sw: object): Promise<void> {
  await StreamingSession.updateOne(
    { session_id: sessionId },
    { $push: { bitrate_switches: sw } },
  );
}

// ── Session end ───────────────────────────────────────────────────────────────

export async function endSession(
  sessionId:   string,
  genabrActive = false,
): Promise<void> {
  await finaliseSession(sessionId, genabrActive);
}
