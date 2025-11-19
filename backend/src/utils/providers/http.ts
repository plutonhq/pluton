const httpSettings = [
	{
		label: 'HTTP URL',
		command: '--http-url',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		value: 'url',
		default: '',
		description:
			'URL of HTTP host to connect to. E.g. "https://example.com", or "https://user:pass@example.com" to use a username and password.',
	},
	{
		label: "Don't escape URL",
		command: '--http-no-escape',
		fieldType: 'bool',
		required: false,
		value: 'no_escape',
		default: false,
		description: 'Do not escape URL metacharacters in path names.',
	},
	{
		label: 'HTTP Headers',
		command: '--http-headers',
		fieldType: 'commaseplist',
		required: false,
		value: 'headers',
		default: '',
		description:
			'Set HTTP headers for all transactions. Use this to set additional HTTP headers for all transactions.',
	},
	{
		label: 'No Ending Slash',
		command: '--http-no-slash',
		fieldType: 'bool',
		required: false,
		value: 'no_slash',
		default: false,
		description:
			"Set this if the site doesn't end directories with /. Use this if your target website does not use / on the end of\ndirectories.",
	},
	{
		label: "Don't use HEAD requests",
		command: '--http-no-head',
		fieldType: 'bool',
		required: false,
		value: 'no_head',
		default: false,
		description:
			'HEAD requests are mainly used to find file sizes in dir listing.\nIf your site is being very slow to load then you can try this option.\nNormally rclone does a HEAD request for each potential file in a\ndirectory listing to:',
	},
	{
		label: 'Description',
		command: '--http-description',
		fieldType: 'string',
		required: false,
		value: 'description',
		default: '',
		description: 'Description of the Storage.',
	},
];

export default httpSettings;
