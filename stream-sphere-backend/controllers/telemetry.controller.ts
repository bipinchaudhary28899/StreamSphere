import { Request, Response } from 'express';
import * as telemetryService from '../services/telemetry.service';

// POST /api/telemetry/session
// Body: { videoId }
// Returns: { sessionId }
export async function startSessionController(req: Request, res: Response): Promise<void> {
  const { videoId } = req.body;
  if (!videoId) { res.status(400).json({ error: 'videoId is required' }); return; }

  const userId    = (req as any).user?.userId ?? null;
  const sessionId = await telemetryService.createSession(videoId, userId);
  res.status(201).json({ sessionId });
}

// POST /api/telemetry/pings  ← primary batch endpoint
// Body: { sessionId, pings: [ { lat, lng, speed_kmh, heading, ... } ] }
// Returns: { ok: true, count: N }
export async function batchPingController(req: Request, res: Response): Promise<void> {
  const { sessionId, pings } = req.body;

  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }
  if (!Array.isArray(pings) || pings.length === 0) {
    res.status(400).json({ error: 'pings must be a non-empty array' });
    return;
  }

  const now = new Date();
  const normalised = pings.map((p: any) => ({
    timestamp:        p.timestamp ? new Date(p.timestamp) : now,
    lat:              p.lat              ?? 0,
    lng:              p.lng              ?? 0,
    speed_kmh:        p.speed_kmh        ?? 0,
    heading:          p.heading          ?? 0,
    signal_strength:  p.signal_strength  ?? null,
    downlink_mbps:    p.downlink_mbps    ?? null,
    rtt_ms:           p.rtt_ms           ?? null,
    connection_type:  p.connection_type  ?? null,
    battery_level:    p.battery_level    ?? null,
    buffer_level_sec: p.buffer_level_sec ?? null,
    bitrate_kbps:     p.bitrate_kbps     ?? null,
  }));

  await telemetryService.appendPings(sessionId, normalised);
  res.json({ ok: true, count: normalised.length });
}

// POST /api/telemetry/ping  ← deprecated single-ping endpoint (kept for compat)
// Body: { sessionId, lat, lng, ... }
export async function pingController(req: Request, res: Response): Promise<void> {
  const { sessionId, lat, lng, ...rest } = req.body;
  if (!sessionId || lat == null || lng == null) {
    res.status(400).json({ error: 'sessionId, lat, lng are required' });
    return;
  }

  await telemetryService.appendPing(sessionId, {
    timestamp:        new Date(),
    lat, lng,
    speed_kmh:        rest.speed_kmh        ?? 0,
    heading:          rest.heading          ?? 0,
    signal_strength:  rest.signal_strength  ?? null,
    downlink_mbps:    rest.downlink_mbps    ?? null,
    rtt_ms:           rest.rtt_ms           ?? null,
    connection_type:  rest.connection_type  ?? null,
    battery_level:    rest.battery_level    ?? null,
    buffer_level_sec: rest.buffer_level_sec ?? null,
    bitrate_kbps:     rest.bitrate_kbps     ?? null,
  });
  res.status(204).send();
}

// POST /api/telemetry/stall
// Body: { sessionId, duration_ms, lat, lng }
export async function stallController(req: Request, res: Response): Promise<void> {
  const { sessionId, duration_ms, lat, lng } = req.body;
  if (!sessionId || duration_ms == null || lat == null || lng == null) {
    res.status(400).json({ error: 'sessionId, duration_ms, lat, lng are required' });
    return;
  }

  await telemetryService.appendStall(sessionId, {
    timestamp: new Date(),
    duration_ms, lat, lng,
  });
  res.status(204).send();
}

// POST /api/telemetry/bitrate-switch
// Body: { sessionId, from_kbps, to_kbps, reason? }
export async function bitrateSwitchController(req: Request, res: Response): Promise<void> {
  const { sessionId, from_kbps, to_kbps, reason } = req.body;
  if (!sessionId || from_kbps == null || to_kbps == null) {
    res.status(400).json({ error: 'sessionId, from_kbps, to_kbps are required' });
    return;
  }

  await telemetryService.appendBitrateSwitch(sessionId, {
    timestamp: new Date(),
    from_kbps, to_kbps,
    reason: reason ?? 'abr_auto',
  });
  res.status(204).send();
}

// PATCH /api/telemetry/session/:sessionId/end
// Body (optional): { genabr_active: boolean }
export async function endSessionController(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.params;
  if (!sessionId) { res.status(400).json({ error: 'sessionId is required' }); return; }

  const genabrActive = Boolean(req.body?.genabr_active ?? false);
  await telemetryService.endSession(sessionId, genabrActive);
  res.status(204).send();
}
