import { BackupProgressData } from '../@types/backups';

export function generateBackupProgressMessage(progressData: BackupProgressData | null): string {
   if (!progressData?.events?.length) {
      return 'Initializing...';
   }

   // Find the last incomplete event or the most recent event
   const lastIncompleteEvent = progressData.events
      .slice()
      .reverse()
      .find((event) => !event.completed);

   const currentEvent = lastIncompleteEvent || progressData.events[progressData.events.length - 1];

   if (!currentEvent) {
      return 'Initializing...';
   }

   const { phase, action } = currentEvent;

   // Map phases to display names
   const phaseDisplayNames: Record<string, string> = {
      initializing: 'Initializing',
      'pre-backup': 'Pre-Backup',
      backup: 'Backup',
      'post-backup': 'Post-Backup',
      finished: 'Complete',
   };

   const phaseDisplay = phaseDisplayNames[phase] || phase;
   const actionDisplay = getBackupEventActionMessage(action);

   if (phase === 'finished') {
      return actionDisplay;
   }

   return `${phaseDisplay}: ${actionDisplay}`;
}

// Helper function to handle script actions dynamically
const handleScriptAction = (action: string): string | null => {
   const scriptTypes = {
      ONBACKUPSTART: 'Start Script',
      ONBACKUPCOMPLETE: 'Complete Script',
      ONBACKUPERROR: 'Error Script',
      ONBACKUPFAILURE: 'Failure Script',
      ONBACKUPEND: 'End Script',
   };

   const actionStates = {
      START: (scriptType: string, num: string) => `Running ${scriptType} ${num}...`,
      COMPLETE: (_: string, num: string) => `Script ${num} Complete`,
      FAIL: (_: string, num: string) => `Script ${num} Failed`,
      ERROR: (scriptType: string, num: string) => `Error in ${scriptType} ${num}`,
   };

   // Generic pattern for all script actions: SCRIPTTYPE_SCRIPT_NUMBER_STATE
   const scriptMatch = action.match(/^(ONBACKUP\w+)_SCRIPT_(\d+)_(START|COMPLETE|FAIL|ERROR)$/);

   if (scriptMatch) {
      const [, scriptTypeKey, scriptNum, state] = scriptMatch;
      const scriptType = scriptTypes[scriptTypeKey as keyof typeof scriptTypes] || 'Script';
      const stateHandler = actionStates[state as keyof typeof actionStates];

      if (stateHandler) {
         return stateHandler(scriptType, scriptNum);
      }
   }

   return null;
};

// Function to extract numbers from action strings and create meaningful messages
export const getBackupEventActionMessage = (action: string): string => {
   // Handle script actions first
   const scriptMessage = handleScriptAction(action);
   if (scriptMessage) {
      return scriptMessage;
   }

   // Handle retry attempts
   const retryAttemptMatch = action.match(/RETRY_ATTEMPT_(\d+)_OF_(\d+)_START/);
   if (retryAttemptMatch) {
      const [, current, total] = retryAttemptMatch;
      return `Retrying (${current}/${total})...`;
   }

   // Handle backup retry scheduling
   const backupRetryMatch = action.match(/BACKUP_RETRY_(\d+)_OF_(\d+)_SCHEDULED/);
   if (backupRetryMatch) {
      const [, current, total] = backupRetryMatch;
      return `Scheduling Retry (${parseInt(current)}/${total})...`;
   }

   // Static action mappings
   const staticMessages: Record<string, string> = {
      INITIALIZE: 'Starting Backup...',
      PRE_BACKUP_START: 'Preparing Backup...',
      PRE_BACKUP_DRY_RUN_START: 'Performing Dry Run...',
      PRE_BACKUP_DRY_RUN_COMPLETE: 'Dry Run Complete',
      PRE_BACKUP_CHECKS_START: 'Running Checks...',
      PRE_BACKUP_CHECKS_COMPLETE: 'Checks Complete',
      PRE_BACKUP_SCRIPTS_START: 'Running Scripts...',
      PRE_BACKUP_SCRIPTS_COMPLETE: 'Scripts Complete',
      PRE_BACKUP_UNLOCK_STALE_LOCKS: 'Unlocking Repository...',
      PRE_BACKUP_COMPLETE: 'Pre-Backup Complete',
      BACKUP_OPERATION_START: 'Backing Up Files...',
      BACKUP_OPERATION_COMPLETE: 'Backup Complete',
      BACKUP_OPERATION_ERROR: 'Backup Encountered Errors',
      POST_BACKUP_START: 'Finalizing...',
      POST_BACKUP_SCRIPTS_START: 'Running Cleanup Scripts...',
      POST_BACKUP_SCRIPTS_COMPLETE: 'Cleanup Scripts Complete',
      POST_BACKUP_PRUNE_START: 'Pruning Old Backups...',
      POST_BACKUP_PRUNE_COMPLETE: 'Pruning Complete',
      POST_BACKUP_PRUNE_FAILED: 'Pruning Failed',
      POST_BACKUP_COMPLETE: 'Post-Backup Complete',
      POST_BACKUP_REPO_STATS_START: 'Updating Repository Statistics...',
      POST_BACKUP_REPO_STATS_COMPLETE: 'Repository Statistics Updated',
      POST_BACKUP_REPO_STATS_FAILED: 'Failed to Update Repository Statistics',
      TASK_COMPLETED: 'Completed Successfully',
      TASK_CANCELLED: 'Backup Cancelled by User.',
      TASK_FAILED: 'Backup Failed with Error.',
      FAILED_PERMANENTLY: 'Failed Permanently',
      ISO_CREATION_START: 'Creating ISO...',
      ISO_CREATION_COMPLETE: 'ISO Created Successfully',
      ISO_CREATION_FAILED: 'ISO Creation Failed',
      REMOTE_BACKUP_START: 'Backing Up Data...',
      REMOTE_BACKUP_COMPLETE: 'Data Backup Complete',
      REMOTE_BACKUP_FAILED: 'Data Backup Failed',
      ISO_ENCRYPTION_START: 'Encrypting ISO...',
      ISO_ENCRYPTION_COMPLETE: 'ISO Encryption Complete',
      ISO_UPLOAD_START: 'Uploading ISO...',
      ISO_UPLOAD_COMPLETE: 'ISO Upload Complete',
      ISO_UPLOAD_FAILED: 'ISO Upload Failed',
      BACKUP_WARNING: 'Hiccup Detected During Backup',
   };

   return staticMessages[action] || action;
};

export function generateRestoreProgressMessage(progressData: BackupProgressData | null): string {
   if (!progressData?.events?.length) {
      return 'Initializing...';
   }

   // Find the last incomplete event or the most recent event
   const lastIncompleteEvent = progressData.events
      .slice()
      .reverse()
      .find((event) => !event.completed);

   const currentEvent = lastIncompleteEvent || progressData.events[progressData.events.length - 1];

   if (!currentEvent) {
      return 'Initializing...';
   }

   const { phase, action } = currentEvent;

   // Map phases to display names
   const phaseDisplayNames: Record<string, string> = {
      initializing: 'Initializing',
      'pre-restore': 'Pre-Restore',
      restore: 'Restore',
      'post-restore': 'Post-Restore',
      retry: 'Retrying',
      finished: 'Complete',
   };

   const phaseDisplay = phaseDisplayNames[phase] || phase;
   const actionDisplay = getRestoreEventActionMessage(action);

   if (phase === 'finished') {
      return actionDisplay;
   }

   return `${phaseDisplay}: ${actionDisplay}`;
}

export const getRestoreEventActionMessage = (action: string): string => {
   // Handle script actions first
   const scriptMessage = handleScriptAction(action);
   if (scriptMessage) {
      return scriptMessage;
   }

   // Handle retry attempts
   const retryAttemptMatch = action.match(/RETRY_ATTEMPT_(\d+)_OF_(\d+)_START/);
   if (retryAttemptMatch) {
      const [, current, total] = retryAttemptMatch;
      return `Retrying (${current}/${total})...`;
   }

   // Handle backup retry scheduling
   const backupRetryMatch = action.match(/RESTORE_RETRY_(\d+)_OF_(\d+)_SCHEDULED/);
   if (backupRetryMatch) {
      const [, current, total] = backupRetryMatch;
      return `Scheduling Retry (${parseInt(current)}/${total})...`;
   }

   // Static action mappings
   const staticMessages: Record<string, string> = {
      INITIALIZE: 'Starting Restore...',
      PRE_RESTORE_START: 'Preparing Restore...',
      PRE_RESTORE_GET_SNAPSHOT: 'Getting Snapshot to Restore...',
      PRE_RESTORE_GET_SNAPSHOT_COMPLETE: 'Snapshot Retrieved',
      PRE_RESTORE_GET_SNAPSHOT_FAILED: 'Failed to Retrieve Snapshot',
      PRE_RESTORE_DRY_RUN_START: 'Performing Dry Run...',
      PRE_RESTORE_DRY_RUN_COMPLETE: 'Dry Run Complete',
      PRE_RESTORE_CHECKS_START: 'Running Checks...',
      PRE_RESTORE_CHECKS_COMPLETE: 'Checks Complete',
      PRE_RESTORE_UNLOCK_STALE_LOCKS: 'Unlocking Repository...',
      PRE_RESTORE_COMPLETE: 'Pre-Restore Complete',
      RESTORE_OPERATION_START: 'Restoring Files...',
      RESTORE_OPERATION_COMPLETE: 'Restore Complete',
      POST_RESTORE_START: 'Finalizing...',
      POST_RESTORE_COMPLETE: 'Post-Restore Complete',
      POST_RESTORE_REPO_STATS_START: 'Updating Repository Statistics...',
      POST_RESTORE_REPO_STATS_COMPLETE: 'Repository Statistics Updated',
      POST_RESTORE_WINDOWS_MOVE_START: 'Moving Restored files from temp directory to target path...',
      POST_RESTORE_WINDOWS_MOVE_ERROR: 'Failed to Move Restored files from temp directory to target path',
      POST_RESTORE_WINDOWS_MOVE_COMPLETE: 'Moved Restored files to target path',
      TASK_COMPLETED: 'Completed Successfully',
      TASK_FAILED: 'Restore Failed with Error.',
      TASK_CANCELLED: 'Restore Cancelled by User.',
      FAILED_PERMANENTLY: 'Failed Permanently',
   };
   return staticMessages[action] || action;
};

export function extractResticData(progressData: BackupProgressData | null) {
   if (!progressData?.events?.length) {
      return null;
   }

   // Find the most recent event with resticData
   const eventWithResticData = progressData.events
      .slice()
      .reverse()
      .find((event) => event.resticData);

   return eventWithResticData?.resticData || null;
}
