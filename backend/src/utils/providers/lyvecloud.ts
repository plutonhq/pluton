import s3Options from './_s3Options';

const lyvecloudSettings = [
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
		label: 'Endpoint',
		value: 'endpoint',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'US-East-1 (N. Virginia)', value: 's3.us-east-1.lyvecloud.seagate.com' },
			{ label: 'US-West-1 (N. California)', value: 's3.us-west-1.lyvecloud.seagate.com' },
			{
				label: 'AP-Southeast-1 (Singapore)',
				value: 's3.ap-southeast-1.lyvecloud.seagate.com',
			},
			{ label: 'EU-West-1 (London)', value: 's3.eu-west-1.lyvecloud.seagate.com' },
			{ label: 'US-Central-2 (Texas)', value: 's3.us-central-2.lyvecloud.seagate.com' },
			{ label: 'Insert Custon Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description:
			"Select a Region to connect to that region's API Ednpoint. Custom Endpoint example: s3.us-central-2.lyvecloud.seagate.com",
		command: '--s3-endpoint',
	},
	...s3Options,
];

export default lyvecloudSettings;
