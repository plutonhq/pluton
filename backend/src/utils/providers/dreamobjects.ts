import s3Options from './_s3Options';

const dreamobjectsSettings = [
	{
		label: 'Access Key ID',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Access Key ID.',
		command: '--s3-access-key-id',
	},
	{
		label: 'Secret Access Key',
		value: 'secret_access_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Secret Access Key (password).',
		command: '--s3-secret-access-key',
	},
	{
		label: 'Region',
		value: 'region',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'DreamObjects US-East 1', value: 'objects-us-east-1.dream.io' },
			{ label: 'DreamObjects US-East 5', value: 's3.us-east-005.dream.io' },
			{ label: 'Enter Custom Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description:
			"Select a Region to connect to that region's API Endpoint. Find out which endpoint you should connect to here: https://help.dreamhost.com/hc/en-us/articles/32254965300372-DreamObjects-cluster-differences",
		command: '--s3-endpoint',
	},
	...s3Options,
];

export default dreamobjectsSettings;
