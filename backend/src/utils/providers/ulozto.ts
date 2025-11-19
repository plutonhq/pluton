const uloztoSettings = [
	{
		label: 'Username',
		value: 'username',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'The username of the principal to operate as.',
		command: '--ulozto-username',
	},
	{
		label: 'Password',
		value: 'password',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description:
			'The password for the user. NB Input to this must be obscured - see rclone obscure.',
		command: '--ulozto-password',
	},
	{
		label: 'App Token',
		value: 'app_token',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			'The application token identifying the app. An app API key can be either found in the API doc https://uloz.to/upload-resumable-api-beta or obtained from customer service.',
		command: '--ulozto-app-token',
	},
	{
		label: 'Root Folder Slug',
		value: 'root_folder_slug',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			"If set, rclone will use this folder as the root folder for all operations. For example, if the slug identifies 'foo/bar/', 'ulozto:baz' is equivalent to 'ulozto:foo/bar/baz' without any root slug set.",
		command: '--ulozto-root-folder-slug',
	},
	{
		label: 'List Page Size',
		value: 'list_page_size',
		fieldType: 'int',
		required: false,
		default: '500',
		description: 'The size of a single page for list commands. 1-500',
		command: '--ulozto-list-page-size',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,backslash,del,ctl,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--ulozto-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--ulozto-description',
	},
];

export default uloztoSettings;
