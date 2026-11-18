import { jest } from '@jest/globals';

const RefreshToken = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};
const User = { findByPk: jest.fn() };
const mockModels = {
  RefreshToken,
  PasswordResetToken: {},
  TechnicianProfile: {},
  User,
  TechnicianArea: {},
  TechnicianAvailability: {},
  ServiceCategory: {},
};

jest.unstable_mockModule('../models/index.js', () => mockModels);
jest.unstable_mockModule('../config/env.js', () => ({
  env: { jwt: { refreshDays: 30 } },
}));
jest.unstable_mockModule('../services/email.service.js', () => ({
  isEmailConfigured: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));
jest.unstable_mockModule('../utils/jwt.js', () => ({
  generateRefreshToken: jest.fn(() => 'new-refresh-token'),
  hashToken: jest.fn((token) => `hash:${token}`),
  refreshCookieOptions: jest.fn(() => ({})),
  verifyRefreshToken: jest.fn(() => ({ sub: '7' })),
}));

const { listActiveSessions, refreshSession, revokeSessionById } = await import('./auth.service.js');

describe('auth session management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only safe session details and identifies the current session', async () => {
    RefreshToken.findAll.mockResolvedValue([
      {
        id: 21,
        tokenHash: 'hash:current-token',
        userAgent: 'Browser',
        ip: '192.0.2.1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-02-01T00:00:00Z'),
      },
    ]);

    const sessions = await listActiveSessions(7, 'current-token');

    expect(sessions).toEqual([
      expect.objectContaining({ id: 21, isCurrent: true, userAgent: 'Browser' }),
    ]);
    expect(sessions[0]).not.toHaveProperty('tokenHash');
    expect(RefreshToken.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 7, revokedAt: null }),
      })
    );
  });

  it('revokes a session only for its owner and reports whether it was current', async () => {
    RefreshToken.findOne.mockResolvedValue({ id: 21, tokenHash: 'hash:current-token' });
    RefreshToken.update.mockResolvedValue([1]);

    await expect(revokeSessionById(7, 21, 'current-token')).resolves.toBe(true);
    expect(RefreshToken.update).toHaveBeenCalledWith(
      { revokedAt: expect.any(Date) },
      {
        where: expect.objectContaining({
          id: 21,
          userId: 7,
          revokedAt: null,
        }),
      }
    );
  });

  it("does not revoke a missing or another user's session", async () => {
    RefreshToken.findOne.mockResolvedValue(null);

    await expect(revokeSessionById(7, 21, 'current-token')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(RefreshToken.update).not.toHaveBeenCalled();
  });

  it('rejects a refresh request that loses the concurrent-rotation race', async () => {
    RefreshToken.findOne.mockResolvedValue({ id: 21 });
    User.findByPk.mockResolvedValue({ id: 7, isActive: true });
    RefreshToken.update.mockResolvedValue([0]);

    await expect(refreshSession('old-refresh-token', {}, {})).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(RefreshToken.create).not.toHaveBeenCalled();
  });
});
