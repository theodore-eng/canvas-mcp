import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // Relax rules that conflict with the existing codebase style
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off', // MCP servers log to stderr
      'no-useless-assignment': 'off', // False positives on let-then-assign patterns
      'preserve-caught-error': 'off', // Handled case-by-case
    },
  },
  {
    ignores: ['dist/**', 'tests/**', 'node_modules/**', '*.config.*'],
  },
);
