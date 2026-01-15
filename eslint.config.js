import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Ban explicit any
      '@typescript-eslint/no-explicit-any': 'error',

      // Ban "as" type assertions, but allow "as const"
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'never',
      }],
    },
  },
  // Restrict listen imports from Tauri in src/ files (except event-bridge.ts)
  // Note: emit is NOT restricted because window coordination events still use it directly
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/lib/event-bridge.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@tauri-apps/api/event',
          importNames: ['listen'],
          message: 'Use eventBus.on() from @/lib/event-bridge instead. Only event-bridge.ts may use listen().',
        }],
      }],
    },
  },
  {
    ignores: ['node_modules', 'dist', 'src-tauri'],
  },
);
