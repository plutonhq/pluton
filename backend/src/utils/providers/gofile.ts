const gofileSettings = [
	{
		label: 'API Access Token',
		value: 'access_token',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'API Access token You can get this from the web control panel.',
		command: '--gofile-access-token',
	},
	{
		label: 'Root Folder ID',
		value: 'root_folder_id',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			'ID of the root folder Leave this blank normally, rclone will fill it in automatically.',
		command: '--gofile-root-folder-id',
	},
	{
		label: 'Account ID',
		value: 'account_id',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Account ID Leave this blank normally, rclone will fill it in automatically.',
		command: '--gofile-account-id',
	},
	{
		label: 'List Chunk',
		value: 'list_chunk',
		fieldType: 'int',
		required: false,
		default: '1000',
		description: 'Number of items to list in each call',
		command: '--gofile-list-chunk',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default:
			'slash,ltgt,doublequote,colon,question,asterisk,pipe,backslash,del,ctl,leftperiod,rightperiod,invalidutf8,dot,exclamation',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--gofile-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--gofile-description',
	},
];

export default gofileSettings;
