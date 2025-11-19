const fichierSettings = [
	{
		label: 'API Key',
		value: 'api_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your API Key, get it from https://1fichier.com/console/params.pl.',
		command: '--fichier-api-key',
	},
	{
		label: 'Shared Folder',
		value: 'shared_folder',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'If you want to download a shared folder, add this parameter.',
		command: '--fichier-shared-folder',
	},
	{
		label: 'File Password',
		value: 'file_password',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			'If you want to download a shared file that is password protected, add this parameter. NB Input to this must be obscured - see rclone obscure.',
		command: '--fichier-file-password',
	},
	{
		label: 'Folder Password',
		value: 'folder_password',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			'If you want to list the files in a shared folder that is password protected, add this parameter. NB Input to this must be obscured - see rclone obscure.',
		command: '--fichier-folder-password',
	},
	{
		label: 'CDN',
		value: 'cdn',
		fieldType: 'bool',
		required: false,
		default: false,
		description: 'Set if you wish to use CDN download links.',
		command: '--fichier-cdn',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default:
			'slash,ltgt,doublequote,singlequote,backquote,dollar,backslash,del,ctl,leftspace,rightspace,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--fichier-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--fichier-description',
	},
];

export default fichierSettings;
