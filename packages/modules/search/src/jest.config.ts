/* eslint-disable */
export default {
  displayName: 'search-src',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../../../coverage/packages/modules/search/src',
  // Integration spec talks to a shared OpenSearch instance; serialize.
  maxWorkers: 1,
};
