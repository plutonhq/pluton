import type { ApiResponseError } from '../../../utils/httpResponse';

export default function DeleteDependencyNotice({ error }: { error?: Error | null }) {
   if (!error) return null;
   const detail = error as Partial<ApiResponseError>;
   return (
      <>
         {error.message}
         {detail.status === 409 && detail.code === 'RETAINED_DATABASE_RESTORE_DEPENDENCY' && (
            <p>
               Review retained database restores and complete their verified cleanup before removing this plan or backup.{' '}
               <a href="/database-restores">Open Database Restore Management</a>
            </p>
         )}
      </>
   );
}
