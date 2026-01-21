import { NewPlanSettings } from '../@types/plans';

export const DEV_MODE = import.meta.env.MODE !== 'production';
export const API_URL = DEV_MODE ? `${import.meta.env.VITE_BACKEND_URL}/api` : `${window.location.origin}/api`;
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Pluton';
export const DEFAULT_PLAN_SETTINGS: NewPlanSettings = {
   title: 'New Backup',
   method: 'backup',
   sourceId: 'main',
   sourceType: 'device',
   sourceConfig: {
      includes: [],
      excludes: [],
   },
   storage: { id: 's89hibdias67', name: '' },
   storagePath: '',
   settings: {
      interval: { type: 'daily', time: '10:00AM', days: '', hours: '', minutes: 5 },
      compression: true,
      encryption: true,
      retries: 5,
      retryDelay: 300, // in seconds
      notification: {
         email: {
            enabled: false,
            case: 'failure',
            type: 'smtp',
            emails: '',
         },
         webhook: {
            enabled: false,
            case: 'failure',
            method: 'POST',
            contentType: 'application/json',
            url: '',
         },
         push: {
            enabled: false,
            url: '',
            case: 'failure',
            authType: 'none',
            authToken: '',
            tags: '',
         },
      },
      prune: {
         snapCount: 5,
         policy: 'forgetByAge',
         forgetAge: '1m',
         revisions: true,
      },
      performance: {
         scan: true,
      },
      integrity: {
         enabled: false,
         interval: { type: 'weekly', time: '10:00AM', days: 'sun', hours: '', minutes: 5 },
         method: 'no-read',
         notification: {
            email: {
               enabled: false,
               type: 'smtp',
               emails: '',
            },
            webhook: {
               enabled: false,
               method: 'POST',
               contentType: 'application/json',
               url: '',
            },
            push: {
               enabled: false,
               url: '',
               authType: 'none',
               authToken: '',
               tags: '',
            },
         },
      },
      scripts: {
         onBackupStart: [],
         onBackupEnd: [],
         onBackupError: [],
         onBackupFailure: [],
         onBackupComplete: [],
      },
   },
   tags: [],
};
