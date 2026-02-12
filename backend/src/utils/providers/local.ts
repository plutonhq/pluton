const localSettings = [
	{
		label: 'Symlinks',
		value: 'symlinks',
		fieldType: 'bool',
		required: false,
		default: '',
		description: 'Copy symbolic links as text files instead of following them.',
		command: '--local-links',
	},
	{
		label: 'Unicode Normalization',
		value: 'unicode_normalization',
		fieldType: 'bool',
		required: false,
		default: '',
		description: 'Apply unicode NFC normalization to paths and filenames.',
		command: '--local-unicode-normalization',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--b2-description',
	},
];

export default localSettings;
