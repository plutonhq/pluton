const pixeldrainSettings = [
	{
		label: 'API Key',
		value: 'api_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'API key for your pixeldrain account. Found on https://pixeldrain.com/user/api_keys.',
		command: '--pixeldrain-api-key',
	},
	{
		label: 'Root Folder ID',
		value: 'root_folder_id',
		fieldType: 'string',
		required: false,
		default: 'me',
		description:
			"Root of the filesystem to use. Set to 'me' to use your personal filesystem. Set to a shared directory ID to use a shared directory.",
		command: '--pixeldrain-root-folder-id',
	},
	{
		label: 'API URL',
		value: 'api_url',
		fieldType: 'string',
		required: false,
		default: 'https://pixeldrain.com/api',
		description:
			"The API endpoint to connect to. In the vast majority of cases it's fine to leave this at default. It is only intended to be changed for testing purposes.",
		command: '--pixeldrain-api-url',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--pixeldrain-description',
	},
];

export default pixeldrainSettings;
