/**
 * Tests de integracion de la API contra un Postgres efimero (pnpm api test:int).
 * El globalSetup levanta postgres:18-alpine desechable y aplica las migraciones;
 * con TEST_DATABASE_URL usa esa base (CI). Ver test/integracion/README.md.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/integracion'],
  testMatch: ['**/*.int-spec.ts'],
  globalSetup: '<rootDir>/test/integracion/global-setup.ts',
  globalTeardown: '<rootDir>/test/integracion/global-teardown.ts',
  setupFiles: ['<rootDir>/test/integracion/entorno-proceso.ts'],
  testTimeout: 30_000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/integracion/tsconfig.json' }] },
};
