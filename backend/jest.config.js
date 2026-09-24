module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../tests'],
  testMatch: ['**/*.test.ts'],
  moduleDirectories: ['node_modules', __dirname + '/node_modules'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
      diagnostics: false // Prevent TS from failing due to node_modules being in a different folder
    }]
  },
  clearMocks: true,
};
