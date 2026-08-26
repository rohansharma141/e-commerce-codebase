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
              // Contracts may consume shared libs AND other modules'
              // contracts. The latter is what lets orders/contracts reference
              // pricing/contracts' AppliedPromotionSnapshot, etc. The
              // discipline that matters ("never reach into another module's
              // src") is still enforced for type:src above.
              {
                sourceTag: 'type:contracts',
                onlyDependOnLibsWithTags: ['scope:shared', 'type:contracts'],
              },
              // SELLABLE-SEPARATELY RULE.
              // The storefront is a separate deployable that talks to the
              // api ONLY over its public GraphQL/REST schema. In code, that
              // means it may only import the generated `api-client` package
              // — never a module's contracts, never a module's src, never
              // a backend shared lib. If you find this rule blocking you,
              // the fix is to expose the missing capability via the api,
              // not to relax the boundary. See CLAUDE.md.
              {
                sourceTag: 'scope:storefront',
                onlyDependOnLibsWithTags: ['scope:api-client'],
              },
              // The api-client is generated from the api's public schema
              // and is intentionally a leaf — it depends on nothing in this
              // workspace.
              {
                sourceTag: 'scope:api-client',
                onlyDependOnLibsWithTags: [],
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
        // NOTE: '@nx/enforce-module-boundaries' is deliberately NOT disabled
        // here any more. It used to be, with the reasoning that boundary
        // discipline is about production code and integration fixtures need
        // to hand-construct services across modules. The effect was that the
        // repository's single loudest architectural claim — never import
        // another module's src — was unenforced in exactly the files most
        // tempted to break it. A rule that is off where it would bite is not
        // a rule. Cross-module wiring belongs in the composition root
        // (apps/api), which is permitted to know module internals; a test
        // that needs it belongs there too.
      },
    },
    {
      // Belt to the boundary rule's braces.
      //
      // @nx/enforce-module-boundaries reasons about imports by project alias,
      // so it sees '@platform/modules/cart/src' and stops it. It does not see
      // '../../cart/src/cart.repository' — the same import, spelled as a
      // relative path, walks straight through. This closes that spelling.
      files: ['packages/modules/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['../../*/src/*', '../../*/src', '**/../../*/src/*'],
                message:
                  "Never reach into another module's src, even by relative path — import its contracts instead. Cross-module wiring belongs in apps/api. See CLAUDE.md.",
              },
            ],
          },
        ],
      },
    },
  ],
};
