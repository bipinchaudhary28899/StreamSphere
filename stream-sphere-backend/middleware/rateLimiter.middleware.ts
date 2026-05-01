import rateLimit from 'express-rate-limit';

const jsonMessage = (msg: string) => ({ error: msg });

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
  legacyHeaders: false,     // Disable X-RateLimit-* headers
  message: jsonMessage('Too many login attempts — please wait 15 minutes and try again.'),
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Upload limit reached — you can upload up to 20 videos per hour.'),
});

export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests — please slow down and try again shortly.'),
});

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests from this IP — please try again in 15 minutes.'),
});
