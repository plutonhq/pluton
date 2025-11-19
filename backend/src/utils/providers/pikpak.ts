const pikpakSettings = [
	{
		label: 'Username',
		value: 'user',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Pikpak username.',
		command: '--pikpak-user',
	},
	{
		label: 'Password',
		value: 'pass',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Pikpak password. NB Input to this must be obscured - see rclone obscure.',
		command: '--pikpak-pass',
	},
	{
		label: 'Device ID',
		value: 'device_id',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Device ID used for authorization.',
		command: '--pikpak-device-id',
	},
	{
		label: 'User Agent',
		value: 'user_agent',
		fieldType: 'string',
		required: false,
		default: 'mozilla/5.0 (windows nt 10.0; win64; x64; rv',
		description:
			'HTTP user agent for pikpak. Defaults to "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0" or "--pikpak-user-agent" provided on command line.',
		command: '--pikpak-user-agent',
	},
	{
		label: 'Root Folder ID',
		value: 'root_folder_id',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			'ID of the root folder. Leave blank normally. Fill in for rclone to use a non root folder as its starting point.',
		command: '--pikpak-root-folder-id',
	},
	{
		label: 'Use Trash',
		value: 'use_trash',
		fieldType: 'bool',
		required: false,
		default: true,
		description:
			'Send files to the trash instead of deleting permanently. Defaults to true, namely sending files to the trash. Use --pikpak-use-trash=false to delete files permanently instead.',
		command: '--pikpak-use-trash',
	},
	{
		label: 'Trashed Only',
		value: 'trashed_only',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Only show files that are in the trash. This will show trashed files in their original directory structure.',
		command: '--pikpak-trashed-only',
	},
	{
		label: 'No Media Link',
		value: 'no_media_link',
		fieldType: 'bool',
		required: false,
		default: false,
		description:
			'Use original file links instead of media links. This avoids issues caused by invalid media links, but may reduce download speeds.',
		command: '--pikpak-no-media-link',
	},
	{
		label: 'Hash Memory Limit',
		value: 'hash_memory_limit',
		fieldType: 'sizesuffix',
		required: false,
		default: '10mi',
		description: 'Files bigger than this will be cached on disk to calculate hash if required.',
		command: '--pikpak-hash-memory-limit',
	},
	{
		label: 'Chunk Size',
		value: 'chunk_size',
		fieldType: 'sizesuffix',
		required: false,
		default: '5mi',
		description:
			'Chunk size for multipart uploads. Large files will be uploaded in chunks of this size.',
		command: '--pikpak-chunk-size',
	},
	{
		label: 'Upload Concurrency',
		value: 'upload_concurrency',
		fieldType: 'int',
		required: false,
		default: '5',
		description:
			'Concurrency for multipart uploads. This is the number of chunks of the same file that are uploaded concurrently for multipart uploads.',
		command: '--pikpak-upload-concurrency',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default:
			'slash,ltgt,doublequote,colon,question,asterisk,pipe,backslash,ctl,leftspace,rightspace,rightperiod,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--pikpak-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--pikpak-description',
	},
];

export default pikpakSettings;
