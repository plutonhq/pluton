import s3Options from './_s3Options';

const arvanSettings = [
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
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: 'ir-thr-at1',
		description: 'Your Arvan Cloud Region. eg: ir-thr-at1',
		command: '--s3-endpoint',
	},
	{
		label: 'Endpoint',
		value: 'endpoint',
		fieldType: 'string',
		authFieldType: 'client',
		required: false,
		default: '',
		description:
			'Your Arvan Cloud Endpoint. eg: s3.ir-thr-at1.arvanstorage.ir or BUCKETNAME.ir-thr-at1.arvanstorage.ir',
		command: '--s3-endpoint',
	},
	...s3Options,
];

export default arvanSettings;
