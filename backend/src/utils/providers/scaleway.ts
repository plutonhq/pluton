import s3Options from './_s3Options';

const scalewaySettings = [
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
			{ label: 'Amsterdam, The Netherlands', value: 'nl-ams' },
			{ label: 'Paris, France', value: 'fr-par' },
			{ label: 'Warsaw, Poland', value: 'pl-waw' },
			{ label: 'Insert Custon Region', value: 'custom' },
		],
		required: true,
		default: '',
		description: "Select a Region to connect to that region's API Ednpoint.",
		command: '--s3-region',
	},
	{
		label: 'Endpoint',
		value: 'endpoint',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'Amsterdam, The Netherlands', value: 's3.nl-ams.scw.cloud' },
			{ label: 'Paris, France', value: 's3.fr-par.scw.cloud' },
			{ label: 'Warsaw, Poland', value: 's3.pl-waw.scw.cloud' },
			{ label: 'Insert Custon Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description:
			"Select a Region to connect to that region's API Ednpoint. Custom Endpoint example: my-bucket.s3.nl-ams.scw.cloud",
		command: '--s3-endpoint',
	},
	{
		label: 'ACL',
		value: 'acl',
		fieldType: 'select',
		authFieldType: 'client',
		options: [
			{ label: 'Private', value: 'private' },
			{ label: 'Public Read', value: 'public-read' },
			{ label: 'Public Read/Write', value: 'public-read-write' },
			{ label: 'Authenticated Read', value: 'authenticated-read' },
			{ label: 'Bucket Owner Read', value: 'bucket-owner-read' },
			{ label: 'Bucket Owner Full Control', value: 'bucket-owner-full-control' },
		],
		required: false,
		default: '',
		description:
			'Control lists (ACL) are subresources attached to buckets and objects. They define which Scaleway users have access to the attached object/bucket, and the type of access they have.',
		command: '--s3-acl',
	},
	...s3Options,
];

export default scalewaySettings;
