export type StrategyMethodTypes<T> = {
	[K in keyof T as T[K] extends (...args: any) => any ? K : never]: {
		Params: T[K] extends (...args: infer P) => any ? P : never;
		Return: T[K] extends (...args: any) => infer R ? R : never;
	};
};
