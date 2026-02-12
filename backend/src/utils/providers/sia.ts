const siaSettings = [
	{
		label: 'API URL',
		value: 'api_url',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: 'http://127.0.0.1:9980',
		description:
			'Sia daemon API URL, like http://sia.daemon.host:9980. The daemon must have API security disabled to allow connections from other hosts (not recommended). Keep default if the Sia daemon runs on localhost.',
		command: '--sia-api-url',
	},
	{
		label: 'API Password',
		value: 'api_password',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'Sia Daemon API Password. Can be found in the apipassword file located in HOME/.sia/ or in the daemon directory.',
		command: '--sia-api-password',
	},
	{
		label: 'User Agent',
		value: 'user_agent',
		fieldType: 'string',
		required: false,
		default: 'sia-agent',
		description:
			"Siad User Agent Sia daemon requires the 'Sia-Agent' user agent by default for security",
		command: '--sia-user-agent',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,question,hash,percent,del,ctl,invalidutf8,dot',
		description: 'The encoding for the backend.',
		command: '--sia-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--sia-description',
	},
];

export default siaSettings;
