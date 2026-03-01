const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = (options) => {
  return {
    ...options,
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
  };
};
