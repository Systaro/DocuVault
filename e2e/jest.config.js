module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testTimeout: 120000,
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
