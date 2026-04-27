import { Request, Response } from 'express';
import { computeBufferTarget } from '../services/predictionCone.service';

// POST /api/prediction/buffer-target
// Body: { lat, lng, heading, speed_kmh }
// Returns: BufferTarget
export async function bufferTargetController(req: Request, res: Response): Promise<void> {
  const { lat, lng, heading, speed_kmh } = req.body;

  if (lat == null || lng == null) {
    res.status(400).json({ error: 'lat and lng are required' });
    return;
  }

  const result = await computeBufferTarget(
    Number(lat),
    Number(lng),
    Number(heading  ?? 0),
    Number(speed_kmh ?? 0),
  );

  res.json(result);
}
