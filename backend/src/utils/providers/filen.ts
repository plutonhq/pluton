const filenSettings = [
	{
		label: 'Email',
		value: 'email',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Email of your Filen account.',
		command: '--filen-email',
	},
	{
		label: 'Password',
		value: 'password',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Password of your Filen account.',
		command: '--filen-password',
	},
	{
		label: 'API Key',
		value: 'api_key',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description:
			'API Key for your Filen account. You can generate one using the Filen CLI export-api-key command.',
		command: '--filen-api-key',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,del,ctl,invalidutf8,dot',
		description: 'The encoding for the backend.',
		command: '--filen-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--filen-description',
	},
];

export default filenSettings;
