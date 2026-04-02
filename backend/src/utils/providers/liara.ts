import s3Options from './_s3Options';

const liaraSettings = [
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
		label: 'Bucket Name',
		value: 'bucket',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Liara Bucket Name. eg: pluton-backup',
		command: '',
	},
	...s3Options,
];

export default liaraSettings;
