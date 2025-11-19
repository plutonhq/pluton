export const storageProviders = {
   '1fichier': {
      id: '1fichier',
      name: '1Fichier',
      fields: [{ label: 'API Key', value: 'apiKey' }],
   },
   netstorage: {
      id: 'akamai',
      name: 'Akamai Netstorage',
      fields: [
         { label: 'Hostname', value: 'hostname' },
         { label: 'Account Name', value: 'accountName' },
         { label: 'Key', value: 'key' },
      ],
   },
   amazonS3: {
      id: 'amazonS3',
      name: 'Amazon S3',
      fields: [
         { label: 'AccessKey ID', value: 'accessKeyId' },
         { label: 'Secret Key', value: 'secretKey' },
         { label: 'Region', value: 'region' },
      ],
   },
   backblaze: {
      id: 'backblaze',
      name: 'Backblaze B2',
      fields: [
         { label: 'Account ID', value: 'accountId' },
         { label: 'Application Key', value: 'applicationKey' },
      ],
   },
   box: {
      id: 'box',
      name: 'Box',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   sharefile: {
      id: 'sharefile',
      name: 'Citrix ShareFile',
      fields: [
         { label: 'Hostname', value: 'hostname' },
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   dropbox: {
      id: 'dropbox',
      name: 'Dropbox',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   filesCom: {
      id: 'filesCom',
      name: 'Files.com',
      fields: [{ label: 'API Key', value: 'apiKey' }],
   },
   gofile: {
      id: 'gofile',
      name: 'Gofile',
      fields: [{ label: 'Token', value: 'token' }],
   },
   gcs: {
      id: 'gcs',
      name: 'Google Cloud Storage',
      fields: [
         { label: 'Project Number', value: 'projectNumber' },
         { label: 'Service Account File', value: 'serviceAccountFile' },
      ],
   },
   gdrive: {
      id: 'gdrive',
      name: 'Google Drive',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
         { label: 'Scope', value: 'scope' },
      ],
   },
   gphotos: {
      id: 'gphotos',
      name: 'Google Photos',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   hdfs: {
      id: 'hdfs',
      name: 'HDFS',
      fields: [
         { label: 'Namenode', value: 'namenode' },
         { label: 'Username', value: 'username' },
      ],
   },
   hidrive: {
      id: 'hidrive',
      name: 'HiDrive',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
         { label: 'Scope', value: 'scope' },
      ],
   },

   archive: {
      id: 'internetArchive',
      name: 'Internet Archive',
      fields: [
         { label: 'Access Key', value: 'accessKey' },
         { label: 'Secret Key', value: 'secretKey' },
      ],
   },
   jotta: {
      id: 'jotta',
      name: 'Jottacloud',
      fields: [
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
      ],
   },
   koofr: {
      id: 'koofr',
      name: 'Koofr',
      fields: [
         { label: 'Endpoint', value: 'endpoint' },
         { label: 'Email', value: 'email' },
         { label: 'Password', value: 'password' },
      ],
   },
   linkbox: {
      id: 'linkbox',
      name: 'Linkbox',
      fields: [{ label: 'API Key', value: 'apiKey' }],
   },
   mailru: {
      id: 'mailru',
      name: 'Mail.ru Cloud',
      fields: [
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
      ],
   },
   mega: {
      id: 'mega',
      name: 'Mega',
      fields: [
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
      ],
   },
   // memory: {
   //    id: 'memory',
   //    name: 'Memory',
   // },
   azureBlob: {
      id: 'azureBlob',
      name: 'Azure Blob Storage',
      fields: [
         { label: 'Account', value: 'account' },
         { label: 'Key', value: 'key' },
      ],
   },
   azureFiles: {
      id: 'azureFiles',
      name: 'Azure Files Storage',
      fields: [
         { label: 'Account', value: 'account' },
         { label: 'Key', value: 'key' },
      ],
   },
   onedrive: {
      id: 'onedrive',
      name: 'OneDrive',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   opendrive: {
      id: 'opendrive',
      name: 'OpenDrive',
      fields: [
         { label: 'Username', value: 'username' },
         { label: 'Password', value: 'password' },
      ],
   },
   swift: {
      id: 'swift',
      name: 'OpenStack Swift',
      fields: [
         { label: 'User', value: 'user' },
         { label: 'Key', value: 'key' },
         { label: 'Auth URL', value: 'authUrl' },
         { label: 'Tenant', value: 'tenant' },
      ],
   },
   oracle: {
      id: 'oracle',
      name: 'Oracle Object Storage',
      fields: [
         { label: 'Namespace', value: 'namespace' },
         { label: 'Compartment', value: 'compartment' },
         { label: 'Region', value: 'region' },
         { label: 'Access Key', value: 'accessKey' },
         { label: 'Secret Key', value: 'secretKey' },
      ],
   },
   pcloud: {
      id: 'pcloud',
      name: 'pCloud',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   pikpak: {
      id: 'pikpak',
      name: 'PikPak',
      fields: [
         { label: 'Username', value: 'username' },
         { label: 'Password', value: 'password' },
      ],
   },
   pixeldrain: {
      id: 'pixeldrain',
      name: 'Pixeldrain',
      fields: [{ label: 'API Key', value: 'apiKey' }],
   },
   premiumize: {
      id: 'premiumize',
      name: 'premiumize.me',
      fields: [{ label: 'Api Key', value: 'apiKey' }],
   },
   putio: {
      id: 'putio',
      name: 'put.io',
      fields: [{ label: 'Token', value: 'token' }],
   },
   proton: {
      id: 'proton',
      name: 'Proton Drive',
      fields: [
         { label: 'Username', value: 'username' },
         { label: 'Password', value: 'password' },
      ],
   },
   qingstor: {
      id: 'qingstor',
      name: 'QingStor',
      fields: [
         { label: 'AccessKey Id', value: 'accessKeyId' },
         { label: 'Secret Key', value: 'secretKey' },
         { label: 'Zone', value: 'zone' },
      ],
   },
   quatrix: {
      id: 'quatrix',
      name: 'Quatrix by Maytech',
      fields: [
         { label: 'API Key', value: 'apiKey' },
         { label: 'User', value: 'user' },
         { label: 'Host', value: 'host' },
      ],
   },
   seafile: {
      id: 'seafile',
      name: 'Seafile',
      fields: [
         { label: 'URL', value: 'url' },
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
         { label: 'Library', value: 'library' },
      ],
   },
   sia: {
      id: 'sia',
      name: 'Sia',
      fields: [
         { label: 'API URL', value: 'apiUrl' },
         { label: 'Password', value: 'password' },
      ],
   },
   sugarsync: {
      id: 'sugarsync',
      name: 'SugarSync',
      fields: [
         { label: 'Access Key ID', value: 'accessKeyId' },
         { label: 'Private Key', value: 'privateKey' },
         { label: 'Refresh Token', value: 'refreshToken' },
      ],
   },
   storj: {
      id: 'storj',
      name: 'Storj',
      fields: [{ label: 'Access Grant', value: 'accessGrant' }],
   },
   ulozto: {
      id: 'ulozto',
      name: 'Uloz.to',
      fields: [
         { label: 'Username', value: 'username' },
         { label: 'Password', value: 'password' },
      ],
   },
   yandex: {
      id: 'yandex',
      name: 'Yandex Disk',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
      ],
   },
   zoho: {
      id: 'zoho',
      name: 'Zoho WorkDrive',
      fields: [
         { label: 'Client ID', value: 'clientId' },
         { label: 'Client Secret', value: 'clientSecret' },
         { label: 'Region', value: 'region' },
      ],
   },
   ftp: {
      id: 'ftp',
      name: 'FTP',
      fields: [
         { label: 'Host', value: 'host' },
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
      ],
   },
   http: {
      id: 'http',
      name: 'HTTP',
      fields: [{ label: 'URL', value: 'url' }],
   },
   sftp: {
      id: 'sftp',
      name: 'SFTP',
      fields: [
         { label: 'Host', value: 'host' },
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
      ],
   },
   smb: {
      id: 'smb',
      name: 'SMB',
      fields: [
         { label: 'Host', value: 'host' },
         { label: 'Username', value: 'username' },
         { label: 'Password', value: 'password' },
      ],
   },
   webdav: {
      id: 'webdav',
      name: 'WebDAV',
      fields: [
         { label: 'URL', value: 'url' },
         { label: 'User', value: 'user' },
         { label: 'Password', value: 'password' },
      ],
   },
   local: {
      id: 'local',
      name: 'The local filesystem',
      fields: [],
   },
};
