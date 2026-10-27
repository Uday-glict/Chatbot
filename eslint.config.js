// eslint.config.js - flat config shared by server and web workspaces
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/vite.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
];
