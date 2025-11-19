import s3Options from './_s3Options';

const spacesSettings = [
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
			{ label: 'New York City, United States (NYC1)', value: 'nyc1.digitaloceanspaces.com' },
			{ label: 'New York City, United States (NYC2)', value: 'nyc2.digitaloceanspaces.com' },
			{ label: 'New York City, United States (NYC3)', value: 'nyc3.digitaloceanspaces.com' },
			{ label: 'Amsterdam, the Netherlands (AMS3)', value: 'ams3.digitaloceanspaces.com' },
			{ label: 'San Francisco, United States (SFO2)', value: 'sfo2.digitaloceanspaces.com' },
			{ label: 'San Francisco, United States (SFO3)', value: 'sfo3.digitaloceanspaces.com' },
			{ label: 'Singapore (SGP1)', value: 'sgp1.digitaloceanspaces.com' },
			{ label: 'London, United Kingdom (LON1)', value: 'lon1.digitaloceanspaces.com' },
			{ label: 'Frankfurt, Germany (FRA1)', value: 'fra1.digitaloceanspaces.com' },
			{ label: 'Toronto, Canada (TOR1)', value: 'tor1.digitaloceanspaces.com' },
			{ label: 'Bangalore, India (BLR1)', value: 'blr1.digitaloceanspaces.com' },
			{ label: 'Sydney, Australia (SYD1)', value: 'syd1.digitaloceanspaces.com' },
			{ label: 'Enter Custom Endpoint', value: 'custom' },
		],
		required: true,
		default: '',
		description:
			"Select a Region to connect to that region's API Endpoint. Custom Endpoint Example: xxxx.digitaloceanspaces.com",
		command: '--s3-endpoint',
	},
	...s3Options,
];

export default spacesSettings;
