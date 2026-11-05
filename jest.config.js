/**
 * Jest config for Keel.
 *
 * Keel's test suite covers the pure-TypeScript Bitcoin layer (descriptor
 * parsing/validation and PSBT orchestration/export) — logic that must be
 * correct and is fast to test without a native build. We therefore run in a
 * plain Node environment and transform TS via the React Native Babel preset
 * (configured in babel.config.js). No native modules are imported by these
 * tests, so no RN jest preset or native mocks are required — which keeps CI
 * fast and deterministic.
 */
module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Worktrees nested under .claude/ carry their own copies of every test.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.claude/'],
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'src/bitcoin/**/*.ts',
    '!src/bitcoin/**/__fixtures__/**',
    '!src/bitcoin/**/index.ts',
  ],
};
