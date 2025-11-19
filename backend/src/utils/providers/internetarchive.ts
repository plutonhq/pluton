const internetarchiveSettings = [
	{
		label: 'IAS3 Access Key',
		value: 'access_key_id',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description:
			'IAS3 Access Key. Leave blank for anonymous access. You can find one here: https://archive.org/account/s3.php',
		command: '--internetarchive-access-key-id',
	},
	{
		label: 'IAS3 Secret Key',
		value: 'secret_access_key',
		fieldType: 'string',
		authFieldType: 'client',
		required: true,
		default: '',
		description: 'IAS3 Secret Key (password). Leave blank for anonymous access.',
		command: '--internetarchive-secret-access-key',
	},
	{
		label: 'IAS3 Endpoint',
		value: 'endpoint',
		fieldType: 'string',
		required: false,
		default: 'https://s3.us.archive.org',
		description: 'IAS3 Endpoint. Leave blank for default value.',
		command: '--internetarchive-endpoint',
	},
	{
		label: 'Frontend Host',
		value: 'front_endpoint',
		fieldType: 'string',
		required: false,
		default: 'https://archive.org',
		description: 'Host of InternetArchive Frontend. Leave blank for default value.',
		command: '--internetarchive-front-endpoint',
	},
	{
		label: 'Disable Checksum',
		value: 'disable_checksum',
		fieldType: 'bool',
		required: false,
		default: true,
		description:
			"Don't ask the server to test against MD5 checksum calculated by rclone. Normally rclone will calculate the MD5 checksum of the input before uploading it so it can ask the server to check the object against checksum. This is great for data integrity checking but can cause long delays for large files to start uploading.",
		command: '--internetarchive-disable-checksum',
	},
	{
		label: 'Wait Archive Timeout',
		value: 'wait_archive',
		fieldType: 'duration',
		required: false,
		default: '0s',
		description:
			"Timeout for waiting the server's processing tasks (specifically archive and book_op) to finish. Only enable if you need to be guaranteed to be reflected after write operations. 0 to disable waiting. No errors to be thrown in case of timeout.",
		command: '--internetarchive-wait-archive',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,ltgt,crlf,del,ctl,invalidutf8,dot',
		description:
			'The encoding for the backend. See the encoding section in the overview for more info.',
		command: '--internetarchive-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--internetarchive-description',
	},
];

export default internetarchiveSettings;
