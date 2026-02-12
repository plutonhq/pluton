import s3Options from './_s3Options';

const outscaleSettings = [
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
			{ label: 'Paris, France (eu-west-2)', value: 'eu-west-2' },
			{ label: 'New Jersey, USA (us-east-2)', value: 'us-east-2' },
			{ label: 'California, USA (us-west-1)', value: 'us-west-1' },
			{ label: 'SecNumCloud, Paris, France (cloudgouv-eu-west-1)', value: 'cloudgouv-eu-west-1' },
			{ label: 'Tokyo, Japan (ap-northeast-1)', value: 'ap-northeast-1' },
			{ label: 'Insert Custon Region', value: 'custom' },
		],
		required: true,
		default: '',
		description: "Select a Region to connect to that region's API Endpoint.",
		command: '--s3-region',
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

export default outscaleSettings;
