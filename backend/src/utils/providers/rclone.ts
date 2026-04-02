import s3Options from './_s3Options';

const rcloneSettings = [
	{
		label: 'Access Key ID',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Rclone Serve S3 Access Key ID.',
		command: '--s3-access-key-id',
	},
	{
		label: 'Secret Access Key',
		value: 'secret_access_key',
		fieldType: 'password',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Rclone Serve S3 Secret Access Key (password).',
		command: '--s3-secret-access-key',
	},
	{
		label: 'Endpoint',
		value: 'endpoint',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Rclone Serve S3 Server Endpoint.',
		command: '--s3-endpoint',
	},
	{
		label: 'Bucket Name',
		value: 'bucket',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Rclone Serve S3 Bucket Name. eg: pluton-backup',
		command: '',
	},
	...s3Options,
];

export default rcloneSettings;
