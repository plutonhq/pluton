import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { getBackupProgress } from './backups';
import { getRestoreProgress } from './restores';

export type ProgressType = 'backup' | 'restore';
type ProgressPayload = { id: string; sourceId: string; sourceType: string; planId: string };

const progressConfig = {
   backup: { key: 'progress-backup', fetch: getBackupProgress, notified: new Set<string>(), toastMsg: 'Process Complete!' },
   restore: { key: 'progress-restore', fetch: getRestoreProgress, notified: new Set<string>(), toastMsg: 'Restoration Complete!' },
};

// One useQuery call for both types, so the hook order never depends on `type`.
// `poll` refetches every second until the task finishes, then notifies once.
export function useGetProgress(type: ProgressType, payload: ProgressPayload, { poll = false, enabled = true } = {}) {
   const queryClient = useQueryClient();
   const cfg = progressConfig[type];
   return useQuery({
      queryKey: [cfg.key, payload.id, payload],
      queryFn: () => cfg.fetch(payload),
      enabled,
      refetchOnMount: true,
      retry: false,
      refetchInterval: poll
         ? (query) => {
              const progressData = query.state?.data;
              const isFinished = progressData?.events?.some((event: any) => event.phase === 'finished' && event.completed === true);
              if (!isFinished) return 1000;

              if (!cfg.notified.has(payload.id)) {
                 cfg.notified.add(payload.id);
                 const planId = progressData?.planId || payload.planId;
                 if (planId) queryClient.invalidateQueries({ queryKey: ['plan', planId] });
                 toast.success(cfg.toastMsg);
              }
              return false;
           }
         : undefined,
   });
}
