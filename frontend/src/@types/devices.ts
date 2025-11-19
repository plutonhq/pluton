import { PlanChildItem } from './plans';

export interface Device {
   id: string;
   ip: string;
   name: string;
   type: string;
   connected: boolean;
   createdAt: string;
   agentId: string | null;
   versions: {
      agent: string | null;
      restic: string | null;
      rclone: string | null;
   };
   host: string | null;
   port: number | null;
   hostname: string | null;
   os: string | null;
   platform: string | null;
   disks:
      | {
           filesystem: string;
           totalBytes: number;
           usedBytes: number;
           availableBytes: number;
           usagePercentage: number;
           mountPoint: string;
        }[]
      | null;
   status: string | null;
   isRemote: boolean;
   lastSeen: string | null;
   plans: PlanChildItem[];
   tags: string[];
   metrics: DeviceMetrics | null;
   settings: {
      tempDir: string;
   };
}

export interface DeviceMetrics {
   system: {
      manufacturer: string;
      model: string;
      version: string;
      serial: string;
      uuid: string;
   };
   cpu: {
      manufacturer: string;
      brand: string;
      speed: number;
      cores: number;
      physicalCores: number;
      processors: number;
      cache: {
         l1d?: number;
         l1i?: number;
         l2?: number;
         l3?: number;
      };
      load: {
         currentLoad: number;
         cpus: number[];
      };
   };
   memory: {
      total: number;
      free: number;
      used: number;
      active: number;
      available: number;
      swapTotal: number;
      swapUsed: number;
      swapFree: number;
      layout: Array<{
         size: number;
         bank: string;
         type: string;
         clockSpeed: number;
         formFactor: string;
         manufacturer: string;
         partNum: string;
         serialNum: string;
         voltageConfigured: number;
         voltageMin: number;
         voltageMax: number;
      }>;
   };
   os: {
      platform: string;
      distro: string;
      release: string;
      kernel: string;
      arch: string;
      hostname: string;
      logofile: string;
      isServer: boolean;
   };
   disks: {
      physical: Array<{
         device: string;
         name: string;
         type: string;
         vendor: string;
         size: number;
         interfaceType: string;
      }>;
      filesystems: Array<{
         fs: string;
         type: string;
         size: number;
         used: number;
         available: number;
         use: number;
         mount: string;
         name: string;
      }>;
   };
   time: {
      current: number;
      uptime: number;
      timezone: string;
      timezoneName: string;
   };
   network: Array<{
      iface: string;
      ifaceName: string;
      ip4: string;
      ip6: string;
      mac: string;
      internal: boolean;
      operstate: string;
      type: string;
      speed: number;
      dhcp: boolean;
   }>;
   docker?: {
      info: {
         containers: number;
         containersRunning: number;
         containersPaused: number;
         containersStopped: number;
         images: number;
         driver: string;
         memoryLimit: boolean;
         swapLimit: boolean;
         kernelMemory: boolean;
         cpuCfsPeriod: boolean;
         cpuCfsQuota: boolean;
         cpuShares: boolean;
         cpuSet: boolean;
         ipv4Forwarding: boolean;
         bridgeNfIptables: boolean;
         bridgeNfIp6tables: boolean;
         debug: boolean;
         nfd: number;
         oomKillDisable: boolean;
         ngoroutines: number;
         systemTime: string;
         loggingDriver: string;
         cgroupDriver: string;
         nEventsListener: number;
         kernelVersion: string;
         operatingSystem: string;
         osType: string;
         architecture: string;
         serverVersion: string;
      };
      containers: Array<{
         id: string;
         name: string;
         image: string;
         imageID: string;
         command: string;
         created: number;
         started: number;
         finished: number;
         state: string;
         status: string;
         ports: string;
         mounts: string;
         networkMode: string;
         networks: Record<string, any>;
         memoryUsage: number;
         memoryLimit: number;
         cpuPercent: number;
         restartCount: number;
         platform: string;
         sizeRw: number;
         sizeRootFs: number;
      }>;
   };
}

export interface DeviceSettings {
   tempDir?: string;
   restic?: {
      maxProcessor?: number | ''; // GOMAXPROCS
      cacheDir?: string; // RESTIC_CACHE_DIR
      tempDir?: string; // RESTIC_TEMP_DIR
      readConcurrency?: number | ''; // RESTIC_READ_CONCURRENCY
      packSize?: string; // RESTIC_PACK_SIZE
   };
   rclone?: {
      tempDir?: string; // --temp-dir=DIR . default: OS temp directory
      cacheDir?: string; // --cache-dir
      bwlimit?: string; // --bwlimit 10M:100k . First value for Upload and second one for Download. Default: 0
      timeout?: string; // --timeout This sets the IO idle timeout. If a transfer has started but then becomes idle for this long it is considered broken and disconnected. The default is 5m. Set to 0 to disable.
      retries?: number | ''; // --retries . default: 3
      lowLevelRetries?: number | ''; // --low-level-retries
      transfers?: number | ''; //--transfers .The number of file transfers to run in parallel. Default: 4
      checkers?: number | ''; //--checkers . default: 8.
      bufferSize?: string; //--buffer-size . default: 16M. Note: total ram used = --buffer-size multiplied by the number of simultaneous --transfers
      multiThreadStream?: number | ''; //--multi-thread-streams . Set to 0 to disable multi thread transfers (Default 4).
      configPass?: string; //RCLONE_CONFIG_PASS → Encrypt the config file with a password.
   };
}

export interface DevicePlan {
   id: string;
   title: string;
   method: string;
   createdAt: string;
   isActive: boolean;
   sourceConfig: {
      includes: string[];
      excludes: string[];
   };
   storage: {
      id: string;
      path: string;
      name: string;
      type: string;
      typeName: string;
   };
   size: number;
}
