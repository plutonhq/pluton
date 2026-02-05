import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'react-toastify';
import { useGetPlan, usePausePlan, usePerformBackup, useResumePlan } from '../services/plans';
import { Plan } from '../@types/plans';
import { Backup } from '../@types/backups';
import { RestoreSlim } from '../@types/restores';

export const usePlanSingleActions = (): {
   showDeleteModal: boolean;
   setShowDeleteModal: (show: boolean) => void;
   showEditModal: boolean;
   setShowEditModal: (show: boolean) => void;
   showPruneModal: boolean;
   setShowPruneModal: (show: boolean) => void;
   showLogsModal: boolean;
   setShowLogsModal: (show: boolean) => void;
   showUnlockModal: boolean;
   setShowUnlockModal: (show: boolean) => void;
   plan: Plan;
   isLoading: boolean;
   refetchPlan: () => void;
   sortedHistory: Backup[];
   activeBackups: Backup[];
   activeRestores: RestoreSlim[];
   lastBackupItem: Backup;
   actionInProgress: boolean;
   taskPending: boolean;
   planError: any;
   changeStatus: () => void;
   backupNow: () => void;
} => {
   const [showDeleteModal, setShowDeleteModal] = useState(false);
   const [showEditModal, setShowEditModal] = useState(false);
   const [showUnlockModal, setShowUnlockModal] = useState(false);
   const [showPruneModal, setShowPruneModal] = useState(false);
   const [showLogsModal, setShowLogsModal] = useState(false);

   const { id } = useParams();
   const navigate = useNavigate();

   const performBackupMutation = usePerformBackup();
   const pauseMutation = usePausePlan();
   const resumeMutation = useResumePlan();

   const { data, isLoading, refetch: refetchPlan, error: planError } = useGetPlan(id as string);
   const plan: Plan = data?.result || {};

   const isSync = plan.method === 'sync';

   const sortedHistory = [...(plan.backups || [])].sort((a, b) => b.started - a.started);
   const activeBackups = sortedHistory.filter((s) => s.inProgress);
   const activeRestores = (plan.restores || []).filter((s) => s.status === 'started');
   const lastBackupItem = sortedHistory[0];
   const actionInProgress = activeBackups.length > 0 || activeRestores.length > 0;
   const taskPending = pauseMutation.isPending || resumeMutation.isPending || performBackupMutation.isPending;

   const changeStatus = () => {
      if (activeBackups.length > 0) {
         return toast.error(`Can't pause a Plan while a Backup is in progress.`);
      }
      if (plan.inProgress || taskPending) {
         return;
      }
      // isActive, set it to false, else true
      // When the action is being performed, the item should grey out and stay inaccessible.
      if (plan.isActive) {
         toast.promise(pauseMutation.mutateAsync(plan.id), {
            pending: 'Pausing backup Plan...',
            success: 'Backup Plan Paused',
            error: {
               render({ data }: any) {
                  return `Failed to Pause Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         });
      } else {
         toast.promise(resumeMutation.mutateAsync(plan.id), {
            pending: 'Resuming backup Plan...',
            success: 'Backup Plan Resumed',
            error: {
               render({ data }: any) {
                  return `Failed to Resume Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         });
      }
   };

   const backupNow = () => {
      if (actionInProgress) {
         return toast.error('A Backup/Restore Process is in Progress.');
      }
      if (taskPending) {
         return;
      }

      const toastId = toast.loading(`Starting ${isSync ? 'Sync' : 'Backup'}...`);

      performBackupMutation.mutate(plan.id, {
         onSuccess: () => {
            toast.update(toastId, {
               render: `${isSync ? 'Sync' : 'Backup'} initiated successfully! 🚀`,
               type: 'success',
               isLoading: false,
               autoClose: 3000,
            });
            navigate(`/plan/${plan.id}?pendingbackup=1`);
         },
         onError: (error: any) => {
            toast.update(toastId, {
               render: `${isSync ? 'Sync' : 'Backup'} failed to start. ${error?.message || 'Unknown Error.'}`,
               type: 'error',
               isLoading: false,
               autoClose: false,
               closeButton: true,
            });
         },
      });
   };

   return {
      // State
      showDeleteModal,
      setShowDeleteModal,
      showEditModal,
      setShowEditModal,
      showPruneModal,
      setShowPruneModal,
      showLogsModal,
      setShowLogsModal,
      showUnlockModal,
      setShowUnlockModal,

      // Data
      plan,
      isLoading,
      refetchPlan,
      sortedHistory,
      activeBackups,
      activeRestores,
      lastBackupItem,
      actionInProgress,
      taskPending,
      planError,

      // Actions
      changeStatus,
      backupNow,
   };
};
