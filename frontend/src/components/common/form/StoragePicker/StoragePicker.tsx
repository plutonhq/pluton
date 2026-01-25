import { useEffect, useMemo, useState } from 'react';
import classes from './StoragePicker.module.scss';
import Select from '../Select/Select';
import { useGetStorages } from '../../../../services/storage';
import Input from '../Input/Input';
import FolderPicker from '../../FolderPicker/FolderPicker';
import Icon from '../../Icon/Icon';
import AddStorage from '../../../Storage/AddStorage/AddStorage';

type storageItem = { name: string; id: string; type: string };

interface StoragePickerProps {
   storagePath?: string;
   storageId?: string;
   disabled?: boolean;
   deviceId?: string;
   onUpdate: (val: { storage: storageItem; path: string }) => void;
}

const StoragePicker = ({ onUpdate, storagePath = '', storageId, disabled = false, deviceId }: StoragePickerProps) => {
   const [selectedStorage, setSelectedStorage] = useState<null | storageItem>();
   const [showFolderPicker, setShowFolderPicker] = useState(false);
   const [showAddStorageModal, setShowAddStorageModal] = useState(false);
   const [path, setPath] = useState(() => storagePath);
   const isLocalStorage = selectedStorage?.type === 'local';

   const { data: allStorageData } = useGetStorages();
   const allUserStorages = (allStorageData?.result as storageItem[]) || [];
   const allStorages = [...allUserStorages];

   const storageOptions = useMemo(() => {
      const storageOpts = allStorages.map(({ name, id, type }) => ({
         label: name,
         value: id.toString(),
         image: <img src={`/providers/${type}.png`} />,
      }));
      return storageOpts;
   }, [allStorages]);

   const selectStorage = (storageID: string) => {
      console.log('storageID :', storageID);
      if (storageID === 'add_new') {
         return setShowAddStorageModal(true);
      }
      const theStorage = allStorages.find((s) => s.id == storageID);
      if (theStorage || storageID === 'local') {
         setSelectedStorage(theStorage);
      }
   };

   useEffect(() => {
      if (allStorages.length > 0 && storageId) {
         const currentStorage = allStorages.find((s) => s.id === storageId);
         setSelectedStorage(currentStorage);
      }
   }, [allStorageData]);

   useEffect(() => {
      if (selectedStorage) {
         onUpdate({ storage: selectedStorage, path });
      }
   }, [selectedStorage, path]);

   console.log('Storage path :', path, !disabled && isLocalStorage && !path);

   return (
      <div className={classes.storagePicker}>
         <div className={classes.storagePickerInput}>
            <div>
               <div className={classes.storage}>
                  <Select
                     fieldValue={selectedStorage?.id ? selectedStorage.id : ''}
                     options={[
                        { label: 'Select Storage', value: '', icon: 'storages' },
                        ...storageOptions,
                        { label: '+ Add New Storage', value: 'add_new', icon: 'plus' },
                     ]}
                     onUpdate={selectStorage}
                     full={true}
                     disabled={disabled}
                  />
               </div>
               <div className={classes.path}>
                  <Input
                     disabled={disabled}
                     fieldValue={path}
                     onUpdate={(val) => setPath(val)}
                     placeholder={isLocalStorage ? 'Select a folder' : `folder-or-bucket/subfolder`}
                     full={true}
                     required={!disabled && isLocalStorage}
                     error={(!disabled && isLocalStorage && !path ? 'Required' : '') as string}
                  />
                  {selectedStorage?.type && !disabled && selectedStorage.type === 'local' && (
                     <button
                        className={classes.fileManagerBtn}
                        data-tooltip-id="appTooltip"
                        data-tooltip-content="Open FileManager to Select Directory"
                        data-tooltip-place="top"
                        onClick={() => setShowFolderPicker(true)}
                     >
                        <Icon type="folders" size={16} />
                     </button>
                  )}
               </div>
            </div>
         </div>
         {showFolderPicker && !disabled && (
            <FolderPicker
               deviceId={deviceId || 'main'}
               title="Select Path"
               selected={path}
               close={() => setShowFolderPicker(false)}
               onSelect={(newVal) => setPath(newVal)}
            />
         )}
         {showAddStorageModal && <AddStorage close={() => setShowAddStorageModal(false)} />}
      </div>
   );
};

export default StoragePicker;
