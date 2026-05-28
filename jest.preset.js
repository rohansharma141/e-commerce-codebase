const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');

const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageReporters: ['text', 'lcov'],
  // Use an absolute prefix anchored at the workspace root so it doesn't matter
  // how deep the running project's jest.config.ts sits in the tree.
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths ?? {}, {
    prefix: `${__dirname}/`,
  }),
};
