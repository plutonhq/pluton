import s3Options from './_s3Options';

const s3Settings = [
	{
		label: 'Environment Auth',
		value: 'env_auth',
		fieldType: 'bool',
		authFieldType: 'client',
		required: false,
		default: false,
		description:
			'Get AWS credentials from runtime (environment variables or EC2/ECS meta data if no env vars).',
		command: '--s3-env-auth',
	},
	{
		label: 'Access Key ID',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'AWS Access Key ID. Leave blank for anonymous access or runtime credentials.',
		command: '--s3-access-key-id',
		condition: [{ env_auth: false }],
	},
	{
		label: 'Secret Access Key',
		value: 'secret_access_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'AWS Secret Access Key (password). Leave blank for anonymous access or runtime credentials.',
		command: '--s3-secret-access-key',
		condition: [{ env_auth: false }],
	},
	{
		label: 'Region',
		value: 'region',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Region to connect to.',
		command: '--s3-region',
	},
	{
		label: 'Endpoint',
		value: 'endpoint',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'Endpoint for S3 API. Leave blank if using AWS to use the default endpoint for the region.',
		command: '--s3-endpoint',
	},
	{
		label: 'Location Constraint',
		value: 'location_constraint',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'Location constraint - must be set to match the Region. Used when creating buckets only.',
		command: '--s3-location-constraint',
	},
	{
		label: 'ACL',
		value: 'acl',
		fieldType: 'string',
		authFieldType: 'client',
		required: false,
		default: '',
		description:
			"Canned ACL used when creating buckets and storing or copying objects. This ACL is used for creating objects and if bucket_acl isn't set, for creating buckets too.",
		command: '--s3-acl',
	},
	...s3Options,
];

export default s3Settings;
