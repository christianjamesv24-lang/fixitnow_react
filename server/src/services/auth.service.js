import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import {
  RefreshToken,
  PasswordResetToken,
  TechnicianProfile,
  User,
  TechnicianArea,
  TechnicianAvailability,
  ServiceCategory,
} from '../models/index.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { generateRefreshToken, hashToken, refreshCookieOptions } from '../utils/jwt.js';
import { isEmailConfigured, sendPasswordResetEmail } from './email.service.js';

export const technicianProfileInclude = {
  association: 'technicianProfile',
  include: [
    { association: 'skills', through: { attributes: [] } },
    { association: 'areas' },
    { association: 'availability' },
  ],
};

export async function findFullUser(userId) {
  return User.findByPk(userId, { include: [technicianProfileInclude] });
}

/**
 * Creates an access token + rotating refresh token. Only the SHA-256 hash of
 * the refresh JWT is persisted, so a database leak cannot replay sessions.
 */
export async function issueSession(user, req, res) {
  const { signAccessToken } = await import('../utils/jwt.js');
  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await RefreshToken.create({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.jwt.refreshDays * 24 * 60 * 60 * 1000),
    userAgent: req.get('user-agent')?.slice(0, 255) || null,
    ip: req.ip,
  });
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return accessToken;
}

export async function registerUser(input, req, res) {
  const existing = await User.unscoped().findOne({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    phone: input.phone || null,
    role: input.role,
  });

  if (input.role === 'technician') {
    await TechnicianProfile.create({ userId: user.id });
  }

  const accessToken = await issueSession(user, req, res);
  const fullUser = await findFullUser(user.id);
  return { accessToken, user: fullUser };
}

export async function loginUser(input, req, res) {
  const user = await User.findOne({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw ApiError.unauthorized('Email or password is incorrect');
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  const accessToken = await issueSession(user, req, res);
  const fullUser = await findFullUser(user.id);
  return { accessToken, user: fullUser };
}

export async function refreshSession(rawToken, req, res) {
  const { verifyRefreshToken } = await import('../utils/jwt.js');
  if (!rawToken) throw ApiError.unauthorized('No refresh token');

  let payload;
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw ApiError.unauthorized('Refresh token is invalid or expired');
  }

  const record = await RefreshToken.findOne({
    where: {
      userId: payload.sub,
      tokenHash: hashToken(rawToken),
      revokedAt: null,
      expiresAt: { [Op.gt]: new Date() },
    },
  });
  if (!record) throw ApiError.unauthorized('Refresh token has been revoked');

  const user = await User.findByPk(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is not active');

  record.revokedAt = new Date();
  await record.save();
  const accessToken = await issueSession(user, req, res);
  const fullUser = await findFullUser(user.id);
  return { accessToken, user: fullUser };
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { tokenHash: hashToken(rawToken), revokedAt: null } }
  );
}

export async function revokeAllSessions(userId) {
  await RefreshToken.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null } });
}

export async function requestPasswordReset(email) {
  if (!isEmailConfigured()) {
    throw new ApiError(
      503,
      'Password recovery email is not configured. Set Gmail OAuth2 or App Password credentials in server/.env.'
    );
  }
  const user = await User.findOne({ where: { email, isActive: true } });
  if (!user) return;

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await PasswordResetToken.destroy({ where: { userId: user.id } });
  const resetRecord = await PasswordResetToken.create({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  try {
    await sendPasswordResetEmail({ to: user.email, name: user.name, token });
  } catch (error) {
    await resetRecord.destroy();
    throw error;
  }
}

export async function resetPassword(token, newPassword) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await User.sequelize.transaction(async (transaction) => {
    const resetRecord = await PasswordResetToken.findOne({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!resetRecord) throw ApiError.badRequest('This password reset link is invalid or expired');

    const user = await User.findByPk(resetRecord.userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || !user.isActive) {
      throw ApiError.badRequest('This password reset link is invalid or expired');
    }

    await user.update({ passwordHash: await bcrypt.hash(newPassword, 12) }, { transaction });
    await resetRecord.update({ usedAt: new Date() }, { transaction });
    await RefreshToken.update(
      { revokedAt: new Date() },
      { where: { userId: user.id, revokedAt: null }, transaction }
    );
    await PasswordResetToken.destroy({
      where: { userId: user.id, id: { [Op.ne]: resetRecord.id } },
      transaction,
    });
  });
}

/** Technician account payload for dashboards. */
export async function loadTechnicianProfile(userId) {
  return TechnicianProfile.findOne({
    where: { userId },
    include: [
      { association: 'skills', through: { attributes: [] } },
      { association: 'areas' },
      { association: 'availability' },
      { association: 'documents' },
    ],
  });
}

export async function assertCategoriesExist(ids) {
  if (!ids?.length) return;
  const count = await ServiceCategory.count({ where: { id: ids } });
  if (count !== new Set(ids).size) throw ApiError.badRequest('One or more skills do not exist');
}

/**
 * Technician areas/availability use unique indexes, and soft-deleted rows still
 * occupy those keys. Reconcile instead of delete-and-recreate so a city or day
 * can be removed and added again without violating the index.
 */
export async function replaceAreas(profileId, cities, actorId, transaction) {
  if (!cities) return;
  const options = { transaction };
  const wanted = new Set(cities.map((city) => city.trim()).filter(Boolean));
  const existing = await TechnicianArea.unscoped().findAll({
    where: { technicianProfileId: profileId },
    ...options,
  });

  for (const area of existing) {
    if (wanted.has(area.city)) {
      if (area.deletedAt) {
        await area.restore(options);
        await area.update({ deletedBy: null }, options);
      }
      wanted.delete(area.city);
    } else if (!area.deletedAt) {
      await area.update({ deletedBy: actorId }, options);
      await area.destroy(options);
    }
  }

  if (wanted.size) {
    await TechnicianArea.bulkCreate(
      [...wanted].map((city) => ({ technicianProfileId: profileId, city })),
      options
    );
  }
}

export async function replaceAvailability(profileId, availability, actorId, transaction) {
  if (!availability) return;
  const options = { transaction };
  const byDay = new Map(availability.map((row) => [Number(row.dayOfWeek), row]));
  const existing = await TechnicianAvailability.unscoped().findAll({
    where: { technicianProfileId: profileId },
    ...options,
  });

  for (const row of existing) {
    const next = byDay.get(Number(row.dayOfWeek));
    if (next) {
      if (row.deletedAt) {
        await row.restore(options);
        await row.update({ deletedBy: null }, options);
      }
      await row.update(
        {
          startTime: next.startTime,
          endTime: next.endTime,
          isActive: next.isActive ?? true,
        },
        options
      );
      byDay.delete(Number(row.dayOfWeek));
    } else if (!row.deletedAt) {
      await row.update({ deletedBy: actorId }, options);
      await row.destroy(options);
    }
  }

  const remaining = [...byDay.values()];
  if (remaining.length) {
    await TechnicianAvailability.bulkCreate(
      remaining.map((row) => ({ ...row, technicianProfileId: profileId })),
      options
    );
  }
}