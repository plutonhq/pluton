import { useEffect, useMemo, useRef, useState } from 'react';
import classes from './StoragePicker.module.scss';
import Select from '../Select/Select';
import { useGetStorages } from '../../../../services/storage';
import Input from '../Input/Input';
import FolderPicker from '../../FolderPicker/FolderPicker';
import Icon from '../../Icon/Icon';
import AddStorage from '../../../Storage/AddStorage/AddStorage';

type storageItem = { name: string; id: string; type: string; defaultPath?: string };

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
   const hasBucketName = selectedStorage?.defaultPath && selectedStorage?.defaultPath !== '/';
   const fullPath = hasBucketName ? `${selectedStorage.defaultPath}${path ? `/${path}` : ''}` : path;

   const { data: allStorageData } = useGetStorages();
   const allUserStorages = (allStorageData?.result as storageItem[]) || [];
   const allStorages = [...allUserStorages];

   console.log('allStorages :', allStorages);
   console.log('selectedStorage :', selectedStorage);

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
         if (currentStorage?.defaultPath && currentStorage.defaultPath !== '/') {
            const prefix = currentStorage.defaultPath + '/';
            setPath((prev) => (prev.startsWith(prefix) ? prev.slice(prefix.length) : prev));
         }
      }
   }, [allStorageData]);

   useEffect(() => {
      if (selectedStorage) {
         onUpdate({ storage: selectedStorage, path: fullPath });
      }
   }, [selectedStorage, path]);

   // Reset the storage selection only when the device actually changes (not on mount/remount,
   // e.g. when navigating between steps in the Add Plan form).
   const prevDeviceIdRef = useRef<string | undefined | null>(null);
   useEffect(() => {
      if (disabled) {
         prevDeviceIdRef.current = deviceId;
         return;
      }
      if (prevDeviceIdRef.current !== null && prevDeviceIdRef.current !== deviceId) {
         setSelectedStorage(null);
         setPath('');
      }
      prevDeviceIdRef.current = deviceId;
   }, [deviceId, disabled]);

   // console.log('Storage path :', path, !disabled && isLocalStorage && !path);

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
               <div className={`${classes.path} ${hasBucketName ? classes.withBucket : ''}`}>
                  {hasBucketName && (
                     <span className={classes.defaultPath} title={`Bucket: ${selectedStorage.defaultPath}`}>
                        {selectedStorage.defaultPath + '/'}
                     </span>
                  )}
                  <Input
                     disabled={disabled}
                     fieldValue={path}
                     onUpdate={(val) => setPath(!isLocalStorage && val.startsWith('/') ? val.slice(1) : val)} //if the val starts with a slash remove it (only for remote storages, local paths need the leading slash)
                     placeholder={isLocalStorage ? 'Select a folder' : hasBucketName ? 'subfolder' : `folder-or-bucket/subfolder`}
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
