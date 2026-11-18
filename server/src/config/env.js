import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const isTest = process.env.NODE_ENV === 'test';
const nodeEnv = process.env.NODE_ENV || 'development';

export function validateProductionJwtSecrets(environment, accessSecret, refreshSecret) {
  if (environment !== 'production') return;

  if (accessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters in production.');
  }
  if (refreshSecret.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters in production.');
  }
  if (accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production.');
  }
}

const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || (nodeEnv === 'production' ? '' : 'dev-access-secret');
const jwtRefreshSecret =
  process.env.JWT_REFRESH_SECRET || (nodeEnv === 'production' ? '' : 'dev-refresh-secret');

validateProductionJwtSecrets(nodeEnv, jwtAccessSecret, jwtRefreshSecret);

const defaultClientUrl =
  process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173';

export const env = {
  nodeEnv,
  isTest,
  port: Number(process.env.PORT || 5000),
  clientUrl: defaultClientUrl,
  corsOrigins: (process.env.CORS_ORIGINS || defaultClientUrl)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
  cookieSecure:
    process.env.COOKIE_SECURE === undefined || process.env.COOKIE_SECURE === ''
      ? null
      : process.env.COOKIE_SECURE === 'true',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: isTest ? process.env.TEST_DB_NAME || 'fixitnow_test' : process.env.DB_NAME || 'fixitnow',
    ssl: process.env.DB_SSL === 'true',
    sslCa: process.env.DB_SSL_CA || '',
  },
  jwt: {
    accessSecret: jwtAccessSecret,
    refreshSecret: jwtRefreshSecret,
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',
    appPassword: process.env.SMTP_APP_PASSWORD || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@fixitnow.test',
  },
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(serverRoot, isTest ? '.uploads-test' : 'uploads'),
  clientDist: process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : path.resolve(serverRoot, '../client/dist'),
};