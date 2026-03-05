import type { Config } from 'tailwindcss';
import baseConfig from '@yannis/config/tailwind';

const config: Config = {
  ...(baseConfig as Config),
  content: ['./app/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
