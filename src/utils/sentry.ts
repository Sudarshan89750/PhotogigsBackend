import * as Sentry from '@sentry/node';
import { config } from '../config';

let _sentryInitialized = false;

export const initSentry = (): void => {
  if (_sentryInitialized) return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('Sentry DSN not configured - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: config.env,
    release: 'photogigs@' + (process.env.npm_package_version || '1.0.0'),
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
    tracesSampleRate: config.isProduction ? 0.1 : 1.0,
    attachStacktrace: !config.isProduction,
    sendDefaultPii: false,
    beforeSend(event, hint) {
      // Filter out health check errors
      if (event.request?.url?.includes('/health')) {
        return null;
      }
      return event;
    },
  });

  _sentryInitialized = true;
  console.log('Sentry error tracking initialized');
};

export const captureException = (error: Error, context?: Record<string, any>): void => {
  if (!_sentryInitialized) {
    console.error('Sentry not initialized - falling back to console:', error);
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      Object.keys(context).forEach((key) => {
        scope.setExtra(key, context[key]);
      });
    }
    Sentry.captureException(error);
  });
};

export const captureMessage = (message: string, level: Sentry.SeverityLevel = 'info'): void => {
  if (!_sentryInitialized) return;
  Sentry.captureMessage(message, level);
};

export const setUser = (userId: string, email?: string): void => {
  if (!_sentryInitialized) return;
  Sentry.setUser({ id: userId, email });
};

export const clearUser = (): void => {
  if (!_sentryInitialized) return;
  Sentry.setUser(null);
};
