import { validateProductionJwtSecrets } from './env.js';

describe('production JWT secret validation', () => {
  it('requires both secrets to be at least 32 characters long', () => {
    expect(() => validateProductionJwtSecrets('production', '', 'r'.repeat(32))).toThrow(
      'JWT_ACCESS_SECRET'
    );
    expect(() => validateProductionJwtSecrets('production', 'a'.repeat(32), '')).toThrow(
      'JWT_REFRESH_SECRET'
    );
  });
});
