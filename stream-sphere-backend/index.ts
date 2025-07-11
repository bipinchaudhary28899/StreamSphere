import express from 'express';  // Use import for consistency
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import centralRoute from './routes/centralRoute.route';
import { Video } from './models/video';

dotenv.config();

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.CLIENT_URL?.split(',') || [];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());
console.log('centralRoute typeof:', typeof centralRoute);
console.log('centralRoute:', centralRoute);

app.use('/api', centralRoute);


// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI!)
  .then(() => {
    console.log('✅ MongoDB connected');

    // Start server after successful DB connection
    app.listen(3000, () => {
      console.log('🚀 Server is running on http://localhost:3000');
    });
  })
  .catch((err: any) => {
    console.error('❌ MongoDB connection error:', err);
  });
