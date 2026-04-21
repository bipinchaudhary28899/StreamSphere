import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Generic Zod validation middleware.
 *
 * Usage:
 *   router.post('/route', validate(mySchema), controller);
 *
 * The schema should be an object with optional `body`, `params`, and `query`
 * keys, each containing a Zod schema for that part of the request.
 *
 * On success the middleware writes the *parsed* (coerced + trimmed) values
 * back onto req so downstream handlers get clean data.
 * On failure it responds 400 with a structured error list — no internal
 * details leak through.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body:   req.body,
      params: req.params,
      query:  req.query,
    });

    if (!result.success) {
      const details = result.error.issues.map((e) => ({
        // Drop the leading "body." / "params." segment so callers see
        // e.g. "title" not "body.title"
        field:   e.path.slice(1).join('.') || e.path.join('.'),
        message: e.message,
      }));

      res.status(400).json({
        error:   'Validation failed',
        details,
      });
      return;
    }

    // Overwrite request parts with Zod-parsed (coerced, trimmed) values
    const parsed = result.data as Record<string, any>;
    if (parsed.body   !== undefined) req.body   = parsed.body;
    if (parsed.params !== undefined) req.params = parsed.params;
    // Note: req.query is read-only in some express typings; skip writing back
    // unless a route specifically needs it.

    next();
  };
}
