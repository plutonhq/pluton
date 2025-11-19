const linkboxSettings = [
	{
		label: 'Token',
		value: 'token',
		command: '--linkbox-token',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Token from https://www.linkbox.to/admin/account',
	},
	{
		label: 'Description',
		value: 'description',
		command: '--linkbox-description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
	},
];

export default linkboxSettings;
