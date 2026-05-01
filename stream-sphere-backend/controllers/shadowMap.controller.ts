import { Request, Response } from 'express';
import { getCoverage, ingestDeadZone } from '../services/shadowMap.service';

// POST /api/shadow-map/query
// Body: { lat, lng, forceRefresh? }
// Auth: optional (userId extracted from JWT if present)
export async function queryCoverageController(req: Request, res: Response): Promise<void> {
  const { lat, lng, forceRefresh } = req.body;

  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat and lng are required' });
    return;
  }

  const userId = (req as any).user?.userId ?? null;
  const result = await getCoverage(
    Number(lat),
    Number(lng),
    userId,
    Boolean(forceRefresh),
  );

  res.json(result);
}

// POST /api/shadow-map/dead-zone
// Body: { lat, lng, signal_score, source? }
// Called automatically by the telemetry ingestion pipeline when a stall is detected
export async function ingestDeadZoneController(req: Request, res: Response): Promise<void> {
  const { lat, lng, signal_score, source } = req.body;

  if (lat == null || lng == null || signal_score == null) {
    res.status(400).json({ error: 'lat, lng, signal_score are required' });
    return;
  }

  await ingestDeadZone(Number(lat), Number(lng), Number(signal_score), source ?? 'inferred');
  res.status(204).send();
}
