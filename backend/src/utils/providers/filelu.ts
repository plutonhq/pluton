const fileluSettings = [
	{
		label: 'Rclone Key',
		value: 'key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your FileLu key from My Account.',
		command: '--filelu-key',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default:
			'slash,ltgt,doublequote,singlequote,backquote,dollar,colon,question,asterisk,pipe,hash,percent,backslash,crlf,del,ctl,leftspace,leftperiod,lefttilde,leftcrlfhtvt,rightspace,rightperiod,rightcrlfhtvt,invalidutf8,dot,squarebracket,semicolon,exclamation',
		description: 'The encoding for the backend.',
		command: '--filelu-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--filelu-description',
	},
];

export default fileluSettings;
