import { randomUUID } from 'crypto';
import { StreamingSession } from '../models/streamingSession';
import { TelemetryPing }    from '../models/telemetryPing';
import { ingestDeadZone }   from './shadowMap.service';
import { finaliseSession }  from './qoe.service';
import { snapToGrid, TILE_SIZE_DEGREES } from '../utils/geo';

// ── Privacy: snap GPS coordinates to tile centre BEFORE storage ───────────────
// The prediction pipeline (corridor scanner, prediction cone, dead-zone lookup,
// radio-map cache) operates at 200 m tile resolution throughout. Storing raw
// GPS precision (~3–10 m from enableHighAccuracy: false) would retain commute
// traces reconstructable to street level for the 2-day TelemetryPing TTL.
// Snapping to tile centre keeps predictions identical and bounds stored
// resolution to ~200 m, which is below street-block precision.

function snapForPrivacy(lat: number, lng: number): { lat: number; lng: number } {
  // snapToGrid returns the south-west corner of the tile; add half a tile
  // size so the stored point falls at the tile centre.
  const half = TILE_SIZE_DEGREES / 2;
  return {
    lat: snapToGrid(lat) + half,
    lng: snapToGrid(lng) + half,
  };
}

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
 *  2dsphere index.  Coordinates are [lng, lat] per the GeoJSON spec.
 *  GPS coordinates are snapped to tile centre for privacy (see snapForPrivacy). */
function withLocation(p: PingData): PingData & { location: { type: 'Point'; coordinates: [number, number] } } {
  const { lat, lng } = snapForPrivacy(p.lat, p.lng);
  return {
    ...p,
    lat,
    lng,
    location: { type: 'Point', coordinates: [lng, lat] },
  };
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
  // Snap stall coordinates to tile centre for privacy — the stall record is
  // embedded in StreamingSession and persists indefinitely, so it is the
  // most privacy-sensitive write path in the system.
  const s = stall as any;
  const snappedStall = (s.lat != null && s.lng != null)
    ? { ...s, ...snapForPrivacy(s.lat, s.lng) }
    : s;

  await StreamingSession.updateOne(
    { session_id: sessionId },
    {
      $push: { stall_events: snappedStall },
      $inc:  { total_stall_ms: snappedStall.duration_ms ?? 0 },
    },
  );

  // Auto-ingest dead zone at the (snapped) stall location.
  // Derive signal score from reported downlink if available, otherwise fall
  // back to the passed-in signalScore or a conservative default of 0.15
  // (stalls indicate genuinely bad signal regardless of throughput).
  if (snappedStall.lat != null && snappedStall.lng != null) {
    let score: number;
    if (signalScore !== undefined) {
      score = signalScore;
    } else if (snappedStall.downlink_mbps != null) {
      score = snappedStall.downlink_mbps < 0.20 ? 0.02
            : snappedStall.downlink_mbps < 0.50 ? 0.08
            : snappedStall.downlink_mbps < 1.00 ? 0.18
            : 0.25;   // stalled despite decent downlink — transient spike
    } else {
      score = 0.15;   // unknown conditions but we know it stalled
    }
    ingestDeadZone(snappedStall.lat, snappedStall.lng, score, 'inferred').catch(() => {});
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
