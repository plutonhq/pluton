import s3Options from './_s3Options';

const ionosSettings = [
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
		label: 'Endpoint',
		value: 'endpoint',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Endpoint', value: '' },
			{ label: 's3.eu-central-3.ionoscloud.com', value: 's3.eu-central-3.ionoscloud.com' },
			{ label: 's3.us-central-1.ionoscloud.com', value: 's3.us-central-1.ionoscloud.com' },
			{ label: 's3.eu-central-1.ionoscloud.com', value: 's3.eu-central-1.ionoscloud.com' },
			{ label: 's3.eu-central-2.ionoscloud.com', value: 's3.eu-central-2.ionoscloud.com' },
			{ label: 's3.eu-south-2.ionoscloud.com', value: 's3.eu-south-2.ionoscloud.com' },
			{ label: 'Insert Custom Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description: 'Your IONOS Cloud Endpoint to connect to.',
		command: '--s3-endpoint',
	},
	{
		label: 'Bucket Name',
		value: 'bucket',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your IONOS Cloud Object Storage Bucket Name. eg: pluton-backup',
		command: '',
	},
	...s3Options,
];

export default ionosSettings;
