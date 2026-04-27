import { Request, Response } from 'express';
import { runInference, forceOracleTest } from '../services/inferenceEngine.service';

// POST /api/genabr/decision
// Body: { lat, lng, heading?, speed_kmh?, recent_downlinks?, session_id? }
// Returns: InferenceResult
export async function genabrDecisionController(req: Request, res: Response): Promise<void> {
  const { lat, lng, heading, speed_kmh, recent_downlinks, session_id } = req.body;

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
    typeof session_id === 'string' ? session_id : null,
  );

  res.json(result);
}

// POST /api/genabr/test-oracle  (admin-only, for verifying the LLM connection)
// Bypasses Student confidence gate and forces an Oracle call with the supplied
// or default context.  Useful for confirming OpenAI is wired up correctly.
// Body (all optional): { lat, lng, speed_kmh, recent_downlinks, mock_risk }
export async function testOracleController(req: Request, res: Response): Promise<void> {
  const lat             = Number(req.body.lat             ?? 28.396);
  const lng             = Number(req.body.lng             ?? 79.432);
  const speed_kmh       = Number(req.body.speed_kmh       ?? 0);
  const recent_downlinks = Array.isArray(req.body.recent_downlinks)
    ? req.body.recent_downlinks.map(Number)
    : [8.5, 7.2, 5.1];   // simulate a degrading signal to make Oracle interesting

  // mock_risk lets you put the risk right on a boundary (0.20 or 0.45) to
  // guarantee low Student confidence and Oracle invocation
  const mockRisk = req.body.mock_risk != null ? Number(req.body.mock_risk) : 0.22;

  const result = await forceOracleTest(lat, lng, speed_kmh, recent_downlinks, mockRisk);
  res.json(result);
}
