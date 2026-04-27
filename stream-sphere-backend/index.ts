import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

// Force IPv4 to avoid ENETUNREACH errors with Google APIs
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

import centralRoute from './routes/centralRoute.route';
import { globalLimiter } from './middleware/rateLimiter.middleware';
import { redisService } from './services/redis.service';

// Import models explicitly so Mongoose registers their indexes on startup.
// Required for the 2dsphere index on TelemetryPing.location and the TTL index
// on TelemetryPing.timestamp — both were added after the collection was first
// created, so syncIndexes() below ensures Atlas reflects the current schema.
import './models/telemetryPing';
import './models/radioMapCache';
import './models/streamingSession';

dotenv.config();

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.CLIENT_URL?.split(',').map(o => o.trim()) || [];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

app.use(express.json({ limit: '10kb' })); // reject abnormally large JSON bodies

app.use(globalLimiter);

app.use('/api', centralRoute);

// Connect Redis (non-blocking — if REDIS_URL absent, caching silently disabled)
redisService.connect();

mongoose.connect(process.env.MONGODB_URI!)
  .then(async () => {
    console.log('✅ MongoDB connected');

    // Sync schema indexes with Atlas — idempotent and fast after the first run.
    // This ensures the 2dsphere index on TelemetryPing.location and the TTL index
    // on TelemetryPing.timestamp are created even if the collection pre-dates them.
    try {
      await mongoose.connection.syncIndexes();
      console.log('✅ Indexes synced');
    } catch (e) {
      console.warn('⚠️  Index sync failed (non-fatal):', e);
    }

    app.listen(3000, () => {
      console.log('🚀 Server running on http://localhost:3000');
    });
  })
  .catch((err: any) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
