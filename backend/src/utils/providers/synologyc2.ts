import s3Options from './_s3Options';

const synologySettings = [
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
		value: 'region',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'EU Endpoint 1 (eu-001)', value: 'eu-001' },
			{ label: 'EU Endpoint 2 (eu-002)', value: 'eu-002' },
			{ label: 'EU Endpoint 3 (eu-003)', value: 'eu-003' },
			{ label: 'EU Endpoint 4 (eu-004)', value: 'eu-004' },
			{ label: 'US Endpoint 1 (us-001)', value: 'us-001' },
			{ label: 'US Endpoint 2 (us-002)', value: 'us-002' },
			{ label: 'US Endpoint 3 (us-003)', value: 'us-003' },
			{ label: 'TW Endpoint 1 (tw-001)', value: 'tw-001' },
			{ label: 'Insert Custon Region', value: 'custom' },
		],
		required: true,
		default: '',
		description: "Select a Region to connect to that region's API Ednpoint.",
		command: '--s3-region',
	},
	...s3Options,
];

export default synologySettings;
