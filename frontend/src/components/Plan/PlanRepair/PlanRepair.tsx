import { toast } from 'react-toastify';
import { usePausePlan, usePerformBackup, useRepairBackupPlan, useResumePlan } from '../../../services';
import Icon from '../../common/Icon/Icon';
import SidePanel from '../../common/SidePanel/SidePanel';
import classes from './PlanRepair.module.scss';

interface PlanRepairProps {
   planId: string;
   errorType: string;
   onClose: () => void;
   onOpenIntegrity: () => void;
}

const PlanRepair = ({ planId, errorType, onClose, onOpenIntegrity }: PlanRepairProps) => {
   const pauseMutation = usePausePlan();
   const resumeMutation = useResumePlan();

   const performBackupMutation = usePerformBackup();
   const repairRepoMutation = useRepairBackupPlan();

   const shouldBeInaccessible =
      pauseMutation.isPending || resumeMutation.isPending || performBackupMutation.isPending || repairRepoMutation.isPending;

   const pausePlan = () => {
      toast.promise(
         pauseMutation.mutateAsync(planId),
         {
            pending: 'Pausing backup Plan...',
            success: 'Backup Plan Paused',
            error: {
               render({ data }: any) {
                  return `Failed to Pause Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         },
         { autoClose: 3000 },
      );
   };

   const resumePlan = () => {
      toast.promise(
         resumeMutation.mutateAsync(planId),
         {
            pending: 'Resuming backup Plan...',
            success: 'Backup Plan Resumed',
            error: {
               render({ data }: any) {
                  return `Failed to Resume Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         },
         { autoClose: 3000 },
      );
   };

   const runBackup = () => {
      toast.promise(performBackupMutation.mutateAsync({ id: planId, runConfig: { ignoreErrors: true, skipPrune: true } }), {
         pending: 'Running backup...',
         success: 'Backup Started!',
         error: {
            render({ data }: any) {
               return `Failed to Start Backup. ${data?.message || 'Unknown Error.'}`;
            },
         },
      });
   };

   const repairRepo = (type: 'index' | 'snapshots' | 'packs') => {
      toast.promise(repairRepoMutation.mutateAsync({ planId, type }), {
         pending: `Repairing broken ${type}...`,
         success: `Successfully repaired broken ${type}.`,
         error: {
            render({ data }: any) {
               return `Failed to repair broken ${type}. ${data?.message || 'Unknown Error.'}`;
            },
         },
      });
   };

   const renderMissingPackRepairContent = () => {
      return (
         <div className={classes.repairContent}>
            <p className={classes.repairTitle}>Fixing Restic Repo with Damaged or Missing Packs</p>
            <p>
               <strong>Step 1: </strong> First,{' '}
               <button onClick={pausePlan} disabled={shouldBeInaccessible}>
                  <Icon type="pause" size={12} /> Pause
               </button>{' '}
               the backup plan to prevent any new backup runs from starting.
            </p>
            <p>
               <strong>Step 2: </strong> Download/Backup the index and the snapshots directories from the destination storage.
            </p>
            <p>
               <strong>Step 3: </strong> Then{' '}
               <button onClick={() => repairRepo('index')} disabled={shouldBeInaccessible}>
                  <Icon type="repair" size={12} /> Repair the Repo Index
               </button>{' '}
               to fix missing or damaged pack files.
            </p>
            <p>
               <strong>Step 4: </strong> Then{' '}
               <button onClick={runBackup} disabled={shouldBeInaccessible}>
                  <Icon type="backup" size={13} /> Run a Backup
               </button>{' '}
               to update the Repo Index after repairing it.
            </p>
            <p>
               <strong>Step 5: </strong> Then{' '}
               <button onClick={onOpenIntegrity} disabled={shouldBeInaccessible}>
                  <Icon type="integrity" size={12} /> Check Integrity
               </button>{' '}
               again to see if the repo is fixed.
            </p>
            <p>
               <strong>Step 6: </strong> If that did not fix the issue,{' '}
               <button onClick={() => repairRepo('snapshots')} disabled={shouldBeInaccessible}>
                  <Icon type="repair" size={12} /> Repair Broken Snapshots
               </button>{' '}
               and then{' '}
               <button onClick={onOpenIntegrity} disabled={shouldBeInaccessible}>
                  <Icon type="integrity" size={12} /> Check Integrity
               </button>
            </p>
            <p>
               <strong>Step 7: </strong> If the issue is resolved,{' '}
               <button onClick={resumePlan} disabled={shouldBeInaccessible}>
                  <Icon type="play" size={12} /> Resume
               </button>{' '}
               the backup plan.
            </p>
         </div>
      );
   };
   const renderPackRepairContent = () => {
      return (
         <div className={classes.repairContent}>
            <p className={classes.repairTitle}>Fixing Restic Repo with Damaged Pack files</p>
            <p>
               <strong>Step 1: </strong> First,{' '}
               <button onClick={pausePlan} disabled={shouldBeInaccessible}>
                  <Icon type="pause" size={12} /> Pause
               </button>{' '}
               the backup plan to prevent any new backup runs from starting.
            </p>
            <p>
               <strong>Step 2: </strong> Then{' '}
               <button onClick={() => repairRepo('packs')} disabled={shouldBeInaccessible}>
                  <Icon type="repair" size={12} /> Repair the Pack Files
               </button>{' '}
               to fix missing or damaged pack files.
            </p>
            <p>
               <strong>Step 3: </strong> Then{' '}
               <button onClick={() => repairRepo('snapshots')} disabled={shouldBeInaccessible}>
                  <Icon type="repair" size={12} /> Repair the Snapshots
               </button>{' '}
               to fix the snapshots that relied on the broken pack files.
            </p>
            <p>
               <strong>Step 4: </strong> Then{' '}
               <button onClick={onOpenIntegrity} disabled={shouldBeInaccessible}>
                  <Icon type="integrity" size={12} /> Check Integrity
               </button>{' '}
               again to see if the repo is fixed.
            </p>
            <p>
               <strong>Step 5: </strong> If the issue is resolved,{' '}
               <button onClick={resumePlan} disabled={shouldBeInaccessible}>
                  <Icon type="play" size={12} /> Resume
               </button>{' '}
               the backup plan.
            </p>
         </div>
      );
   };

   const renderIndexRepairContent = () => {
      return (
         <div className={classes.repairContent}>
            <p className={classes.repairTitle}>Fixing Restic Repo with Damaged Index</p>
            <p>
               <strong>Step 1: </strong> First,{' '}
               <button onClick={pausePlan} disabled={shouldBeInaccessible}>
                  <Icon type="pause" size={12} /> Pause
               </button>{' '}
               the backup plan to prevent any new backup runs from starting.
            </p>
            <p>
               <strong>Step 2: </strong> Then{' '}
               <button onClick={() => repairRepo('index')} disabled={shouldBeInaccessible}>
                  <Icon type="repair" size={12} /> Repair the Index
               </button>{' '}
               to fix damaged index files.
            </p>
            <p>
               <strong>Step 3: </strong> Then{' '}
               <button onClick={onOpenIntegrity} disabled={shouldBeInaccessible}>
                  <Icon type="integrity" size={12} /> Check Integrity
               </button>{' '}
               again to see if the repo is fixed.
            </p>
            <p>
               <strong>Step 4: </strong> If the issue is resolved,{' '}
               <button onClick={resumePlan} disabled={shouldBeInaccessible}>
                  <Icon type="play" size={12} /> Resume
               </button>{' '}
               the backup plan.
            </p>
         </div>
      );
   };

   return (
      <SidePanel
         title="Check Backup Integrity"
         icon={'integrity'}
         // errorMessage={integrityCheckMutation.error?.message}
         close={() => onClose()}
         width="800px"
      >
         <div className={classes.repairContainer}>
            {shouldBeInaccessible && (
               <div className={classes.overlay}>
                  <Icon type="loading" size={36} />
               </div>
            )}
            {errorType === 'pack_file_error' && renderMissingPackRepairContent()}
            {errorType === 'repairable_pack_file_error' && renderPackRepairContent()}
            {errorType === 'index_error' && renderIndexRepairContent()}
            <small>
               If performing the above actions does not resolve the issue, please follow this{' '}
               <a href="https://restic.readthedocs.io/en/stable/077_troubleshooting.html" target="_blank" rel="noopener noreferrer">
                  Restic Troubleshooting Guide
               </a>
               .
            </small>
         </div>
      </SidePanel>
   );
};

export default PlanRepair;
