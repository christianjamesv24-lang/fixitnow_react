import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

export function hasGoogleOAuthCredentials() {
  return Boolean(env.google.clientId && env.google.clientSecret && env.google.refreshToken);
}

export function isEmailConfigured() {
  return Boolean(
    env.smtp.user &&
      env.smtp.from &&
      (hasGoogleOAuthCredentials() || env.smtp.appPassword)
  );
}

function createSmtpTransporter() {
  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: { user: env.smtp.user, pass: env.smtp.appPassword },
  });
}

async function getGoogleAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiry - 60000) {
    return cachedAccessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      refresh_token: env.google.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    cachedAccessToken = null;
    cachedAccessTokenExpiry = 0;
    const error = new Error('Google OAuth token request failed.');
    error.code = 'GOOGLE_OAUTH';
    error.responseCode = response.status;
    error.details = body;

    let failure;
    try {
      failure = JSON.parse(body);
    } catch {
      failure = null;
    }
    if (failure?.error === 'invalid_grant') {
      error.code = 'GOOGLE_REFRESH_TOKEN_EXPIRED';
      error.message = 'Google OAuth refresh token is invalid or expired.';
    }

    throw error;
  }

  const data = JSON.parse(body);
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiry = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function encodeHeader(value) {
  const clean = String(value).replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function base64Lines(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n')
    .trimEnd();
}

async function sendViaGmailApi({ to, subject, text, html }) {
  const accessToken = await getGoogleAccessToken();
  const from = String(env.smtp.from).replace(/[\r\n]+/g, ' ');
  const recipient = String(to).replace(/[\r\n]+/g, ' ');

  const headers = [
    `From: ${from}`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
  ];
  const body = base64Lines(html || text || '');
  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    cachedAccessToken = null;
    cachedAccessTokenExpiry = 0;
    const error = new Error('Gmail API rejected the message.');
    error.code = 'GMAIL_API';
    error.responseCode = response.status;
    error.details = responseBody;
    throw error;
  }

  const data = JSON.parse(responseBody);
  return { accepted: [recipient], messageId: data.id, response: 'Gmail API' };
}

export async function sendMail(message) {
  if (!isEmailConfigured()) {
    throw new ApiError(
      503,
      'Email is not configured. Set Gmail OAuth2 or App Password credentials in server/.env.'
    );
  }

  let oauthError;
  if (hasGoogleOAuthCredentials()) {
    try {
      return await sendViaGmailApi(message);
    } catch (error) {
      oauthError = error;
      if (!env.smtp.appPassword) throw error;

      console.error('Gmail API failed; retrying with the configured Gmail App Password.', {
        code: error.code || 'UNKNOWN',
        responseCode: error.responseCode,
        message: error.message,
      });
    }
  }

  try {
    return await createSmtpTransporter().sendMail({ from: env.smtp.from, ...message });
  } catch (error) {
    error.oauthError = oauthError;
    throw error;
  }
}

export async function verifyEmailTransport() {
  if (!isEmailConfigured()) {
    throw new ApiError(
      503,
      'Email is not configured. Set Gmail OAuth2 or App Password credentials in server/.env.'
    );
  }

  if (hasGoogleOAuthCredentials()) {
    await getGoogleAccessToken();
    return;
  }

  await createSmtpTransporter().verify();
}

function describeDeliveryError(error) {
  if (!error) return null;
  const status = error.responseCode ? ` HTTP ${error.responseCode}` : '';
  return `${error.code || 'UNKNOWN'}${status}: ${error.message}`;
}

export async function sendPasswordResetEmail({ to, name, token }) {
  if (!isEmailConfigured()) {
    throw new ApiError(
      503,
      'Password recovery email is not configured. Set Gmail OAuth2 or App Password credentials in server/.env.'
    );
  }

  const resetUrl = new URL('/reset-password', env.clientUrl);
  resetUrl.searchParams.set('token', token);

  try {
    await sendMail({
      to,
      subject: 'Reset your FixitNow password',
      text: [
        `Hello${name ? ` ${name}` : ''},`,
        '',
        'We received a request to reset your FixitNow password.',
        `Use this link within 30 minutes: ${resetUrl.toString()}`,
        '',
        'If you did not request a reset, you can ignore this email.',
      ].join('\n'),
    });
  } catch (error) {
    const causes = [];
    if (error.oauthError) {
      causes.push(`Gmail API ${describeDeliveryError(error.oauthError)}`);
      causes.push(`SMTP ${describeDeliveryError(error)}`);
    } else {
      causes.push(describeDeliveryError(error));
    }

    console.error('Gmail could not deliver a password recovery email.', {
      transport: hasGoogleOAuthCredentials() ? 'gmail-api-oauth2' : 'app-password',
      code: error.code || 'UNKNOWN',
      responseCode: error.responseCode,
      command: error.command,
      message: error.message,
      details: error.details,
      oauthError: error.oauthError ? describeDeliveryError(error.oauthError) : undefined,
    });
    throw new ApiError(
      503,
      `Password recovery email could not be delivered (${causes.join('; ')}). Check the Gmail OAuth2/SMTP settings.`
    );
  }
}
