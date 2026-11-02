import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.angular/**', 'apps/web/public/**', '**/*.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.mjs', 'scripts/**'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setTimeout: 'readonly', localStorage: 'readonly' } },
  },
  {
    // Scripts que corren en el navegador (los inserta scripts/pages/ajustar.mjs en la demo); __APP__, __ACCESO__ y
    // __SECCIONES__ los completa el build.
    files: ['scripts/pages/cabecera/*.js', 'scripts/pages/precarga.js'],
    languageOptions: {
      sourceType: 'script',
      globals: Object.fromEntries(
        [
          'window', 'document', 'location', 'history', 'navigator', 'performance', 'addEventListener', 'innerHeight',
          'matchMedia', 'requestAnimationFrame', 'setInterval', 'clearInterval', 'Worker', 'Blob', 'OffscreenCanvas',
          'ResizeObserver', 'PerformanceObserver', 'Event', 'Document', 'self', 'URL', '__APP__', '__ACCESO__',
          '__SECCIONES__',
        ].map((g) => [g, 'readonly']),
      ),
    },
    rules: {
      // estilo de estos scripts: «a && b()» como instrucción y catch (e) sin usar e
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { caughtErrors: 'none' }],
    },
  },
);
