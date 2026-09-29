// Root ESLint flat config for the whole monorepo.
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';

const webFiles = ['apps/web/**/*.{js,jsx,ts,tsx}'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    'packages/db/src/database.types.ts',
    'tools/lite-stack/.data/**',
    'tools/lite-stack/.bin/**',
    '**/playwright-report/**',
    '**/test-results/**',
    // Other branches checked out by Claude Code worktrees; they are linted in their own tree.
    '.claude/worktrees/**',
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Next.js rules apply to the web app only.
  ...nextVitals.map((config) => ({
    ...config,
    files: webFiles,
    settings: { ...(config.settings ?? {}), next: { rootDir: 'apps/web/' } },
  })),
  {
    files: webFiles,
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
]);
