/* eslint-disable */
export default {
  displayName: 'cart-src',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../../../coverage/packages/modules/cart/src',
  maxWorkers: 1,
  // Cart logic is exercised by the orders checkout integration test (real
  // Redis + Postgres). Pure cart unit tests would only re-test what that
  // suite already covers end-to-end.
  passWithNoTests: true,
};
