import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../app.js';
import { authorize } from '../../middleware/auth.js';

describe('admin routes', () => {
  it.each([
    '/api/v1/admin/requests',
    '/api/v1/admin/verification',
    '/api/v1/admin/users',
    '/api/v1/admin/reviews',
    '/api/v1/admin/categories',
    '/api/v1/admin/content/landing',
    '/api/v1/admin/announcements',
    '/api/v1/admin/archive?type=users',
    '/api/v1/admin/audit',
  ])('registers %s and requires an authenticated admin', async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(401);
    expect(response.body.message).not.toContain('not found');
  });

  it('rejects authenticated non-admin roles', () => {
    const next = jest.fn();
    authorize('admin')({ user: { role: 'customer' } }, {}, next);

    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('registers public password recovery endpoints with input validation', async () => {
    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'short', newPassword: 'weak' });
    const sessions = await request(app).get('/api/v1/auth/sessions');
    const revokeSession = await request(app).delete('/api/v1/auth/sessions/1');

    expect(forgot.status).toBe(400);
    expect(reset.status).toBe(400);
    expect(sessions.status).toBe(401);
    expect(revokeSession.status).toBe(401);
  });
});
