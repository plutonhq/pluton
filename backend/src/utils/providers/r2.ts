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
		fieldType: 'string',
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
	// {
	// 	label: 'ACL',
	// 	value: 'acl',
	// 	fieldType: 'string',
	// 	authFieldType: 'client',
	// 	required: false,
	// 	default: '',
	// 	description:
	// 		"Canned ACL used when creating buckets and storing or copying objects. This ACL is used for creating objects and if bucket_acl isn't set, for creating buckets too.",
	// 	command: '--s3-acl',
	// },
	...s3Options,
];

export default r2Settings;
