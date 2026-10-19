import { useState } from 'react';
import Icon from '../../common/Icon/Icon';
import { UnremovedStoragePath } from '../../../services/plans';
import classes from './UnremovedPathsNotice.module.scss';

interface UnremovedPathsNoticeProps {
   paths: UnremovedStoragePath[];
   reason?: string;
   disposition?: 'retained_intentionally' | 'cleanup_failed' | 'retained_by_request' | 'removed';
}

/**
 * Rendered inside a toast, so it outlives the plan page it was triggered from and keeps its
 * own copy state.
 */
const UnremovedPathsNotice = ({ paths, reason, disposition }: UnremovedPathsNoticeProps) => {
   const [copiedPath, setCopiedPath] = useState<string>('');

   const copyPath = (path: string) => {
      navigator.clipboard.writeText(path).then(
         () => setCopiedPath(path),
         () => setCopiedPath(''),
      );
   };

   return (
      <div className={classes.unremovedNotice}>
         <strong>Plan Removed</strong>
         {disposition === 'retained_intentionally' ? <>
            <p>Repository intentionally retained. No remote repository deletion was attempted. Its encrypted recovery credential was archived in Pluton.</p>
            <p>No cleanup is required to finish removing this plan. Keep the repository unless an operator separately verifies ownership and authorizes deletion.</p>
         </> : disposition === 'cleanup_failed' ? <>
            <p>Storage cleanup failed for the paths below; other paths may already have been removed. Plan metadata was removed.</p>
            <p>Do not repeat the deletion. Ask an operator to verify the remaining data.</p>
         </> : disposition === 'retained_by_request' ? <p>Storage data was retained as requested.</p> : <>
            {reason && <p className={classes.reason}>{reason}</p>}
            <p>Storage retention or cleanup is not confirmed by this server version. Verify the remaining paths before taking further action.</p>
         </>}
         <ul className={classes.paths}>
            {paths.map(({ storageName, storagePath }) => {
               const fullPath = `${storageName}:${storagePath}`;
               return (
                  <li key={fullPath}>
                     <span>{fullPath}</span>
                     <button type="button" onClick={() => copyPath(fullPath)} title="Copy path">
                        <Icon type={copiedPath === fullPath ? 'check' : 'copy'} size={13} />
                     </button>
                  </li>
               );
            })}
         </ul>
      </div>
   );
};

export default UnremovedPathsNotice;
