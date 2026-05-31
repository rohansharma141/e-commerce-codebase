/* eslint-disable */
export default {
  displayName: 'pricing-src',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../../../coverage/packages/modules/pricing/src',
  maxWorkers: 1,
};
