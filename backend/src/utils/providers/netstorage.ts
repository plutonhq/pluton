const netstorageSettings = [
	{
		label: 'Host Domain',
		value: 'host',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'Domain+path of NetStorage host to connect to. Format should be <domain>/<cpcode>/<content>/ . eg: baseball-nsu.akamaihd.net/123456/content/',
		command: '--netstorage-host',
	},
	{
		label: 'Account Name',
		value: 'account',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Set the NetStorage account name',
		command: '--netstorage-account',
	},
	{
		label: 'Account Secret',
		value: 'secret',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Set the NetStorage account secret/G2O key for authentication.',
		command: '--netstorage-secret',
	},
	{
		label: 'Protocol',
		value: 'protocol',
		fieldType: 'string',
		required: false,
		default: 'https',
		description:
			'Select between HTTP or HTTPS protocol. Most users should choose HTTPS, which is the default. HTTP is provided primarily for debugging purposes.',
		command: '--netstorage-protocol',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--netstorage-description',
	},
];

export default netstorageSettings;
