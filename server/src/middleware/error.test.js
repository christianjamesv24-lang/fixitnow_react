import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { errorHandler } from './error.js';

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('error handler', () => {
  it('does not hide safe operational 503 recovery-email messages in production', () => {
    const previousNodeEnv = env.nodeEnv;
    env.nodeEnv = 'production';

    const res = mockResponse();
    errorHandler(
      new ApiError(503, 'Password recovery email could not be delivered.'),
      {},
      res,
      () => {}
    );

    env.nodeEnv = previousNodeEnv;
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toBe('Password recovery email could not be delivered.');
  });
});
