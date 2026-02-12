const internxtSettings = [
	{
		label: 'Email',
		value: 'email',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Email of your Internxt account.',
		command: '--internxt-email',
	},
	{
		label: 'Password',
		value: 'pass',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Password of your Internxt account.',
		command: '--internxt-pass',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,backslash,crlf,rightperiod,invalidutf8,dot',
		description: 'The encoding for the backend.',
		command: '--internxt-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--internxt-description',
	},
];

export default internxtSettings;
