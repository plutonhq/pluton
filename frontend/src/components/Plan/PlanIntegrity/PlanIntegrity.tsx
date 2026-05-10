import { useState } from 'react';
import classes from './PlanIntegrity.module.scss';
import { useCheckPlanIntegrity } from '../../../services';
import { Plan, PlanReplicationStorage, PlanVerifiedResult } from '../../../@types';
import { formatDateTime, timeAgo } from '../../../utils';
import Icon from '../../common/Icon/Icon';
import ActionModal from '../../common/ActionModal/ActionModal';

interface PlanIntegrityProps {
   planId: string;
   taskPending: boolean;
   verificationData: Plan['verified'];
   storage: { name: string; type: string; id: string };
   replicationStorages: PlanReplicationStorage[];
   onClose: () => void;
   onRepairOpen: (replicationId: string) => void;
}

const PlanIntegrity = ({ planId, taskPending, verificationData, storage, replicationStorages = [], onClose, onRepairOpen }: PlanIntegrityProps) => {
   const [showContent, setShowContent] = useState('primary');
   const integrityCheckMutation = useCheckPlanIntegrity();

   const integrityResultLoaded = verificationData && verificationData?.result;
   const hasReplications = replicationStorages && replicationStorages.length > 0;

   const getBackupResultByStorage = (storageType: string): PlanVerifiedResult | null => {
      if (!verificationData?.result) return null;

      const replicationResult = verificationData.result as Record<string, PlanVerifiedResult>;
      return replicationResult[storageType] ?? null;
   };

   const renderLogs = (storageType: string) => {
      if (integrityCheckMutation.isPending) return null;
      const backupResData = getBackupResultByStorage(storageType);
      const messages = backupResData?.logs;
      if (!messages?.length) return null;

      return (
         <div className={classes.integrityLogs}>
            <div className={classes.integrityLogsHeader}>
               <div>Integrity Check Output Logs</div>
               <div title={formatDateTime(verificationData.endedAt || verificationData.startedAt)}>
                  <Icon type="clock" size={14} /> {timeAgo(new Date(verificationData.endedAt || verificationData.startedAt))}
               </div>
            </div>
            <div className={classes.integrityLogMessages}>
               {messages.map((message, index) => (
                  <span key={index}>{message}</span>
               ))}
            </div>
         </div>
      );
   };

   const renderBackupFixSuggestion = (storageType: string) => {
      if (!integrityResultLoaded) return null;
      if (integrityCheckMutation.isPending) return null;
      const backupResData = getBackupResultByStorage(storageType);
      if (!backupResData?.hasError) return null;

      return (
         <div className={classes.fixSuggestion}>
            <h4>Fix Suggestion</h4>
            <div className={classes.fixSuggestionContent}>
               {backupResData.fix &&
                  backupResData.fix
                     .split('\n')
                     .map((line, index) => <p key={index}>{line.includes('`') ? <code>{line.replace(/`/g, '')}</code> : line}</p>)}
               {!backupResData.fix && <p>No Suggestion for this issue.</p>}
               {(backupResData.errorType === 'pack_file_error' || backupResData.errorType === 'index_error') && (
                  <p>
                     <button onClick={() => onRepairOpen(storageType)}>Open Repo Repair</button> Window for more options.
                  </p>
               )}
               <p>
                  Learn more about fixing restic repo issues{' '}
                  <a
                     href="https://restic.readthedocs.io/en/latest/077_troubleshooting.html#find-out-what-is-damaged"
                     target="_blank"
                     rel="noreferrer"
                  >
                     here.
                  </a>
               </p>
            </div>
         </div>
      );
   };

   const renderBackupStatus = (storageType: string) => {
      if (!integrityResultLoaded) return null;
      if (integrityCheckMutation.isPending) return null;
      const backupResData = getBackupResultByStorage(storageType);
      const backupHasError = backupResData?.hasError;
      const backupMessage = backupResData?.message;

      if (!backupHasError && backupMessage?.includes('No Issue Detected')) {
         return <div className="label success">🥳 Yoohoo! No Corruption or Bit rot found. Your backup snapshots are completely restorable.</div>;
      }

      return <div className="label error">⛔ Error Found. {backupMessage}</div>;
   };

   const renderRepairContent = (storageType: string) => {
      const backupResData = getBackupResultByStorage(storageType);
      return (
         <div className={classes.repairBox}>
            {(backupResData?.errorType === 'pack_file_error' || backupResData?.errorType === 'repairable_pack_file_error') && (
               <div>
                  Some pack files in the repository are either damaged or missing and can be repaired.{' '}
                  <button onClick={() => onRepairOpen(storageType)}>
                     <Icon type="repair" size={13} /> Open Repo Repair Tool
                  </button>
               </div>
            )}
            {backupResData?.errorType === 'index_error' && (
               <div>
                  The index files in the repository are corrupted and can be repaired.{' '}
                  <button onClick={() => onRepairOpen(storageType)}>
                     <Icon type="repair" size={13} /> Open Repo Repair Tool
                  </button>{' '}
               </div>
            )}
         </div>
      );
   };

   const renderRepairOrFixSuggestion = (storageType: string) => {
      const backupResData = getBackupResultByStorage(storageType);
      const errorType = backupResData?.errorType;
      const isRepairable = errorType === 'pack_file_error' || errorType === 'index_error' || errorType === 'repairable_pack_file_error';
      return isRepairable ? renderRepairContent(storageType) : renderBackupFixSuggestion(storageType);
   };

   const renderResultWithReplications = () => {
      return (
         <div className={`${classes.integrityResult} ${classes.withReplications}`}>
            {verificationData &&
               Object.entries(verificationData.result as Record<string, PlanVerifiedResult>).map(([storageType]) => {
                  let theStorage = storage;
                  if (storageType !== 'primary') {
                     const mirror = replicationStorages.find((s) => s.storageId === storageType.replace('mirror_', ''));
                     if (mirror) {
                        theStorage = { name: mirror.storageName as string, type: mirror?.storageType as string, id: mirror?.storageId as string };
                     }
                  }
                  if (!theStorage) return null;
                  const backupResData = getBackupResultByStorage(storageType);
                  const backupHasError = backupResData?.hasError;
                  return (
                     <div key={storageType} className={classes.replicationResult}>
                        <h4 onClick={() => setShowContent(storageType)} className={showContent === storageType ? classes.active : ''}>
                           <span>
                              <img src={`/providers/${theStorage.type}.png`} />
                              {theStorage.name} <i>{storageType === 'primary' ? 'Primary' : `Mirror`}</i>
                           </span>
                           <span>
                              {backupHasError ? (
                                 <Icon type="error-circle-filled" size={14} color="#ff4d4f" />
                              ) : (
                                 <Icon type="check-circle-filled" size={14} color="#06ba9f" />
                              )}
                           </span>
                        </h4>
                        {showContent === storageType && (
                           <div className={classes.replicationResultContent}>
                              {renderBackupStatus(storageType)}
                              {renderLogs(storageType)}
                              {renderRepairOrFixSuggestion(storageType)}
                           </div>
                        )}
                     </div>
                  );
               })}
         </div>
      );
   };

   return (
      <ActionModal
         title="Check Backup Integrity"
         message={
            <div className={classes.integrityMessage}>
               {!integrityResultLoaded && <p>Check the integrity of the backup snapshots now to check if they are restorable?</p>}
               {integrityResultLoaded && (
                  <div>
                     {!hasReplications ? (
                        <div className={classes.integrityResult}>
                           {renderBackupStatus('primary')}
                           {renderLogs('primary')}
                           {renderRepairOrFixSuggestion('primary')}
                        </div>
                     ) : (
                        renderResultWithReplications()
                     )}
                  </div>
               )}
               {integrityCheckMutation.isPending && (
                  <div className="label in_progress">
                     <Icon type="loading" size={14} />
                     Checking integrity...
                  </div>
               )}
            </div>
         }
         errorMessage={integrityCheckMutation.error?.message}
         closeModal={() => onClose()}
         width="600px"
         primaryAction={{
            title: integrityResultLoaded ? 'Check Again' : 'Check Now',
            type: 'default',
            isPending: integrityCheckMutation.isPending,
            action: () => !taskPending && integrityCheckMutation.mutate({ planId }),
         }}
         secondaryAction={{
            title: 'Close',
            action: () => onClose(),
         }}
      />
   );
};

export default PlanIntegrity;
