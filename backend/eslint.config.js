import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
	{ ignores: ['dist', 'public', 'scripts', 'drizzle', 'data', 'binaries', '__tests__'] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.node,
				...globals.jest,
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'no-console': 'off',
			'no-case-declarations': 'off',
			'prefer-const': 'warn',
			'no-constant-binary-expression': 'warn',
			'no-empty': ['warn', { allowEmptyCatch: true }],
		},
	}
);
