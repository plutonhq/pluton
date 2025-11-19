const filesSettings = [
	{
		label: 'Site Domain',
		value: 'site',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description:
			'Your site subdomain (e.g. mysite) or custom domain (e.g. myfiles.customdomain.com).',
		command: '--filescom-site',
	},
	{
		label: 'API Key',
		value: 'api_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'The API key used to authenticate with Files.com.',
		command: '--filescom-api-key',
	},
	{
		label: 'Username',
		value: 'username',
		fieldType: 'string',
		authFieldType: 'password',
		required: false,
		default: '',
		description: 'The username used to authenticate with Files.com.',
		command: '--filescom-username',
	},
	{
		label: 'Password',
		value: 'password',
		fieldType: 'string',
		authFieldType: 'password',
		required: false,
		default: '',
		description:
			'The password used to authenticate with Files.com. NB Input to this must be obscured - see rclone obscure.',
		command: '--filescom-password',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,backslash,del,ctl,rightspace,rightcrlfhtvt,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--filescom-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--filescom-description',
	},
];

export default filesSettings;
