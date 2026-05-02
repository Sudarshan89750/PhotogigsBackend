import { Request, Response, NextFunction } from 'express';

export const API_VERSION = 'v1';
export const SUPPORTED_VERSIONS = ['v1'];

// API Version middleware - validates and handles version deprecation
export const apiVersionMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Check for API version in header or URL
  const apiVersion = req.headers['api-version'] as string || 'v1';

  // Check if version is supported
  if (!SUPPORTED_VERSIONS.includes(apiVersion)) {
    res.status(406).json({
      success: false,
      message: `API version '${apiVersion}' is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
      supportedVersions: SUPPORTED_VERSIONS,
    });
    return;
  }

  // Add version info to request for downstream use
  (req as any).apiVersion = apiVersion;

  // Add deprecation warning header for older versions
  if (apiVersion !== API_VERSION) {
    res.setHeader('Deprecation', `version="${apiVersion}"`);
    res.setHeader('Sunset', 'Sat, 01 Jan 2027 00:00:00 GMT');
  }

  next();
};

// Response wrapper for consistent API responses
export const wrapResponse = (data: any, meta?: any) => {
  const response: any = { success: true, data };
  if (meta) {
    response.meta = meta;
  }
  return response;
};

// Error response helper
export const errorResponse = (message: string, code?: string, statusCode: number = 400) => {
  return {
    success: false,
    message,
    ...(code && { code }),
  };
};