'use strict';

const path = require('path');

module.exports = {
  root: true,
  extends: [require.resolve('@yannis/config/eslint')],
  parserOptions: {
    project: path.join(__dirname, 'tsconfig.json'),
    tsconfigRootDir: __dirname,
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.d.ts'],
};
