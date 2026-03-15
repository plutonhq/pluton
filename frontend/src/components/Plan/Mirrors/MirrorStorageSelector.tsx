import { useState } from 'react';
import { BackupMirror } from '../../../@types/backups';
import Icon from '../../common/Icon/Icon';
import classes from './MirrorStorageSelector.module.scss';

interface MirrorStorageSelectorProps {
   mirrors: BackupMirror[];
   primaryStorage: { id: string; type: string; name: string };
   onChange: (replicationId?: string) => void;
   selectedReplicationId?: string;
}

const MirrorStorageSelector = ({ mirrors, primaryStorage, onChange, selectedReplicationId }: MirrorStorageSelectorProps) => {
   const [selected, setSelected] = useState<string | undefined>(selectedReplicationId);
   const completedMirrors = mirrors.filter((m) => m.status === 'completed');

   return (
      <div className={classes.mirrorSelector}>
         <div className={classes.selectorContent}>
            <div
               className={classes.storageOption}
               onClick={() => {
                  setSelected(undefined);
                  onChange(undefined);
               }}
            >
               <span className={`${classes.radio} ${selected === undefined ? classes.radioSelected : ''}`}>
                  <Icon type={selected === undefined ? 'check-circle-filled' : 'check-circle'} size={16} />
               </span>
               <span className={classes.storageName}>
                  <img src={`/providers/${primaryStorage.type}.png`} />
                  {primaryStorage.name}
                  <span className={classes.storageLabel}>Primary</span>
               </span>
            </div>
            {mirrors.map((mirror) => {
               const isCompleted = mirror.status === 'completed';
               const isSelected = selected === mirror.replicationId;
               return (
                  <div
                     key={mirror.replicationId}
                     className={`${classes.storageOption} ${!isCompleted ? classes.storageDisabled : ''}`}
                     onClick={() => {
                        if (isCompleted) {
                           setSelected(mirror.replicationId);
                           onChange(mirror.replicationId);
                        }
                     }}
                  >
                     <span className={`${classes.radio} ${isSelected ? classes.radioSelected : ''}`}>
                        <Icon type={isSelected ? 'check-circle-filled' : 'check-circle'} size={16} />
                     </span>

                     <span className={classes.storageName}>
                        <img src={`/providers/${mirror.storageType}.png`} /> {mirror.storageName}
                        <span className={classes.storageLabel}>Mirror</span>
                     </span>
                     {!isCompleted && <span className={classes.statusLabel}>{mirror.status}</span>}
                  </div>
               );
            })}
            {completedMirrors.length === 0 && (
               <div className={classes.noMirrors}>No completed mirrors available. Only the primary storage can be used.</div>
            )}
         </div>
      </div>
   );
};

export default MirrorStorageSelector;
