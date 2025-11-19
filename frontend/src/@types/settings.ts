export interface SmtpSettingsType {
   server: string;
   port: number;
   username: string;
   password: string;
   connected: boolean;
   senderEmail: string;
}

export interface LogItem {
   level: number;
   time: number;
   pid: number;
   hostname: string;
   module: string;
   planId?: string;
   backupId?: string;
   deviceId?: string;
   msg: string;
}
