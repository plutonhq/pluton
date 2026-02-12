const hdfsSettings = [
	{
		label: 'Namenode Hosts',
		value: 'namenode',
		fieldType: 'commaseplist',
		authFieldType: 'password',
		required: true,
		default: '',
		description:
			'Hadoop name nodes and ports. E.g. "namenode-1:8020,namenode-2:8020,..." to connect to host namenodes at port 8020.',
		command: '--hdfs-namenode',
	},
	{
		label: 'Username',
		value: 'username',
		fieldType: 'string',
		authFieldType: 'password',
		required: true,
		default: '',
		description: 'Hadoop user name.',
		command: '--hdfs-username',
	},
	{
		label: 'Service Principal Name',
		value: 'service_principal_name',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			"Kerberos service principal name for the namenode. Enables KERBEROS authentication. Specifies the Service Principal Name (SERVICE/FQDN) for the namenode. E.g. \"hdfs/namenode.hadoop.docker\" for namenode running as service 'hdfs' with FQDN 'namenode.hadoop.docker'.",
		command: '--hdfs-service-principal-name',
	},
	{
		label: 'Data Transfer Protection',
		value: 'data_transfer_protection',
		fieldType: 'string',
		required: false,
		default: '',
		description:
			"Kerberos data transfer protection: authentication|integrity|privacy. Specifies whether or not authentication, data signature integrity checks, and wire encryption are required when communicating with the datanodes. Possible values are 'authentication', 'integrity' and 'privacy'. Used only with KERBEROS enabled.",
		command: '--hdfs-data-transfer-protection',
	},
	{
		label: 'Encoding',
		value: 'encoding',
		fieldType: 'encoding',
		required: false,
		default: 'slash,colon,del,ctl,invalidutf8,dot',
		description: 'The encoding for the backend.',
		command: '--hdfs-encoding',
	},
	{
		label: 'Description',
		value: 'description',
		fieldType: 'string',
		required: false,
		default: '',
		description: 'Description of the Storage.',
		command: '--hdfs-description',
	},
];

export default hdfsSettings;
