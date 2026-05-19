import 'reflect-metadata';

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const toInt = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFloat = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseCsv = (raw: string): string[] =>
  raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const isLocalHost = (url: string): boolean =>
  /localhost|127\.0\.0\.1/i.test(url);

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: toInt(optional('PORT', '3000'), 3000),
  isProduction: process.env.NODE_ENV === 'production',
  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
  corsOrigins: parseCsv(optional('CORS_ORIGINS', optional('FRONTEND_URL', 'http://localhost:5173'))),

  // Sentry error tracking (optional)
  sentry: {
    dsn: optional('SENTRY_DSN', ''),
  },

  db: {
    postgresUrl: required('DATABASE_URL'),
    mongoUri: required('MONGODB_URI'),
  },

  redis: {
    url: optional('REDIS_URL', ''),
    enabled: optional('REDIS_ENABLED', 'true').toLowerCase() === 'true',
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
  },

  resend: {
    apiKey: required('RESEND_API_KEY'),
    from: optional('EMAIL_FROM', 'noreply@photogigs.com'),
  },

  cloudinary: {
    cloudName: required('CLOUDINARY_CLOUD_NAME'),
    apiKey: required('CLOUDINARY_API_KEY'),
    apiSecret: required('CLOUDINARY_API_SECRET'),
  },

  wasabi: {
    endpoint: optional('WASABI_ENDPOINT', 'https://s3.ap-southeast-1.wasabisys.com'),
    region: optional('WASABI_REGION', 'ap-southeast-1'),
    accessKeyId: optional('WASABI_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('WASABI_SECRET_ACCESS_KEY', ''),
    bucket: optional('WASABI_BUCKET', 'photogigs-uploads'),
  },

  storage: {
    provider: optional('STORAGE_PROVIDER', 'wasabi') as 'wasabi' | 'cloudinary',
    enableFallback: optional('ENABLE_STORAGE_FALLBACK', 'true').toLowerCase() === 'true',
  },

  phonepe: {
    merchantId: optional('PHONEPE_MERCHANT_ID', ''),
    apiKey: optional('PHONEPE_API_KEY', ''),
    apiKeyIndex: toInt(optional('PHONEPE_API_KEY_INDEX', '1'), 1),
    baseUrl: optional('PHONEPE_BASE_URL', 'https://api-preprod.phonepe.com/apis/pg-sandbox'),
    redirectUrl: optional('PHONEPE_REDIRECT_URL', 'https://photogigs.com/payment/callback'),
    callbackUrl: optional('PHONEPE_CALLBACK_URL', 'https://api.photogigs.com/api/v1/webhooks/phonepe'),
  },

  rateLimit: {
    windowMs: toInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 900000),
    max: toInt(optional('RATE_LIMIT_MAX', '100'), 100),
  },

  platform: {
    feePercent: toFloat(optional('PLATFORM_FEE_PERCENT', '10'), 10),
  },

  // FIX #7: Firebase config loaded from env (set FIREBASE_SERVICE_ACCOUNT_JSON)
  firebase: {
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  },

  // Magic numbers extracted to config
  constants: {
    // OTP settings
    otp: {
      ttlSeconds: toInt(optional('OTP_TTL_SECONDS', '600'), 600),
      length: 6,
      resendCooldownSeconds: toInt(optional('OTP_RESEND_COOLDOWN', '60'), 60),
    },
    // Pagination defaults
    pagination: {
      defaultLimit: toInt(optional('DEFAULT_PAGE_SIZE', '20'), 20),
      maxLimit: toInt(optional('MAX_PAGE_SIZE', '50'), 50),
    },
    // Presence tracking
    presence: {
      sampleRate: toInt(optional('PRESENCE_SAMPLE_RATE', '10'), 10),
    },
    // File upload limits
    upload: {
      maxImageSizeMB: toInt(optional('MAX_IMAGE_SIZE_MB', '10'), 10),
      maxImagesPerPost: toInt(optional('MAX_IMAGES_PER_POST', '10'), 10),
      maxVideoSizeMB: toInt(optional('MAX_VIDEO_SIZE_MB', '100'), 100),
    },
    // Cache TTL (seconds)
    cache: {
      userProfile: 300,
      listings: 120,
      jobs: 60,
      searchResults: 30,
    },
  },
};

const validateProductionConfig = (): void => {
  if (!config.isProduction) return;

  if (isLocalHost(config.frontendUrl)) {
    throw new Error('FRONTEND_URL cannot point to localhost in production');
  }

  if (config.corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must include at least one allowed origin in production');
  }

  if (config.corsOrigins.some(isLocalHost)) {
    throw new Error('CORS_ORIGINS cannot include localhost in production');
  }

  if (config.jwt.accessSecret.length < 32 || config.jwt.refreshSecret.length < 32) {
    throw new Error('JWT secrets must be at least 32 characters in production');
  }

  // Check for common weak JWT secrets
  const COMMON_WEAK_SECRETS = [
    'password', 'password123', 'secret', 'jwtsecret', '12345678',
    'admin', 'administrator', 'changeme', 'default', 'qwerty',
  ];
  const secretLower = config.jwt.accessSecret.toLowerCase();
  if (COMMON_WEAK_SECRETS.some(s => secretLower.includes(s))) {
    throw new Error('JWT secret contains common weak password - choose a strong secret');
  }

  if (config.rateLimit.max > 5000) {
    throw new Error('RATE_LIMIT_MAX is too high for production safety');
  }
};

validateProductionConfig();
