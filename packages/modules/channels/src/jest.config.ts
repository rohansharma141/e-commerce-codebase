/* eslint-disable */
export default {
  displayName: 'channels-src',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../../../coverage/packages/modules/channels/src',
  maxWorkers: 1,
};
