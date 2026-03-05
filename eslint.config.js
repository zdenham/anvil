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
  // Ban all imports from @tauri-apps/api/event — all events flow through WS now
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@tauri-apps/api/event',
          message: 'All events flow through WebSocket. Use listen/emit from @/lib/events instead.',
        }],
      }],
    },
  },
  // Zustand selector safety — prevent new references in selectors (causes max update depth)
  // See docs/patterns/zustand-selectors.md for safe patterns.
  // Rules cover both inline arrow selectors AND useCallback-wrapped selectors (without useShallow).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error',
        // --- Inline arrow selectors: useStore(s => ...) ---
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > ArrowFunctionExpression > CallExpression[callee.property.name=/^(filter|map|reduce|sort|slice|concat|flat|flatMap)$/]',
          message: 'Array methods in zustand selectors create new references every render → max update depth. Extract to useMemo() or use useShallow().',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > ArrowFunctionExpression > LogicalExpression[operator="??"] > ArrayExpression',
          message: 'Fallback ?? [] in a zustand selector creates a new array every render. Use useShallow() or select a primitive instead.',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > ArrowFunctionExpression > LogicalExpression[operator="??"] > ObjectExpression',
          message: 'Fallback ?? {} in a zustand selector creates a new object every render. Use useShallow() or select a primitive instead.',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > ArrowFunctionExpression > CallExpression[callee.property.name=/^(getAll|getBy|getRunning|getThreadsBy)/]',
          message: 'Store methods returning collections in selectors create new references every render. Select from state directly or use useShallow().',
        },
        // --- useCallback-wrapped selectors: useStore(useCallback(s => ...)) ---
        // These fire when useCallback is a direct child of the store call (no useShallow wrapper).
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > CallExpression[callee.name="useCallback"] > ArrowFunctionExpression CallExpression[callee.property.name=/^(filter|map|reduce|sort|slice|concat|flat|flatMap)$/]',
          message: 'Array methods inside useCallback-wrapped zustand selectors still create new references. Wrap with useShallow() or move derivation to useMemo().',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > CallExpression[callee.name="useCallback"] > ArrowFunctionExpression LogicalExpression[operator="??"] > ArrayExpression',
          message: 'Fallback ?? [] inside useCallback-wrapped zustand selector creates a new array every render. Use useShallow() or select a primitive instead.',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > CallExpression[callee.name="useCallback"] > ArrowFunctionExpression LogicalExpression[operator="??"] > ObjectExpression',
          message: 'Fallback ?? {} inside useCallback-wrapped zustand selector creates a new object every render. Use useShallow() or select a primitive instead.',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > CallExpression[callee.name="useCallback"] > ArrowFunctionExpression CallExpression[callee.property.name=/^(getAll|getBy|getRunning|getThreadsBy)/]',
          message: 'Store methods returning collections inside useCallback-wrapped selectors create new references. Use useShallow() or select from state directly.',
        },
        // --- Object literals in selectors (both inline and useCallback-wrapped) ---
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > ArrowFunctionExpression ObjectExpression',
          message: 'Object literals in zustand selectors create new references every render → max update depth. Use useShallow() or select individual primitives.',
        },
        {
          selector: 'CallExpression[callee.name=/^use\\w+Store$/] > CallExpression[callee.name="useCallback"] > ArrowFunctionExpression ObjectExpression',
          message: 'Object literals in useCallback-wrapped zustand selectors create new references every render → max update depth. Use useShallow() or select individual primitives.',
        },
      ],
    },
  },
  {
    ignores: ['node_modules', 'dist', 'src-tauri'],
  },
);
