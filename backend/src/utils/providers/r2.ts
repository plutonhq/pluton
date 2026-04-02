import s3Options from './_s3Options';

const r2Settings = [
	{
		label: 'Access Key ID',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'R2 Access Key ID.',
		command: '--s3-access-key-id',
	},
	{
		label: 'Secret Access Key',
		value: 'secret_access_key',
		fieldType: 'password',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'R2 Secret Access Key (password).',
		command: '--s3-secret-access-key',
	},
	{
		label: 'Account ID',
		value: 'endpoint',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your R2 Account ID, which will be used to generate the Endpoint.',
		command: '--s3-endpoint',
	},
	{
		label: 'Bucket Name',
		value: 'bucket',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your R2 Bucket Name. eg: pluton-backup',
		command: '',
	},
	...s3Options,
];

export default r2Settings;
