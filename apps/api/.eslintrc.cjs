'use strict';

const path = require('path');

module.exports = {
  root: true,
  extends: [require.resolve('@yannis/config/eslint')],
  parserOptions: {
    project: path.join(__dirname, 'tsconfig.json'),
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.d.ts'],
  /**
   * Role/location notification fan-out (`createForRole` / `createForLocation`) performs sequential
   * per-user work — awaiting it on hot paths inflates p99 latency. Call `enqueueCreateForRole` /
   * `enqueueCreateForLocation` instead; see NotificationsService.
   */
  overrides: [
    {
      files: [
        'src/orders/**/*.ts',
        'src/inventory/**/*.ts',
        'src/cart/**/*.ts',
        'src/payments/**/*.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'AwaitExpression CallExpression[callee.property.name="createForRole"]',
            message:
              'Do not await createForRole on latency-sensitive paths; use notifications.enqueueCreateForRole() instead.',
          },
          {
            selector:
              'AwaitExpression CallExpression[callee.property.name="createForLocation"]',
            message:
              'Do not await createForLocation on latency-sensitive paths; use notifications.enqueueCreateForLocation() instead.',
          },
        ],
      },
    },
  ],
};
