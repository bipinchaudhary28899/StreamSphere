import express from 'express';  // Use import for consistency
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import googleAuth from './routes/auth.route';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
console.log('googleAuth typeof:', typeof googleAuth);
console.log('googleAuth:', googleAuth);

app.use('/api', googleAuth);

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
