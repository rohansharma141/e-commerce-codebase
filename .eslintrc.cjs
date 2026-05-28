/**
 * Root ESLint config.
 *
 * The most important rule here is @nx/enforce-module-boundaries — it stops one
 * module from reaching into another module's src/. See CLAUDE.md "Non-negotiable rules".
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', '@nx'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/.nx/**', '**/coverage/**'],
  env: { node: true, jest: true },
  overrides: [
    {
      files: ['*.js', '*.cjs'],
      env: { node: true, commonjs: true },
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      files: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.cjs', '*.mjs'],
      rules: {
        '@nx/enforce-module-boundaries': [
          'error',
          {
            enforceBuildableLibDependency: true,
            allow: [],
            depConstraints: [
              // apps/api is the composition root — it wires every module.
              // The "never cross another module's src" rule is between modules,
              // not between the app and a module.
              {
                sourceTag: 'scope:app',
                onlyDependOnLibsWithTags: [
                  'scope:shared',
                  'scope:module',
                  'type:contracts',
                  'type:src',
                ],
              },
              {
                sourceTag: 'scope:shared',
                onlyDependOnLibsWithTags: ['scope:shared'],
              },
              // A module's src may consume shared libs and OTHER modules'
              // contracts — never another module's src.
              {
                sourceTag: 'type:src',
                onlyDependOnLibsWithTags: ['scope:shared', 'type:contracts'],
              },
              // Contracts are pure: shared types only (DTOs, event names).
              {
                sourceTag: 'type:contracts',
                onlyDependOnLibsWithTags: ['scope:shared'],
              },
            ],
          },
        ],
      },
    },
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['*.spec.ts', '*.test.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
