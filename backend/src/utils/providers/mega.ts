const megaSettings = [
	{
		label: 'Username',
		value: 'user',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'User name.',
		command: '--mega-user',
	},
	{
		label: 'Password',
		value: 'pass',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Password.',
		command: '--mega-pass',
	},
	{
		label: 'Debug Mode',
		value: 'debug',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Output additional debug information from MEGA for troubleshooting.',
		command: '--mega-debug',
	},
	{
		label: 'Hard Delete',
		value: 'hard_delete',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Delete files permanently rather than putting them into the trash.',
		command: '--mega-hard-delete',
	},
	{
		label: 'Use HTTPS',
		value: 'use_https',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Use HTTPS for transfers. MEGA uses plain HTTP by default. Some ISPs throttle HTTP connections, making transfers slow. Enabling HTTPS increases CPU usage and network overhead but may help with throttled connections.',
		command: '--mega-use-https',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,invalidutf8,dot',
		description:
			'The encoding for the backend.',
		command: '--mega-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--mega-description',
	},
];

export default megaSettings;
