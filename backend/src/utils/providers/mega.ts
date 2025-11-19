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
		description: 'Password. NB Input to this must be obscured - see rclone obscure.',
		command: '--mega-pass',
	},
	{
		label: 'Debug Mode',
		value: 'debug',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Output more debug from Mega. If this flag is set (along with -vv) it will print further debugging information from the mega backend.',
		command: '--mega-debug',
	},
	{
		label: 'Hard Delete',
		value: 'hard_delete',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Delete files permanently rather than putting them into the trash. Normally the mega backend will put all deletions into the trash rather than permanently deleting them.  If you specify this then rclone will permanently delete objects instead.',
		command: '--mega-hard-delete',
	},
	{
		label: 'Use HTTPS',
		value: 'use_https',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Use HTTPS for transfers. MEGA uses plain text HTTP connections by default. Some ISPs throttle HTTP connections, this causes transfers to become very slow. Enabling this will force MEGA to use HTTPS for all transfers. HTTPS is normally not necessary since all data is already encrypted anyway. Enabling it will increase CPU usage and add network overhead.',
		command: '--mega-use-https',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
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
