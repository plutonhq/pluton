import s3Options from './_s3Options';

const minioSettings = [
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
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'Your Minio Endpoint to connect to. example: http://192.168.1.106:9000 or https://play.min.io',
		command: '--s3-endpoint',
	},
	{
		label: 'Region',
		value: 'region',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Minio Region',
		command: '--s3-region',
	},
	{
		label: 'Bucket Name',
		value: 'bucket',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Minio Bucket Name. eg: pluton-backup',
		command: '',
	},
	...s3Options,
];

export default minioSettings;
