import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { Pool } from 'pg';

/**
 * Middleware to update the user's last_active_at timestamp.
 * Runs on every authenticated request.
 */
export const presenceMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (req.currentUser && req.currentUser.userId) {
    try {
      const db = Container.get<Pool>('pgPool');
      // Fire and forget (don't await to avoid slowing down the request)
      db.query(
        'UPDATE users SET last_active_at = NOW() WHERE id = $1',
        [req.currentUser.userId]
      ).catch(err => {
        const logger = Container.get<any>('logger');
        logger.error('Failed to update presence', { userId: req.currentUser?.userId, err });
      });
    } catch (e) {
      // Ignore di errors
    }
  }
  next();
};
