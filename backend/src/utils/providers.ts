import azureblobSettings from './providers/azureblob';
import b2Settings from './providers/b2';
import boxSettings from './providers/boxCom';
import dropboxSettings from './providers/dropbox';
import fichierSettings from './providers/fichier';
import gcsSettings from './providers/gcs';
import googleDriveSettings from './providers/gdrive';
import gofileSettings from './providers/gofile';
import gphotosSettings from './providers/gphotos';
import hdfsSettings from './providers/hdfs';
import hidriveSettings from './providers/hidrive';
import internetarchiveSettings from './providers/internetarchive';
import jottacloudSettings from './providers/jottacloud';
import koofrSettings from './providers/koofr';
import linkboxSettings from './providers/linkbox';
import mailruSettings from './providers/mailru';
import megaSettings from './providers/mega';
import netstorageSettings from './providers/netstorage';
import onedriveSettings from './providers/onedrive';
import opendriveSettings from './providers/opendrive';
import oracleSettings from './providers/oracle';
import pikpakSettings from './providers/pikpak';
import pixeldrainSettings from './providers/pixeldrain';
import premiumizemeSettings from './providers/premiumizeme';
import protondriveSettings from './providers/protondrive';
import putioSettings from './providers/putio';
import qingstorSettings from './providers/qingstor';
import quatrixSettings from './providers/quatrix';
import s3Settings from './providers/s3';
import seafileSettings from './providers/seafile';
import citrixSharefileSettings from './providers/sharefile';
import siaSettings from './providers/sia';
import storjSettings from './providers/storj';
import sugarsyncSettings from './providers/sugarsync';
import swiftSettings from './providers/swift';
import uloztoSettings from './providers/ulozto';
import webdavSettings from './providers/webdav';
import yandexSettings from './providers/yandex';
import zohoSettings from './providers/zoho';
import pcloudSettings from './providers/pcloud';
import filesComSettings from './providers/filesCom';
import smbSettings from './providers/smb';
import ftpSettings from './providers/ftp';
import sftpSettings from './providers/sftp';
import httpSettings from './providers/http';
import providerFeatures from './providers/_features';
import r2Settings from './providers/r2';
import ossSettings from './providers/oss';
import cephSettings from './providers/ceph';
import dreamobjectsSettings from './providers/dreamobjects';
import spacesSettings from './providers/spaces';
import obsSettings from './providers/obs';
import ibmcosSettings from './providers/ibmcos';
import idriveSettings from './providers/idrive';
import ionosSettings from './providers/ionos';
import minioSettings from './providers/minio';
import outscaleSettings from './providers/outscale';
import qiniuSettings from './providers/qiniu';
import rackcorpSettings from './providers/rackcorp';
import rcloneSettings from './providers/rclone';
import scalewaySettings from './providers/scaleway';
import lyvecloudSettings from './providers/lyvecloud';
import seaweedfsSettings from './providers/seaweedfs';
import selectelSettings from './providers/selectel';
import leviiaSettings from './providers/leviia';
import liaraSettings from './providers/liara';
import linodeSettings from './providers/linode';
import arvanSettings from './providers/arvan';
import petaboxSettings from './providers/petabox';
import tencentSettings from './providers/tencent';
import magaluSettings from './providers/magalu';
import wasabiSettings from './providers/wasabi';
import synologySettings from './providers/synologyc2';
import localSettings from './providers/local';

export interface ProviderConfig {
	name: string;
	authTypes: string[];
	features: {
		Purge: boolean;
		Copy: boolean;
		Move: boolean;
		DirMove: boolean;
		CleanUp: boolean;
		ListR: boolean;
		StreamUpload: boolean;
		MultithreadUpload: boolean;
		LinkSharing: boolean;
		About: boolean;
		EmptyDir: boolean;
	};
	settings?: {
		label: string;
		value: string;
		fieldType: string;
		required: boolean;
		default: string | boolean;
		description: string;
		authFieldType?: string;
		options?: { label: string; value: string }[];
	}[];
	docs?: { label: string; value: string }[];
	setup: (credentials: Record<string, string>, type?: string) => string[];
}

export const providers: Record<string, ProviderConfig> = {
	'local': {
		name: 'Local',
		settings: localSettings,
		authTypes: ['client'],
		setup: creds => [],
		features: providerFeatures['local'],
	},
	'b2': {
		name: 'Backblaze B2',
		settings: b2Settings,
		authTypes: ['client'],
		setup: creds => ['account', creds.account, 'key', creds.key],
		features: providerFeatures['b2'],
	},
	's3': {
		name: 'AWS S3',
		settings: s3Settings,
		authTypes: ['client'],
		setup: creds => [
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'region',
			creds.region,
		],
		features: providerFeatures['s3'],
	},
	'drive': {
		name: 'Google Drive',
		settings: googleDriveSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token, 'scope', creds.scope || 'drive']
				: [
						'client_id',
						creds.clientId,
						'client_secret',
						`$(rclone obscure ${creds.clientSecret})`,
						'scope',
						creds.scope || 'drive',
					],
		features: providerFeatures['drive'],
	},
	'onedrive': {
		name: 'One Drive',
		settings: onedriveSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['client_id', creds.clientId, 'client_secret', `$(rclone obscure ${creds.clientSecret})`],
		features: providerFeatures['onedrive'],
	},
	'dropbox': {
		name: 'DropBox',
		settings: dropboxSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['client_id', creds.clientId, 'client_secret', `$(rclone obscure ${creds.clientSecret})`],
		features: providerFeatures['dropbox'],
	},
	'box': {
		name: 'Box.com',
		settings: boxSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['client_id', creds.clientId, 'client_secret', `$(rclone obscure ${creds.clientSecret})`],
		features: providerFeatures['box'],
	},
	'azureBlob': {
		name: 'Azure Blob Storage',
		settings: azureblobSettings,
		authTypes: ['client', 'password'],
		setup: creds => ['account', creds.account, 'key', `$(rclone obscure ${creds.key})`],
		features: providerFeatures['azureBlob'],
	},
	'gcs': {
		name: 'Google Cloud Storage',
		settings: gcsSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['project_number', creds.projectNumber, 'service_account_file', creds.serviceAccountFile],
		features: providerFeatures['gcs'],
	},
	'mega': {
		name: 'Mega',
		authTypes: ['password'],
		settings: megaSettings,
		setup: creds => ['user', creds.user, 'pass', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['mega'],
	},
	'pcloud': {
		name: 'pCloud',
		authTypes: ['oauth', 'client'],
		settings: pcloudSettings,
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['client_id', creds.clientId, 'client_secret', `$(rclone obscure ${creds.clientSecret})`],
		features: providerFeatures['pcloud'],
	},
	'swift': {
		name: 'Oracle Swift',
		settings: swiftSettings,
		authTypes: ['client', 'password'],
		setup: creds => [
			'user',
			creds.user,
			'key',
			`$(rclone obscure ${creds.key})`,
			'auth',
			creds.authUrl,
			'tenant',
			creds.tenant,
		],
		features: providerFeatures['swift'],
	},
	'storj': {
		name: 'Storj',
		settings: storjSettings,
		authTypes: ['client', 'password'],
		setup: creds => ['access_grant', creds.accessGrant],
		features: providerFeatures['storj'],
	},
	'seafile': {
		name: 'SeaFile',
		settings: seafileSettings,
		authTypes: ['password'],
		setup: creds => [
			'url',
			creds.url,
			'user',
			creds.user,
			'pass',
			`$(rclone obscure ${creds.password})`,
			'library',
			creds.library,
		],
		features: providerFeatures['seafile'],
	},
	'jottacloud': {
		name: 'Jotta Cloud',
		authTypes: ['client', 'password'],
		settings: jottacloudSettings,
		setup: creds => ['user', creds.user, 'pass', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['jottacloud'],
	},
	'yandex': {
		name: 'Yandex Disk',
		authTypes: ['client', 'oauth'],
		settings: yandexSettings,
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['client_id', creds.clientId, 'client_secret', `$(rclone obscure ${creds.clientSecret})`],
		features: providerFeatures['yandex'],
	},
	'zoho': {
		name: 'Zoho WorkDrive',
		authTypes: ['client', 'oauth'],
		settings: zohoSettings,
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: [
						'client_id',
						creds.clientId,
						'client_secret',
						`$(rclone obscure ${creds.clientSecret})`,
						'region',
						creds.region,
					],
		features: providerFeatures['zoho'],
	},
	'hidrive': {
		name: 'HiDrive',
		settings: hidriveSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: [
						'client_id',
						creds.clientId,
						'client_secret',
						`$(rclone obscure ${creds.clientSecret})`,
						'scope',
						creds.scope,
					],
		features: providerFeatures['hidrive'],
	},
	'koofr': {
		name: 'Koofr',
		settings: koofrSettings,
		authTypes: ['client'],
		setup: creds => [
			'endpoint',
			creds.endpoint,
			'user',
			creds.email,
			'password',
			`$(rclone obscure ${creds.password})`,
		],
		features: providerFeatures['koofr'],
	},
	'mailru': {
		name: 'Mail.ru Cloud',
		authTypes: ['client', 'oauth'],
		settings: mailruSettings,
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: ['user', creds.user, 'password', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['mailru'],
	},
	'opendrive': {
		name: 'Open Drive',
		authTypes: ['password'],
		settings: opendriveSettings,
		setup: creds => ['username', creds.username, 'password', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['opendrive'],
	},
	'qingstor': {
		name: 'QingStor',
		authTypes: ['client'],
		settings: qingstorSettings,
		setup: creds => [
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'zone',
			creds.zone,
		],
		features: providerFeatures['qingstor'],
	},
	'premiumizeme': {
		name: 'Premiumize.me',
		settings: premiumizemeSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth' ? ['token', creds.token] : ['api_key', `$(rclone obscure ${creds.apiKey})`],
		features: providerFeatures['premiumizeme'],
	},
	'putio': {
		name: 'Put.io',
		settings: putioSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) =>
			type === 'oauth' ? ['token', creds.token] : ['token', `$(rclone obscure ${creds.token})`],
		features: providerFeatures['putio'],
	},
	'sharefile': {
		name: 'Citrix ShareFile',
		authTypes: ['client', 'oauth'],
		settings: citrixSharefileSettings,
		setup: (creds, type) =>
			type === 'oauth'
				? ['token', creds.token]
				: [
						'hostname',
						creds.hostname,
						'client_id',
						creds.clientId,
						'client_secret',
						`$(rclone obscure ${creds.clientSecret})`,
					],
		features: providerFeatures['sharefile'],
	},
	'sugarsync': {
		name: 'SugarSync',
		authTypes: ['client'],
		settings: sugarsyncSettings,
		setup: creds => [
			'access_key_id',
			creds.accessKeyId,
			'private_access_key',
			`$(rclone obscure ${creds.privateKey})`,
			'refresh_token',
			creds.refreshToken,
		],
		features: providerFeatures['sugarsync'],
	},
	// 'nextcloud': {
	// 	name: 'NextCloud',
	// 	setup: creds => [
	// 		'url',
	// 		creds.url,
	// 		'user',
	// 		creds.user,
	// 		'pass',
	// 		`$(rclone obscure ${creds.password})`,
	// 		'vendor',
	// 		'nextcloud',
	// 	],
	// },

	'1fichier': {
		name: '1Fichier',
		authTypes: ['client'],
		settings: fichierSettings,
		setup: creds => ['api_key', `$(rclone obscure ${creds.apiKey})`],
		features: providerFeatures['1fichier'],
	},
	'netstorage': {
		name: 'Akamai NetStorage',
		authTypes: ['client'],
		settings: netstorageSettings,
		setup: creds => [
			'hostname',
			creds.hostname,
			'account_name',
			creds.accountName,
			'key',
			`$(rclone obscure ${creds.key})`,
		],
		features: providerFeatures['netstorage'],
	},
	'files': {
		name: 'Files.com', // authentication either using apiKey or username/password
		authTypes: ['client', 'password'],
		settings: filesComSettings,
		setup: creds => ['api_key', `$(rclone obscure ${creds.apiKey})`],
		features: providerFeatures['files'],
	},
	'gofile': {
		name: 'GoFile',
		authTypes: ['client'],
		settings: gofileSettings,
		setup: creds => ['token', `$(rclone obscure ${creds.access_token})`],
		features: providerFeatures['gofile'],
	},
	'gphotos': {
		name: 'Google Photos',
		authTypes: ['client', 'password'],
		settings: gphotosSettings,
		setup: creds => [
			'client_id',
			creds.clientId,
			'client_secret',
			`$(rclone obscure ${creds.clientSecret})`,
		],
		features: providerFeatures['gphotos'],
	},

	'internetarchive': {
		name: 'Internet Archive',
		authTypes: ['client'],
		settings: internetarchiveSettings,
		setup: creds => [
			'access_key_id',
			creds.accessKey,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
		],
		features: providerFeatures['internetarchive'],
	},
	'linkbox': {
		name: 'Linkbox',
		authTypes: ['client'],
		settings: linkboxSettings,
		setup: creds => ['api_key', `$(rclone obscure ${creds.apiKey})`],
		features: providerFeatures['linkbox'],
	},
	'oracle': {
		name: 'Oracle Object Storage',
		authTypes: ['client'],
		settings: oracleSettings,
		setup: creds => [
			'namespace',
			creds.namespace,
			'compartment',
			creds.compartment,
			'region',
			creds.region,
			'access_key',
			creds.accessKey,
			'secret_key',
			`$(rclone obscure ${creds.secretKey})`,
		],
		features: providerFeatures['oracle'],
	},
	'pikpak': {
		name: 'PikPak',
		authTypes: ['password'],
		settings: pikpakSettings,
		setup: creds => ['username', creds.username, 'password', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['pikpak'],
	},
	'pixeldrain': {
		name: 'Pixeldrain',
		authTypes: ['client'],
		settings: pixeldrainSettings,
		setup: creds => ['api_key', `$(rclone obscure ${creds.apiKey})`],
		features: providerFeatures['pixeldrain'],
	},
	'proton': {
		name: 'Proton Drive',
		authTypes: ['password'],
		settings: protondriveSettings,
		setup: creds => ['username', creds.username, 'password', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['proton'],
	},
	'quatrix': {
		name: 'Quatrix by Maytech',
		authTypes: ['client'],
		settings: quatrixSettings,
		setup: creds => [
			'api_key',
			`$(rclone obscure ${creds.apiKey})`,
			'user',
			creds.user,
			'host',
			creds.host,
		],
		features: providerFeatures['quatrix'],
	},
	'sia': {
		name: 'Sia',
		authTypes: ['client'],
		settings: siaSettings,
		setup: creds => ['api_url', creds.apiUrl, 'password', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['sia'],
	},
	'ulozto': {
		name: 'Uloz.to',
		authTypes: ['password'],
		settings: uloztoSettings,
		setup: creds => ['username', creds.username, 'password', `$(rclone obscure ${creds.password})`],
		features: providerFeatures['ulozto'],
	},
	'hdfs': {
		name: 'HDFS',
		authTypes: ['password'],
		settings: hdfsSettings,
		setup: creds => ['namenode', creds.namenode, 'username', creds.username],
		features: providerFeatures['hdfs'],
	},
	'smb': {
		name: 'SMB',
		authTypes: ['password'],
		settings: smbSettings,
		setup: creds => [
			'host',
			creds.host,
			'username',
			creds.username,
			'password',
			`$(rclone obscure ${creds.password})`,
		],
		features: providerFeatures['smb'],
	},
	'sftp': {
		name: 'SFTP',
		authTypes: ['password'],
		settings: sftpSettings,
		setup: creds => [
			'host',
			creds.host,
			'user',
			creds.user,
			'pass',
			`$(rclone obscure ${creds.password})`,
		],
		features: providerFeatures['sftp'],
	},
	'ftp': {
		name: 'FTP',
		authTypes: ['password'],
		settings: ftpSettings,
		setup: creds => [
			'host',
			creds.host,
			'user',
			creds.user,
			'pass',
			`$(rclone obscure ${creds.password})`,
		],
		features: providerFeatures['ftp'],
	},
	'webdav': {
		name: 'WebDav',
		authTypes: ['password'],
		settings: webdavSettings,
		setup: creds => [
			'url',
			creds.url,
			'user',
			creds.user,
			'pass',
			`$(rclone obscure ${creds.password})`,
		],
		features: providerFeatures['webdav'],
	},
	'http': {
		name: 'HTTP (Read Only)',
		authTypes: ['noauth'],
		settings: httpSettings,
		setup: creds => ['url', creds.url],
		features: providerFeatures['http'],
	},
	// S3 Compatible API
	'r2': {
		name: 'Cloudflare R2',
		authTypes: ['client'],
		settings: r2Settings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'Cloudflare',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			`${creds.endpoint}.r2.cloudflarestorage.com`,
			'acl',
			'private',
		],
	},
	'oss': {
		name: 'Alibaba Cloud Object Storage System (OSS)',
		authTypes: ['client'],
		settings: ossSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'Alibaba',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
			'storage_class',
			creds.storage_class,
		],
	},
	'ceph': {
		name: 'Ceph',
		authTypes: ['client'],
		settings: cephSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'Ceph', //TODO: No region field
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			`${creds.endpoint}`,
			'acl',
			'private',
		],
	},
	'dreamobjects': {
		name: 'DreamObjects',
		authTypes: ['client'],
		settings: dreamobjectsSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'DreamHost', //TODO: No region field
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
		],
	},
	'spaces': {
		name: 'DigitalOcean Spaces',
		authTypes: ['client'],
		settings: spacesSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'DigitalOcean', //TODO: No region field
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'obs': {
		name: 'Huawei OBS',
		authTypes: ['client'],
		settings: obsSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'HuaweiOBS',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'region',
			creds.region,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
		],
	},
	'ibmcos': {
		name: 'IBM Cloud Object Storage',
		authTypes: ['client'],
		settings: ibmcosSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'IBMCOS',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			creds.region,
			'endpoint',
			creds.endpoint,
			'location_constraint',
			creds.location_constraint,
			'acl',
			'private',
		],
	},
	'idrive': {
		name: 'IDrive e2',
		authTypes: ['client'],
		settings: idriveSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'IDrive',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'ionos': {
		name: 'IONOS Cloud',
		authTypes: ['client'],
		settings: ionosSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'IONOS', //TODO: No region field
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'minio': {
		name: 'Minio',
		authTypes: ['client'],
		settings: minioSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'Minio',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
			'region',
			creds.region,
		],
	},
	'outscale': {
		name: 'Outscale Object Storage',
		authTypes: ['client'],
		settings: outscaleSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'Outscale',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			`oos.${creds.region}.outscale.com`,
			'region',
			creds.region,
		],
	},
	'qiniu': {
		name: 'Qiniu Object Storage (KODO)',
		authTypes: ['client'],
		settings: qiniuSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'EndPoints & Regions',
				value: 'https://developer.qiniu.com/kodo/4088/s3-access-domainname',
			},
		],
		setup: creds => [
			'provider',
			'Qiniu',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			`s3.${creds.region}.qiniucs.com	`,
			'region',
			creds.region,
			'location_constraint',
			creds.region,
			'storage_class',
			creds.storage_class,
			'acl',
			creds.acl,
		],
	},
	'rackcorp': {
		name: 'RackCorp',
		authTypes: ['client'],
		settings: rackcorpSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'RackCorp S3 Storage Documentation',
				value: 'https://wiki.rackcorp.com/books/help-and-support-en/page/s3-storage-settings',
			},
		],
		setup: creds => [
			'provider',
			'RackCorp',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			`${creds.region}.s3.rackcorp.com`,
			'region',
			creds.region,
			'location_constraint ',
			creds.region,
		],
	},
	'rclone': {
		name: 'Rclone Serve S3',
		authTypes: ['client'],
		settings: rcloneSettings,
		features: providerFeatures['s3'],
		docs: [
			{ label: 'Rclone S3 Documentation', value: 'https://rclone.org/commands/rclone_serve_s3' },
		],
		setup: creds => [
			'provider',
			'Rclone',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
			'use_multipart_uploads',
			'false',
		],
	},

	'scaleway': {
		name: 'Scaleway Object Storage',
		authTypes: ['client'],
		settings: scalewaySettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Scaleway Object Storage Quickstart',
				value: 'https://www.scaleway.com/en/docs/object-storage/quickstart/',
			},
		],
		setup: creds => [
			'provider',
			'Scaleway',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
			'region',
			creds.region,
			'location_constraint ',
			creds.region,
			'acl',
			'private',
			'upload_cutoff',
			'5M',
			'chunk_size',
			'5M',
			'copy_cutoff',
			'5M',
			'acl',
			creds.acl || 'private',
		],
	},
	'lyvecloud': {
		name: 'Seagate LyveCloud',
		authTypes: ['client'],
		settings: lyvecloudSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Seagate LyveCloud Quickstart',
				value: 'https://help.lyvecloud.seagate.com/en/quick-start-guide.html',
			},
		],
		setup: creds => [
			'provider',
			'LyveCloud',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'seaweedfs': {
		name: 'SeaweedFS',
		authTypes: ['client'],
		settings: seaweedfsSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'SeaweedFS Documentation',
				value: 'https://seaweedfs.com/docs/admin/setup/',
			},
		],
		setup: creds => [
			'provider',
			'SeaweedFS',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'selectel': {
		name: 'Selectel',
		authTypes: ['client'],
		settings: selectelSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Selectel S3 Documentation',
				value: 'https://docs.selectel.ru/en/api/object-storage-s3/#section/Getting-started',
			},
		],
		setup: creds => [
			'provider',
			'Selectel',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			's3.ru-1.storage.selcloud.ru',
			'region',
			'ru-1',
			'acl',
			'private',
		],
	},
	'wasabi': {
		name: 'Wasabi',
		authTypes: ['client'],
		settings: wasabiSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Wasabi Quickstart',
				value: 'https://docs.wasabi.com/v1/docs/getting-started',
			},
			{
				label: 'Wasabi Regions & Endpoints',
				value:
					'https://docs.wasabi.com/v1/docs/what-are-the-service-urls-for-wasabi-s-different-storage-regions',
			},
		],
		setup: creds => [
			'provider',
			'Wasabi',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			`s3.${creds.region === 'us-east-1' ? '' : creds.region}.wasabisys.com`,
			'region',
			creds.region,
		],
	},
	'leviia': {
		name: 'Leviia',
		authTypes: ['client'],
		settings: leviiaSettings,
		features: providerFeatures['s3'],
		setup: creds => [
			'provider',
			'Leviia',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
		],
	},
	'liara': {
		name: 'Liara',
		authTypes: ['client'],
		settings: liaraSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Liara Storage Documentation',
				value: 'https://docs.liara.ir/object-storage/about/',
			},
		],
		setup: creds => [
			'provider',
			'Liara',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			'storage.iran.liara.space',
		],
	},
	'linode': {
		name: 'Linode Object Storage',
		authTypes: ['client'],
		settings: linodeSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Linode Object Storage Quickstart',
				value:
					'https://techdocs.akamai.com/cloud-computing/docs/getting-started-with-object-storage',
			},
		],
		setup: creds => [
			'provider',
			'Linode',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'magalu': {
		name: 'Magalu',
		authTypes: ['client'],
		settings: magaluSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Magalu Cloud Storage Quickstart',
				value: 'https://docs.magalu.cloud/docs/storage/object-storage/quickstart',
			},
		],
		setup: creds => [
			'provider',
			'Magalu',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'arvan': {
		name: 'ArvanCloud',
		authTypes: ['client'],
		settings: arvanSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'ArvanCloud Storage Documentation',
				value: 'https://docs.arvancloud.ir/en/object-storage/dashboard',
			},
		],
		setup: creds => [
			'provider',
			'ArvanCloud',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'region',
			creds.region,
			'endpoint',
			creds.endpoint || `s3.${creds.region}.arvanstorage.ir`,
		],
	},
	'tencent': {
		name: 'Tencent Cloud Object Storage (COS)',
		authTypes: ['client'],
		settings: tencentSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Tencent Cloud Object Storage Quickstart',
				value: 'https://www.tencentcloud.com/document/product/436/32955',
			},
			{
				label: 'Tencent Cloud Object Storage Endpoints',
				value: 'https://www.tencentcloud.com/document/product/436/6224',
			},
		],
		setup: creds => [
			'provider',
			'TencentCOS',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			creds.endpoint,
		],
	},
	'petabox': {
		name: 'Petabox',
		authTypes: ['client'],
		settings: petaboxSettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Petabox Documentation',
				value: 'https://docs.petabox.io/',
			},
		],
		setup: creds => [
			'provider',
			'Petabox',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'endpoint',
			's3.petabox.io',
			'region',
			'eu-east-1', //Avaialble in One location only: https://docs.petabox.io/http-api-compatible-with-amazon-s3/api-reference/bucket/getbucketlocation
		],
	},
	'synologyc2': {
		name: 'Synology C2',
		authTypes: ['client'],
		settings: synologySettings,
		features: providerFeatures['s3'],
		docs: [
			{
				label: 'Synology C2 Object Storage Quick Start',
				value: 'https://kb.synology.com/vi-vn/C2/tutorial/Quick_Start_C2_Object_Storage',
			},
			{
				label: 'Retrieving Synology C2 Access Keys',
				value: 'https://kb.synology.com/en-ca/C2/tutorial/C2_Object_Storage_Access_Key_Management',
			},
		],
		setup: creds => [
			'provider',
			'ArvanCloud',
			'access_key_id',
			creds.accessKeyId,
			'secret_access_key',
			`$(rclone obscure ${creds.secretKey})`,
			'region',
			creds.region,
			'endpoint',
			`${creds.region}.s3.synologyc2.net`,
			'no_check_bucket',
			'true',
		],
	},
};
