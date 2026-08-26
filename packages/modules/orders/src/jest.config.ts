/* eslint-disable */
export default {
  displayName: 'orders-src',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // The orders module has no spec of its own: its one test wired cart,
  // pricing and orders together, which is composition-root work, and it now
  // lives at apps/api/src/checkout.integration.spec.ts. The target stays so
  // that adding a unit test here needs no config change.
  passWithNoTests: true,
  coverageDirectory: '../../../../coverage/packages/modules/orders/src',
  maxWorkers: 1,
};
