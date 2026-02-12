const shadeSettings = [
	{
		label: 'Drive ID',
		value: 'drive_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'The ID of your drive. You can find this in the drive settings.',
		command: '--shade-drive-id',
	},
	{
		label: 'API Key',
		value: 'api_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'An API key for your Shade account.',
		command: '--shade-api-key',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,backslash,del,ctl,invalidutf8,dot',
		description: 'The encoding for the backend.',
		command: '--shade-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--shade-description',
	},
];

export default shadeSettings;
