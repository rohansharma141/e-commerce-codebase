/* eslint-disable */
export default {
  displayName: 'storefront',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // Deliberately narrow. The preset maps every @platform/* workspace alias,
  // which would let a storefront test import a domain module and pass —
  // exactly the coupling the ESLint boundary forbids. Overriding the mapper
  // with these two entries means a test that reaches for anything other than
  // @platform/api-client fails to resolve, so the boundary holds in tests as
  // well as in the build.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@platform/api-client$': '<rootDir>/../../packages/api-client/src/index.ts',
  },
  coverageDirectory: '../../coverage/apps/storefront',
  // The conformance spec drives a real cart through checkout against a shared
  // api; serialize so concurrent runs don't race on promotion use counts.
  maxWorkers: 1,
};
