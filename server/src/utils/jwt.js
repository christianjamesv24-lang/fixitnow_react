import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, sid: String(sessionId) },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

export function generateRefreshToken(user) {
  return jwt.sign({ sub: String(user.id), jti: crypto.randomUUID() }, env.jwt.refreshSecret, {
    expiresIn: `${env.jwt.refreshDays}d`,
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshCookieOptions() {
  const secure =
    env.cookieSecure ??
    (env.clientUrl.startsWith('https://') || env.cookieSameSite === 'none');
  return {
    httpOnly: true,
    secure,
    sameSite: env.cookieSameSite,
    path: '/api/v1/auth',
    maxAge: env.jwt.refreshDays * 24 * 60 * 60 * 1000,
  };
}