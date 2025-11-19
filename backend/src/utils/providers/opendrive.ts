const opendriveSettings = [
	{
		label: 'Username',
		value: 'username',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Username.',
		command: '--opendrive-username',
	},
	{
		label: 'Password',
		value: 'password',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Password. NB Input to this must be obscured - see rclone obscure.',
		command: '--opendrive-password',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default:
			'slash,ltgt,doublequote,colon,question,asterisk,pipe,backslash,leftspace,leftcrlfhtvt,rightspace,rightcrlfhtvt,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--opendrive-encoding',
	},
	{
		label: 'Chunk Size',
		value: 'chunk_size',
		fieldType: 'sizesuffix',
		required: false,
		default: '10mi',
		description:
			'Files will be uploaded in chunks this size. Note that these chunks are buffered in memory so increasing them will increase memory use.',
		command: '--opendrive-chunk-size',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--opendrive-description',
	},
];

export default opendriveSettings;
