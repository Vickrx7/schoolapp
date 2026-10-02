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
    // Test coverage reports only: « Couverture du curriculum » has source directories named
    // coverage (apps/web/src/app/(app)/library/coverage, components/library/coverage).
    'coverage/**',
    'apps/*/coverage/**',
    'packages/*/coverage/**',
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
  // The web app reads its settings on the server at run time (DECISIONS D-113): Next would
  // build a `NEXT_PUBLIC_*` value into the app, tying an image to one install.
  {
    files: ['apps/web/src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'Identifier[name=/^NEXT_PUBLIC_/]',
          'Literal[value=/^NEXT_PUBLIC_/]',
          'TemplateElement[value.raw=/^NEXT_PUBLIC_/]',
        ].map((selector) => ({
          selector,
          message:
            'No NEXT_PUBLIC_ settings in the web app: read them on the server with serverEnv() (D-113).',
        })),
      ],
    },
  },
  // Student devices (« Quiz sur les appareils », DECISIONS D-083, D-086): the device pages, their
  // components and the class portal's server code reach the database only through the portal
  // role. They may not import a Supabase client, the staff session, the library's queries or
  // actions, or the AI package (students never use AI, D-039), so no answer key or staff data
  // can be read on their path, whatever a later change does.
  {
    files: [
      'apps/web/src/app/jouer/**/*.{ts,tsx}',
      'apps/web/src/components/class-portal/**/*.{ts,tsx}',
      'apps/web/src/server/class-portal/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@supabase/ssr', message: 'Class devices use the class portal role only.' },
            {
              name: '@supabase/supabase-js',
              message: 'Class devices use the class portal role only.',
            },
          ],
          patterns: [
            {
              regex: '^@lynx/ai(/.*)?$',
              message: 'Class mode never uses AI (D-082).',
            },
            {
              regex: '(^@/|/)server/(supabase|session|queries|actions)(/.*)?$',
              message:
                'Class device code reaches the database only through server/class-portal (D-083).',
            },
            {
              regex: '^\\.\\./(supabase|session|queries|actions)(/.*)?$',
              message:
                'Class device code reaches the database only through server/class-portal (D-083).',
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
