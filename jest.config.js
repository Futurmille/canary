module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageThreshold: {
    global: { branches: 100, functions: 95, lines: 100, statements: 100 },
  },
};
