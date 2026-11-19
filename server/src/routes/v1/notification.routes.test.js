import request from 'supertest';
import app from '../../app.js';

describe('notification routes', () => {
  it.each([
    ['get', '/api/v1/notifications/push/config'],
    ['post', '/api/v1/notifications/push/subscribe'],
    ['post', '/api/v1/notifications/push/unsubscribe'],
    ['post', '/api/v1/notifications/push/test'],
  ])('registers %s %s and requires authentication', async (method, path) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(401);
    expect(response.body.message).not.toContain('not found');
  });
});
