import express, { Application, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

import centralRoute from './routes/centralRoute.route';
import { globalLimiter } from './middleware/rateLimiter.middleware';
import { redisService } from './services/redis.service';
import './models/telemetryPing';
import './models/radioMapCache';
import './models/streamingSession';
import './models/oracleDecision';

const app: Application = express();

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = (process.env.CLIENT_URL ?? '').split(',').map(o => o.trim()).filter(Boolean);
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization',
  optionsSuccessStatus: 200,
};

// cors() middleware automatically handles OPTIONS preflight when used with app.use()
// Do NOT use app.options('*', ...) — bare '*' crashes Express 5 (path-to-regexp v8)
app.use(cors(corsOptions));

app.use(express.json({ limit: '10kb' }));
app.use(globalLimiter);
app.use('/api', centralRoute);

redisService.connect();

mongoose.connect(process.env.MONGODB_URI!)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ── Global error handler (must have 4 params for Express to recognise it) ────
// Catches any unhandled async errors thrown in route handlers (Express 5).
// Without this, Express returns an opaque 500 with no logging.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled]', err?.message ?? err);
  if (!res.headersSent) {
    res.status(err?.status ?? 500).json({ message: err?.message ?? 'Internal server error' });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => console.log('🚀 Server running on http://localhost:3000'));
}

// Required for @vercel/node — must be CommonJS export, not ES module export
module.exports = app;
