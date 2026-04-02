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
		fieldType: 'password',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Secret Access Key (password).',
		command: '--s3-secret-access-key',
	},
	{
		label: 'Region',
		value: 'endpoint',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'São Paulo, SP (BR), br-se1', value: 'br-se1.magaluobjects.com' },
			{ label: 'Fortaleza, CE (BR), br-ne1', value: 'br-ne1.magaluobjects.com' },
			{ label: 'Insert Custom Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description:
			"Select a Region to connect to that region's API Endpoint. Custom Endpoint example: br-ne1.magaluobjects.com",
		command: '--s3-region',
	},
	{
		label: 'Bucket Name',
		value: 'bucket',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Magalu Bucket Name. eg: pluton-backup',
		command: '',
	},
	...s3Options,
];

export default magaluSettings;
