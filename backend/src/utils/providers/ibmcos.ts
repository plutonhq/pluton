import s3Options from './_s3Options';

const ibmcosSettings = [
	{
		label: 'Access Key ID',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Access Key ID.',
		command: '--s3-access-key-id',
	},
	{
		label: 'Secret Access Key',
		value: 'secret_access_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'Your Secret Access Key (password).',
		command: '--s3-secret-access-key',
	},
	{
		label: 'Region',
		value: 'endpoint',
		fieldType: 'select',
		authFieldType: 'client',
		allowCustom: true,
		options: [
			{ label: 'Select Region', value: '' },
			{ label: 'us-south', value: 's3.us-south.cloud-object-storage.appdomain.cloud' },
			{ label: 'us-east', value: 's3.us-east.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu-gb', value: 's3.eu-gb.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu-de', value: 's3.eu-de.cloud-object-storage.appdomain.cloud' },
			{ label: 'au-syd', value: 's3.au-syd.cloud-object-storage.appdomain.cloud' },
			{ label: 'jp-tok', value: 's3.jp-tok.cloud-object-storage.appdomain.cloud' },
			{ label: 'jp-osa', value: 's3.jp-osa.cloud-object-storage.appdomain.cloud' },
			{ label: 'ca-tor', value: 's3.ca-tor.cloud-object-storage.appdomain.cloud' },
			{ label: 'br-sao', value: 's3.br-sao.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu-es', value: 's3.eu-es.cloud-object-storage.appdomain.cloud' },
			{
				label: 'us-south (Private)',
				value: 's3.private.us-south.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'us-east (Private)',
				value: 's3.private.us-east.cloud-object-storage.appdomain.cloud',
			},
			{ label: 'eu-gb (Private)', value: 's3.private.eu-gb.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu-de (Private)', value: 's3.private.eu-de.cloud-object-storage.appdomain.cloud' },
			{
				label: 'au-syd (Private)',
				value: 's3.private.au-syd.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'jp-tok (Private)',
				value: 's3.private.jp-tok.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'jp-osa (Private)',
				value: 's3.private.jp-osa.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'ca-tor (Private)',
				value: 's3.private.ca-tor.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'br-sao (Private)',
				value: 's3.private.br-sao.cloud-object-storage.appdomain.cloud',
			},
			{ label: 'eu-es (Private)', value: 's3.private.eu-es.cloud-object-storage.appdomain.cloud' },

			{
				label: 'us-south (Direct)',
				value: 's3.direct.us-south.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'us-east (Direct)',
				value: 's3.direct.us-east.cloud-object-storage.appdomain.cloud',
			},
			{ label: 'eu-gb (Direct)', value: 's3.direct.eu-gb.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu-de (Direct)', value: 's3.direct.eu-de.cloud-object-storage.appdomain.cloud' },
			{ label: 'au-syd (Direct)', value: 's3.direct.au-syd.cloud-object-storage.appdomain.cloud' },
			{ label: 'jp-tok (Direct)', value: 's3.direct.jp-tok.cloud-object-storage.appdomain.cloud' },
			{ label: 'jp-osa (Direct)', value: 's3.direct.jp-osa.cloud-object-storage.appdomain.cloud' },
			{ label: 'ca-tor (Direct)', value: 's3.direct.ca-tor.cloud-object-storage.appdomain.cloud' },
			{ label: 'br-sao (Direct)', value: 's3.direct.br-sao.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu-es (Direct)', value: 's3.direct.eu-es.cloud-object-storage.appdomain.cloud' },
			{ label: 'us (Cross-Region)', value: 's3.us.cloud-object-storage.appdomain.cloud' },
			{ label: 'eu (Cross-Region)', value: 's3.eu.cloud-object-storage.appdomain.cloud' },
			{ label: 'ap (Cross-Region)', value: 's3.ap.cloud-object-storage.appdomain.cloud' },

			{
				label: 'us (Cross-Region Private)',
				value: 's3.private.us.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'eu (Cross-Region Private)',
				value: 's3.private.eu.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'ap (Cross-Region Private)',
				value: 's3.private.ap.cloud-object-storage.appdomain.cloud',
			},

			{
				label: 'us (Cross-Region Direct)',
				value: 's3.direct.us.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'eu (Cross-Region Direct)',
				value: 's3.direct.eu.cloud-object-storage.appdomain.cloud',
			},
			{
				label: 'ap (Cross-Region Direct)',
				value: 's3.direct.ap.cloud-object-storage.appdomain.cloud',
			},
			{ label: 'Insert Custon Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description: "Select a Region to connect to that region's API Endpoint.",
		command: '--s3-region',
	},
	{
		label: 'Location Constraint',
		value: 'location_constraint',
		fieldType: 'string',
		authFieldType: 'client',
		required: false,
		default: '',
		description: 'Location Constraint, based on Endpoint.',
		command: '--s3-location-constraing',
	},
	{
		label: 'Access Control List (ACL)',
		value: 'acl',
		fieldType: 'select',
		authFieldType: 'client',
		options: [
			{ label: 'Default', value: '' },
			{ label: 'private (Only the object owner can read/write)', value: 'private' },
			{
				label: 'Public Read (object owner can read/write, others read-only)',
				value: 'public-read',
			},
			{ label: 'Public Read/Write (All Usergroup can read/write)', value: 'public-read-write' },
			{
				label: 'Authenticated Read/Write (AuthenticatedUsers groups can read/write)',
				value: 'authenticated-read',
			},
		],
		required: false,
		default: '',
		description:
			'Access control permissions applied when creating buckets and storing objects.',
		command: '--s3-acl',
	},
	...s3Options,
];

export default ibmcosSettings;
