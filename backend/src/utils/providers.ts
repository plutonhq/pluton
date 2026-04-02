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
import drimeSettings from './providers/drime';
import fileluSettings from './providers/filelu';
import filenSettings from './providers/filen';
import internxtSettings from './providers/internxt';
import shadeSettings from './providers/shade';
import type { ProviderSetting } from './providers/types';

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
	s3Adapter?: boolean;
	settings?: ProviderSetting[];
	doc?: string;
	setup: (credentials: Record<string, string>, type?: string) => string[] | false;
}

export const providers: Record<string, ProviderConfig> = {
	local: {
		name: 'Local',
		settings: localSettings,
		authTypes: ['client'],
		features: providerFeatures['local'],
		setup: creds => [],
	},
	b2: {
		name: 'Backblaze B2',
		doc: '/storages/connecting-backblaze-b2',
		settings: b2Settings,
		authTypes: ['client'],
		features: providerFeatures['b2'],
		setup: creds => ['account', creds.account, 'key', creds.key],
	},
	s3: {
		name: 'AWS S3',
		doc: '/storages/connecting-aws-s3',
		settings: s3Settings,
		authTypes: ['client'],
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => {
			const args = [
				'provider',
				'AWS',
				'access_key_id',
				creds.access_key_id,
				'secret_access_key',
				creds.secret_access_key,
				'region',
				creds.region,
				'acl',
				creds.acl || 'private',
			];
			if (creds.location_constraint && creds.location_constraint !== 'us-east-1') {
				args.push('location_constraint', creds.location_constraint);
			}
			if (creds.endpoint) {
				args.push('endpoint', creds.endpoint);
			}

			return args;
		},
	},
	drive: {
		name: 'Google Drive',
		doc: '/storages/connecting-google-drive',
		settings: googleDriveSettings,
		authTypes: ['client', 'oauth'],
		features: providerFeatures['drive'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token, 'scope', creds.scope || 'drive'];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'scope',
					creds.scope || 'drive',
					'--drive-client-credentials',
				];
			}
		},
	},
	onedrive: {
		name: 'One Drive',
		doc: '/storages/connecting-onedrive',
		settings: onedriveSettings,
		authTypes: ['client', 'oauth'],
		features: providerFeatures['onedrive'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--onedrive-client-credentials',
				];
			}
		},
	},
	dropbox: {
		name: 'DropBox',
		doc: '/storages/connecting-dropbox',
		settings: dropboxSettings,
		authTypes: ['client', 'oauth'],
		features: providerFeatures['dropbox'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--dropbox-client-credentials',
				];
			}
		},
	},
	box: {
		name: 'Box.com',
		doc: '/storages/connecting-box',
		settings: boxSettings,
		authTypes: ['client', 'oauth'],
		features: providerFeatures['box'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--box-client-credentials',
				];
			}
		},
	},
	azureBlob: {
		name: 'Azure Blob Storage',
		doc: '/storages/connecting-azure-blob-storage',
		settings: azureblobSettings,
		authTypes: ['client', 'password'],
		setup: creds => ['account', creds.account, 'key', creds.key],
		features: providerFeatures['azureBlob'],
	},
	gcs: {
		name: 'Google Cloud Storage',
		doc: '/storages/connecting-google-cloud-storage',
		settings: gcsSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.project_number || !creds.service_account_file) {
					return false;
				}
				return [
					'project_number',
					creds.project_number,
					'service_account_file',
					creds.service_account_file,
				];
			}
		},
		features: providerFeatures['gcs'],
	},
	mega: {
		name: 'Mega',
		doc: '/storages/connecting-mega',
		authTypes: ['password'],
		settings: megaSettings,
		setup: creds => ['user', creds.user, 'pass', creds.pass],
		features: providerFeatures['mega'],
	},
	pcloud: {
		name: 'pCloud',
		doc: '/storages/connecting-pcloud',
		authTypes: ['oauth', 'client'],
		settings: pcloudSettings,
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--pcloud-client-credentials',
				];
			}
		},

		features: providerFeatures['pcloud'],
	},
	swift: {
		name: 'Oracle Swift',
		doc: '/storages/connecting-openstack-swift',
		settings: swiftSettings,
		authTypes: ['client', 'password'],
		setup: creds => [
			'user',
			creds.user,
			'key',
			creds.key,
			'auth',
			creds.authUrl,
			'tenant',
			creds.tenant,
		],
		features: providerFeatures['swift'],
	},
	storj: {
		name: 'Storj',
		doc: '/storages/connecting-storj',
		settings: storjSettings,
		authTypes: ['client', 'password'],
		setup: creds => ['access_grant', creds.accessGrant],
		features: providerFeatures['storj'],
	},
	seafile: {
		name: 'SeaFile',
		doc: '/storages/connecting-seafile',
		settings: seafileSettings,
		authTypes: ['password'],
		setup: creds => [
			'url',
			creds.url,
			'user',
			creds.user,
			'pass',
			creds.pass,
			'library',
			creds.library,
		],
		features: providerFeatures['seafile'],
	},
	jottacloud: {
		name: 'Jotta Cloud',
		doc: '/storages/connecting-jottacloud',
		authTypes: ['client', 'password'],
		settings: jottacloudSettings,
		features: providerFeatures['jottacloud'],
		setup: (creds, type) => {
			if (type === 'password') {
				return ['user', creds.user, 'pass', creds.pass];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--jottacloud-client-credentials',
				];
			}
		},
	},
	yandex: {
		name: 'Yandex Disk',
		doc: '/storages/connecting-yandex-disk',
		authTypes: ['client', 'oauth'],
		settings: yandexSettings,
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--yandex-client-credentials',
				];
			}
		},
		features: providerFeatures['yandex'],
	},
	zoho: {
		name: 'Zoho WorkDrive',
		doc: '/storages/connecting-zoho-workdrive',
		authTypes: ['client', 'oauth'],
		settings: zohoSettings,
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'region',
					creds.region,
					'--zoho-client-credentials',
				];
			}
		},
		features: providerFeatures['zoho'],
	},
	hidrive: {
		name: 'HiDrive',
		doc: '/storages/connecting-hidrive',
		settings: hidriveSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'scope',
					creds.scope,
					'--hidrive-client-credentials',
				];
			}
		},
		features: providerFeatures['hidrive'],
	},
	koofr: {
		name: 'Koofr',
		doc: '/storages/connecting-koofr',
		settings: koofrSettings,
		authTypes: ['client'],
		setup: creds => ['endpoint', creds.endpoint, 'user', creds.email, 'password', creds.password],
		features: providerFeatures['koofr'],
	},
	mailru: {
		name: 'Mail.ru Cloud',
		doc: '/storages/connecting-mail-ru-cloud',
		authTypes: ['oauth', 'password'],
		settings: mailruSettings,
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.user || !creds.password) {
					return false;
				}
				return ['user', creds.user, 'password', creds.password];
			}
		},
		features: providerFeatures['mailru'],
	},
	opendrive: {
		name: 'Open Drive',
		doc: '/storages/connecting-opendrive',
		authTypes: ['password'],
		settings: opendriveSettings,
		setup: creds => ['username', creds.username, 'password', creds.password],
		features: providerFeatures['opendrive'],
	},
	qingstor: {
		name: 'QingStor',
		doc: '/storages/connecting-qingstor',
		authTypes: ['client'],
		settings: qingstorSettings,
		setup: creds => [
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'zone',
			creds.zone,
		],
		features: providerFeatures['qingstor'],
	},
	premiumizeme: {
		name: 'Premiumize.me',
		doc: '/storages/connecting-premiumize-me',
		settings: premiumizemeSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.api_key || !creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'api_key',
					creds.api_key,
					'--premiumizeme-client-credentials',
				];
			}
		},
		features: providerFeatures['premiumizeme'],
	},
	putio: {
		name: 'Put.io',
		doc: '/storages/connecting-put-io',
		settings: putioSettings,
		authTypes: ['client', 'oauth'],
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			}
		},
		features: providerFeatures['putio'],
	},
	sharefile: {
		name: 'Citrix ShareFile',
		doc: '/storages/connecting-citrix-sharefile',
		authTypes: ['client', 'oauth'],
		settings: citrixSharefileSettings,
		setup: (creds, type) => {
			if (type === 'oauth') {
				if (!creds.token) {
					return false;
				}
				return ['token', creds.token];
			} else {
				if (!creds.hostname || !creds.client_id || !creds.client_secret) {
					return false;
				}
				return [
					'hostname',
					creds.hostname,
					'client_id',
					creds.client_id,
					'client_secret',
					creds.client_secret,
					'--sharefile-client-credentials',
				];
			}
		},
		features: providerFeatures['sharefile'],
	},
	sugarsync: {
		name: 'SugarSync',
		doc: '/storages/connecting-sugarsync',
		authTypes: ['client'],
		settings: sugarsyncSettings,
		setup: creds => [
			'access_key_id',
			creds.access_key_id,
			'private_access_key',
			creds.private_access_key,
			'refresh_token',
			creds.refresh_token,
		],
		features: providerFeatures['sugarsync'],
	},

	fichier: {
		name: '1Fichier',
		doc: '/storages/connecting-1fichier',
		authTypes: ['client'],
		settings: fichierSettings,
		setup: creds => {
			return ['api_key', creds.api_key];
		},
		features: providerFeatures['1fichier'],
	},
	netstorage: {
		name: 'Akamai NetStorage',
		doc: '/storages/connecting-akamai-netstorage',
		authTypes: ['client'],
		settings: netstorageSettings,
		setup: creds => [
			'hostname',
			creds.hostname,
			'account_name',
			creds.account_name,
			'key',
			creds.key,
		],
		features: providerFeatures['netstorage'],
	},
	files: {
		name: 'Files.com', // authentication either using apiKey or username/password
		doc: '/storages/connecting-files-com',
		authTypes: ['client', 'password'],
		settings: filesComSettings,
		setup: creds => ['api_key', creds.api_key],
		features: providerFeatures['files'],
	},
	gofile: {
		name: 'GoFile',
		doc: '/storages/connecting-gofile',
		authTypes: ['client'],
		settings: gofileSettings,
		setup: creds => ['token', creds.token],
		features: providerFeatures['gofile'],
	},
	gphotos: {
		name: 'Google Photos',
		doc: '/storages/connecting-google-photos',
		authTypes: ['client', 'password'],
		settings: gphotosSettings,
		setup: creds => ['client_id', creds.client_id, 'client_secret', creds.client_secret],
		features: providerFeatures['gphotos'],
	},
	internetarchive: {
		name: 'Internet Archive',
		doc: '/storages/connecting-internet-archive',
		authTypes: ['client'],
		settings: internetarchiveSettings,
		setup: creds => [
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
		],
		features: providerFeatures['internetarchive'],
	},
	linkbox: {
		name: 'Linkbox',
		doc: '/storages/connecting-linkbox',
		authTypes: ['client'],
		settings: linkboxSettings,
		setup: creds => ['api_key', creds.api_key],
		features: providerFeatures['linkbox'],
	},
	oracle: {
		name: 'Oracle Object Storage',
		doc: '/storages/connecting-oracle-object-storage',
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
			creds.access_key,
			'secret_key',
			creds.secret_key,
		],
		features: providerFeatures['oracle'],
	},
	pikpak: {
		name: 'PikPak',
		doc: '/storages/connecting-pikpak',
		authTypes: ['password'],
		settings: pikpakSettings,
		setup: creds => ['username', creds.username, 'password', creds.password],
		features: providerFeatures['pikpak'],
	},
	pixeldrain: {
		name: 'Pixeldrain',
		doc: '/storages/connecting-pixeldrain',
		authTypes: ['client'],
		settings: pixeldrainSettings,
		setup: creds => ['api_key', creds.api_key],
		features: providerFeatures['pixeldrain'],
	},
	proton: {
		name: 'Proton Drive',
		doc: '/storages/connecting-proton-drive',
		authTypes: ['password'],
		settings: protondriveSettings,
		setup: creds => ['username', creds.username, 'password', creds.password],
		features: providerFeatures['proton'],
	},
	quatrix: {
		name: 'Quatrix by Maytech',
		doc: '/storages/connecting-quatrix',
		authTypes: ['client'],
		settings: quatrixSettings,
		setup: creds => ['api_key', creds.api_key, 'user', creds.user, 'host', creds.host],
		features: providerFeatures['quatrix'],
	},
	sia: {
		name: 'Sia',
		doc: '/storages/connecting-sia',
		authTypes: ['client'],
		settings: siaSettings,
		setup: creds => ['api_url', creds.api_url, 'password', creds.password],
		features: providerFeatures['sia'],
	},
	ulozto: {
		name: 'Uloz.to',
		doc: '/storages/connecting-uloz-to',
		authTypes: ['password'],
		settings: uloztoSettings,
		setup: creds => ['username', creds.username, 'password', creds.password],
		features: providerFeatures['ulozto'],
	},
	hdfs: {
		name: 'HDFS',
		doc: '/storages/connecting-hdfs',
		authTypes: ['password'],
		settings: hdfsSettings,
		setup: creds => ['namenode', creds.namenode, 'username', creds.username],
		features: providerFeatures['hdfs'],
	},
	smb: {
		name: 'SMB',
		doc: '/storages/connecting-smb',
		authTypes: ['password'],
		settings: smbSettings,
		setup: creds => ['host', creds.host, 'username', creds.username, 'password', creds.password],
		features: providerFeatures['smb'],
	},
	sftp: {
		name: 'SFTP',
		doc: '/storages/connecting-sftp',
		authTypes: ['password'],
		settings: sftpSettings,
		setup: creds => ['host', creds.host, 'user', creds.user, 'pass', creds.pass],
		features: providerFeatures['sftp'],
	},
	ftp: {
		name: 'FTP',
		doc: '/storages/connecting-ftp',
		authTypes: ['password'],
		settings: ftpSettings,
		setup: creds => ['host', creds.host, 'user', creds.user, 'pass', creds.pass],
		features: providerFeatures['ftp'],
	},
	webdav: {
		name: 'WebDav',
		doc: '/storages/connecting-webdav',
		authTypes: ['password'],
		settings: webdavSettings,
		setup: creds => ['url', creds.url, 'user', creds.user, 'pass', creds.pass],
		features: providerFeatures['webdav'],
	},
	http: {
		name: 'HTTP (Read Only)',
		doc: '/storages/connecting-http',
		authTypes: ['noauth'],
		settings: httpSettings,
		setup: creds => ['url', creds.url],
		features: providerFeatures['http'],
	},
	drime: {
		name: 'Drime',
		doc: '/storages/connecting-drime',
		authTypes: ['client'],
		settings: drimeSettings,
		setup: creds => ['access_token', creds.access_token],
		features: providerFeatures['drime'],
	},
	filelu: {
		name: 'FileLu',
		doc: '/storages/connecting-filelu',
		authTypes: ['client'],
		settings: fileluSettings,
		setup: creds => ['key', creds.key],
		features: providerFeatures['filelu'],
	},
	filen: {
		name: 'Filen',
		doc: '/storages/connecting-filen',
		authTypes: ['password'],
		settings: filenSettings,
		setup: creds => ['email', creds.email, 'password', creds.password, 'api_key', creds.api_key],
		features: providerFeatures['filen'],
	},
	internxt: {
		name: 'Internxt Drive',
		doc: '/storages/connecting-internxt',
		authTypes: ['password'],
		settings: internxtSettings,
		setup: creds => ['email', creds.email, 'pass', creds.pass],
		features: providerFeatures['internxt'],
	},
	shade: {
		name: 'Shade',
		doc: '/storages/connecting-shade',
		authTypes: ['client'],
		settings: shadeSettings,
		setup: creds => ['drive_id', creds.drive_id, 'api_key', creds.api_key],
		features: providerFeatures['shade'],
	},

	/* ===================== S3 Compatible Storages ========================== */
	r2: {
		name: 'Cloudflare R2',
		doc: '/storages/connecting-cloudflare-r2',
		authTypes: ['client'],
		settings: r2Settings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Cloudflare',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			`https://${creds.endpoint}.r2.cloudflarestorage.com`,
			'region',
			'auto',
			'no_check_bucket',
			'true',
		],
	},
	oss: {
		name: 'Alibaba Cloud Object Storage System (OSS)',
		doc: '/storages/connecting-alibaba-cloud-oss',
		authTypes: ['client'],
		settings: ossSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Alibaba',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
			'storage_class',
			creds.storage_class,
		],
	},
	ceph: {
		name: 'Ceph',
		doc: '/storages/connecting-ceph',
		authTypes: ['client'],
		settings: cephSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Ceph', //TODO: No region field
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			`${creds.endpoint}`,
			'acl',
			'private',
		],
	},
	dreamobjects: {
		name: 'DreamObjects',
		doc: '/storages/connecting-dreamhost',
		authTypes: ['client'],
		settings: dreamobjectsSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'DreamHost', //TODO: No region field
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
		],
	},
	spaces: {
		name: 'DigitalOcean Spaces',
		doc: '/storages/connecting-digitalocean-spaces',
		authTypes: ['client'],
		settings: spacesSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'DigitalOcean', //TODO: No region field
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	obs: {
		name: 'Huawei OBS',
		doc: '/storages/connecting-huawei-obs',
		authTypes: ['client'],
		settings: obsSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'HuaweiOBS',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'region',
			creds.region,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
		],
	},
	ibmcos: {
		name: 'IBM Cloud Object Storage',
		doc: '/storages/connecting-ibm-cos-s3',
		authTypes: ['client'],
		settings: ibmcosSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'IBMCOS',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'region',
			creds.region,
			'endpoint',
			creds.endpoint,
			'location_constraint',
			creds.location_constraint,
			'acl',
			'private',
		],
	},
	idrive: {
		name: 'IDrive e2',
		doc: '/storages/connecting-idrive-e2',
		authTypes: ['client'],
		settings: idriveSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'IDrive',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	ionos: {
		name: 'IONOS Cloud',
		doc: '/storages/connecting-ionos-cloud',
		authTypes: ['client'],
		settings: ionosSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'IONOS', //TODO: No region field
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	minio: {
		name: 'Minio',
		doc: '/storages/connecting-minio',
		authTypes: ['client'],
		settings: minioSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Minio',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
			'region',
			creds.region,
		],
	},
	outscale: {
		name: 'Outscale Object Storage',
		doc: '/storages/connecting-outscale',
		authTypes: ['client'],
		settings: outscaleSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Outscale',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			`oos.${creds.region}.outscale.com`,
			'region',
			creds.region,
		],
	},
	qiniu: {
		name: 'Qiniu Object Storage (KODO)',
		authTypes: ['client'],
		settings: qiniuSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-qiniu-kodo',
		setup: creds => [
			'provider',
			'Qiniu',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
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
	rackcorp: {
		name: 'RackCorp',
		authTypes: ['client'],
		settings: rackcorpSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-rackcorp',
		setup: creds => [
			'provider',
			'RackCorp',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			`${creds.region}.s3.rackcorp.com`,
			'region',
			creds.region,
			'location_constraint ',
			creds.region,
		],
	},
	rclone: {
		name: 'Rclone Serve S3',
		authTypes: ['client'],
		settings: rcloneSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Rclone',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
			'use_multipart_uploads',
			'false',
		],
	},

	scaleway: {
		name: 'Scaleway Object Storage',
		authTypes: ['client'],
		settings: scalewaySettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-scaleway',
		setup: creds => [
			'provider',
			'Scaleway',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
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
	lyvecloud: {
		name: 'Seagate LyveCloud',
		authTypes: ['client'],
		settings: lyvecloudSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-seagate-lyve-cloud',
		setup: creds => [
			'provider',
			'LyveCloud',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	seaweedfs: {
		name: 'SeaweedFS',
		authTypes: ['client'],
		settings: seaweedfsSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-seaweedfs',
		setup: creds => [
			'provider',
			'SeaweedFS',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	selectel: {
		name: 'Selectel',
		authTypes: ['client'],
		settings: selectelSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-selectel',
		setup: creds => [
			'provider',
			'Selectel',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			's3.ru-1.storage.selcloud.ru',
			'region',
			'ru-1',
			'acl',
			'private',
		],
	},
	wasabi: {
		name: 'Wasabi',
		authTypes: ['client'],
		settings: wasabiSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-wasabi',
		setup: creds => [
			'provider',
			'Wasabi',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			`s3.${creds.region === 'us-east-1' ? '' : '.' + creds.region}wasabisys.com`,
			'region',
			creds.region,
		],
	},
	leviia: {
		name: 'Leviia',
		doc: '/storages/connecting-leviia',
		authTypes: ['client'],
		settings: leviiaSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		setup: creds => [
			'provider',
			'Leviia',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
			'acl',
			'private',
		],
	},
	liara: {
		name: 'Liara',
		authTypes: ['client'],
		settings: liaraSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-liara',
		setup: creds => [
			'provider',
			'Liara',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			'storage.iran.liara.space',
		],
	},
	linode: {
		name: 'Linode Object Storage',
		authTypes: ['client'],
		settings: linodeSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-linode',
		setup: creds => [
			'provider',
			'Linode',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	magalu: {
		name: 'Magalu',
		authTypes: ['client'],
		settings: magaluSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-magalu',
		setup: creds => [
			'provider',
			'Magalu',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	arvan: {
		name: 'ArvanCloud',
		authTypes: ['client'],
		settings: arvanSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-arvan-cloud',
		setup: creds => [
			'provider',
			'ArvanCloud',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'region',
			creds.region,
			'endpoint',
			creds.endpoint || `s3.${creds.region}.arvanstorage.ir`,
		],
	},
	tencent: {
		name: 'Tencent Cloud Object Storage (COS)',
		authTypes: ['client'],
		settings: tencentSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-tencent-cos',
		setup: creds => [
			'provider',
			'TencentCOS',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			creds.endpoint,
		],
	},
	petabox: {
		name: 'Petabox',
		authTypes: ['client'],
		settings: petaboxSettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-petabox',
		setup: creds => [
			'provider',
			'Petabox',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'endpoint',
			's3.petabox.io',
			'region',
			'eu-east-1', //Available in One location only: https://docs.petabox.io/http-api-compatible-with-amazon-s3/api-reference/bucket/getbucketlocation
		],
	},
	synologyc2: {
		name: 'Synology C2',
		authTypes: ['client'],
		settings: synologySettings,
		features: providerFeatures['s3'],
		s3Adapter: true,
		doc: '/storages/connecting-synology',
		setup: creds => [
			'provider',
			'SynologyC2',
			'access_key_id',
			creds.access_key_id,
			'secret_access_key',
			creds.secret_access_key,
			'region',
			creds.region,
			'endpoint',
			`${creds.region}.s3.synologyc2.net`,
			'no_check_bucket',
			'true',
		],
	},
};
