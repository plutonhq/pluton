export type ProviderSetting = {
	label: string;
	value: string;
	fieldType: string;
	required: boolean;
	default: string | boolean;
	description: string;
	authFieldType?: string;
	command?: string;
	allowCustom?: boolean;
	options?: { label: string; value: string; showInput?: boolean }[];
	condition?: Record<string, number | boolean | string>[];
};
