import { Request, Response } from 'express';
import { runInference } from '../services/inferenceEngine.service';

// POST /api/genabr/decision
// Body: { lat, lng, heading?, speed_kmh?, recent_downlinks? }
// Returns: InferenceResult
export async function genabrDecisionController(req: Request, res: Response): Promise<void> {
  const { lat, lng, heading, speed_kmh, recent_downlinks } = req.body;

  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat and lng are required' });
    return;
  }

  const userId = (req as any).user?.userId ?? 'anon';

  const result = await runInference(
    Number(lat),
    Number(lng),
    Number(heading   ?? 0),
    Number(speed_kmh ?? 0),
    Array.isArray(recent_downlinks) ? recent_downlinks.map(Number) : [],
    userId,
  );

  res.json(result);
}
