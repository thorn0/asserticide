import getEslintConfig from '@th2025/eslint-config';

export default [
  { ignores: ['bench-fixtures/**', 'bench/**'] },
  ...getEslintConfig({ tsconfigRootDir: import.meta.dirname }),
];
