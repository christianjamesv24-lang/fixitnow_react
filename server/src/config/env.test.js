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

  it('rejects short secrets even when they are present', () => {
    expect(() => validateProductionJwtSecrets('production', 'a'.repeat(31), 'r'.repeat(32))).toThrow(
      'JWT_ACCESS_SECRET'
    );
    expect(() => validateProductionJwtSecrets('production', 'a'.repeat(32), 'r'.repeat(31))).toThrow(
      'JWT_REFRESH_SECRET'
    );
  });

  it('requires access and refresh secrets to be different', () => {
    const secret = 's'.repeat(32);
    expect(() => validateProductionJwtSecrets('production', secret, secret)).toThrow(
      'must be different'
    );
  });
});
