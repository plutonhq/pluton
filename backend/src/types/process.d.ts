// Type definitions for pkg-packaged executables
declare namespace NodeJS {
	interface Process {
		pkg?: {
			entrypoint: string;
			defaultEntrypoint: string;
		};
	}
}

export {};
