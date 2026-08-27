const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = (options) => {
  // Nest's base webpack config injects ForkTsCheckerWebpackPlugin. Its type-check
  // runs in a child process with its OWN ~2GB heap that does NOT inherit the
  // parent's --max-old-space-size, so on this large monorepo it OOMs mid-watch
  // (SIGABRT at ~2GB) even when the app itself compiled fine. ts-loader below
  // already runs transpileOnly, and types are checked separately via
  // `tsc --noEmit`, so the fork checker is pure overhead in dev — drop it.
  const plugins = (options.plugins ?? []).filter(
    (p) => p && p.constructor && p.constructor.name !== 'ForkTsCheckerWebpackPlugin',
  );

  return {
    ...options,
    plugins,
    externals: [
      nodeExternals({
        // Allow workspace packages to be bundled (not treated as external)
        allowlist: [/^@yannis\//],
      }),
    ],
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                transpileOnly: true,
                // Use the API tsconfig for all .ts files including workspace deps
                configFile: path.resolve(__dirname, 'tsconfig.json'),
              },
            },
          ],
          // Include workspace packages in ts-loader processing
          include: [
            path.resolve(__dirname, 'src'),
            path.resolve(__dirname, '../../packages'),
          ],
        },
      ],
    },
    resolve: {
      ...options.resolve,
      extensions: ['.ts', '.js', '.json'],
    },
    watchOptions: {
      // Watch shared packages so changes trigger a rebuild in dev mode
      ignored: /node_modules\/(?!@yannis)/,
    },
    snapshot: {
      // Treat workspace packages as managed (not immutable) so webpack
      // detects file changes inside packages/shared during --watch
      managedPaths: [],
    },
  };
};
