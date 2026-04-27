import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

// Force IPv4 to avoid ENETUNREACH errors with Google APIs
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

import centralRoute from './routes/centralRoute.route';
import { globalLimiter } from './middleware/rateLimiter.middleware';
import { redisService } from './services/redis.service';

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
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(3000, () => {
      console.log('🚀 Server running on http://localhost:3000');
    });
  })
  .catch((err: any) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
