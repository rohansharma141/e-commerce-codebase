/* eslint-disable */
export default {
  displayName: 'catalog-src',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../../../coverage/packages/modules/catalog/src',
  // Integration spec files share a Postgres schema (catalog) and each does
  // DROP SCHEMA CASCADE + re-migrate in beforeAll. Running them in parallel
  // races and corrupts each other's data. Serialize.
  maxWorkers: 1,
};
