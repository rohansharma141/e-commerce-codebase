const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageReporters: ['text', 'lcov'],
};
