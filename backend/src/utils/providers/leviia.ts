import s3Options from './_s3Options';

const leviiaSettings = [
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
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'Your Leviia Endpoint. Can be found in your Leviia dashboard. example: s3.eu-west.leviia.com',
		command: '--s3-endpoint',
	},
	...s3Options,
];

export default leviiaSettings;
