import type { Config } from 'tailwindcss';
import baseConfig from '@yannis/config/tailwind';

const config: Config = {
  ...(baseConfig as Config),
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      ...(baseConfig as Config).theme?.extend,
      maxWidth: {
        tpl: '1200px',
      },
    },
  },
};

export default config;
