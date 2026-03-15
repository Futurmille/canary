module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/dashboard/**',
  ],
  coverageThreshold: {
    global: { branches: 98, functions: 95, lines: 100, statements: 99 },
  },
};
