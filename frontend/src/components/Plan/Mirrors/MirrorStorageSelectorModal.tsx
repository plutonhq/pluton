import { useState } from 'react';
import { BackupMirror } from '../../../@types/backups';
import ActionModal from '../../common/ActionModal/ActionModal';
import MirrorStorageSelector from './MirrorStorageSelector';

interface MirrorStorageSelectorProps {
   mirrors: BackupMirror[];
   primaryStorage: { id: string; type: string; name: string };
   onSelect: (replicationId?: string) => void;
   onClose: () => void;
   actionLabel?: string;
}

const MirrorStorageSelectorModal = ({ mirrors, primaryStorage, onSelect, onClose, actionLabel = 'Download' }: MirrorStorageSelectorProps) => {
   const [selected, setSelected] = useState<string | undefined>(undefined);

   return (
      <ActionModal
         title={`Choose a Mirror to ${actionLabel} From`}
         message={
            <MirrorStorageSelector
               mirrors={mirrors}
               primaryStorage={primaryStorage}
               onChange={(replicationId) => replicationId && setSelected(replicationId)}
            />
         }
         closeModal={onClose}
         width="450px"
         primaryAction={{
            title: actionLabel,
            type: 'default',
            isPending: false,
            icon: 'download',
            action: () => onSelect(selected),
         }}
      />
   );
};

export default MirrorStorageSelectorModal;
