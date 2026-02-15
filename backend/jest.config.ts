import type { Config } from 'jest';

const config: Config = {
	// preset: 'ts-jest',
	testEnvironment: 'node',
	verbose: true,
	clearMocks: true,

	// Explicitly define the transform using ts-jest
	transform: {
		// This regex now tells Jest to use ts-jest for .ts, .tsx, .js, and .jsx files
		'^.+\\.(t|j)sx?$': [
			'ts-jest',
			{
				useESM: true,
				tsconfig: {
					module: 'esnext',
					target: 'esnext',
					moduleResolution: 'bundler',
					esModuleInterop: true,
					allowSyntheticDefaultImports: true,
				},
				diagnostics: false,
			},
		],
	},
	// ------------------------------

	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
	extensionsToTreatAsEsm: ['.ts'],

	// Tell Jest to only look for test files inside the __tests__ directory
	testMatch: ['**/__tests__/**/*.test.ts'],

	moduleNameMapper: {
		// This alias is now even more important to keep imports clean
		'^#core-backend/(.*)$': '<rootDir>/src/$1',
	},
	setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
	transformIgnorePatterns: ['/node_modules/(?!nanoid)/'],
};

export default config;
