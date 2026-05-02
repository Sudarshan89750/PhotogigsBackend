import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // FIX #11: Include requestId in all error logs for traceability
  const requestId = (req as any).requestId ?? 'unknown';

  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      status: err.statusCode,
      message: err.message,
      code: err.code,
      requestId,
    });
    return;
  }

  logger.error('Unhandled error', {
    requestId,
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    status: 500,
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    requestId,
  });
};
