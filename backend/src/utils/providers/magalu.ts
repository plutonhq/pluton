import s3Options from './_s3Options';

const magaluSettings = [
	{
		label: 'Access Key ID',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Access Key ID.',
		command: '--s3-access-key-id',
	},
	{
		label: 'Secret Access Key',
		value: 'secret_access_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Secret Access Key (password).',
		command: '--s3-secret-access-key',
	},
	{
		label: 'Region',
		value: 'ednpoint',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'São Paulo, SP (BR), br-se1', value: 'br-se1.magaluobjects.com' },
			{ label: 'Fortaleza, CE (BR), br-ne1', value: 'br-ne1.magaluobjects.com' },
			{ label: 'Insert Custon Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description:
			"Select a Region to connect to that region's API Ednpoint. Custom Endpoint example: br-ne1.magaluobjects.com",
		command: '--s3-region',
	},
	...s3Options,
];

export default magaluSettings;
