import { useState, useCallback } from 'react';
import { PlanReplicationSettings as ReplicationSettings, PlanReplicationStorage } from '../../../@types/plans';
import Icon from '../../common/Icon/Icon';
import StoragePicker from '../../common/form/StoragePicker/StoragePicker';
import Toggle from '../../common/form/Toggle/Toggle';
import classes from '../../Plan/AddPlan/AddPlan.module.scss';
import mirrorClasses from './PlanReplicationSettings.module.scss';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useDeleteReplicationStorage } from '../../../services';
import { toast } from 'react-toastify';
import { nanoid } from 'nanoid';

interface PlanReplicationSettingsProps {
   replication?: ReplicationSettings;
   primaryStorageId: string;
   primaryStoragePath?: string;
   deviceId: string;
   isEditing?: boolean;
   planID?: string;
   maxReplications?: number;
   onUpdate: (replication: ReplicationSettings) => void;
}

const defaultReplication: ReplicationSettings = {
   enabled: false,
   concurrent: false,
   storages: [],
};

const MAX_REPLICATIONS = 2;

const PlanReplicationSettings = ({
   replication,
   primaryStorageId,
   primaryStoragePath,
   deviceId,
   isEditing = false,
   planID,
   maxReplications: maxReplicationsProp,
   onUpdate,
}: PlanReplicationSettingsProps) => {
   const [tempStorages, setTempStorages] = useState<PlanReplicationStorage[]>([]);
   const [removeStorageData, setRemoveStorageData] = useState<boolean>(false);
   const [showRemoveModal, setShowRemoveModal] = useState<boolean | PlanReplicationStorage>(false);

   const deleteStorageMutation = useDeleteReplicationStorage();
   const settings = replication || defaultReplication;

   /** Check if a storage+path combination already exists in committed or temp storages */
   const isDuplicateStorage = useCallback(
      (storageId: string, storagePath: string, excludeCommittedIndex?: number, excludeTempIndex?: number) => {
         // Skip duplicate check if storageId or storagePath is empty (incomplete selection)
         if (!storageId || !storagePath) return false;
         const committedDuplicate = settings.storages.some(
            (s, i) =>
               (excludeCommittedIndex === undefined || i !== excludeCommittedIndex) && s.storageId === storageId && s.storagePath === storagePath,
         );
         const tempDuplicate = tempStorages.some(
            (s, i) => (excludeTempIndex === undefined || i !== excludeTempIndex) && s.storageId === storageId && s.storagePath === storagePath,
         );
         return committedDuplicate || tempDuplicate;
      },
      [settings.storages, tempStorages],
   );

   const updateEnabled = (enabled: boolean) => {
      onUpdate({ ...settings, enabled });
   };

   const updateConcurrent = (concurrent: boolean) => {
      onUpdate({ ...settings, concurrent });
   };

   const addReplicationStorage = () => {
      if (isEditing) {
         const maxReplications = maxReplicationsProp ?? MAX_REPLICATIONS;
         if (settings.storages.length + tempStorages.length >= maxReplications) return;
         setTempStorages([...tempStorages, { replicationId: nanoid(), storageId: '', storagePath: '', storageType: '', addedAt: Date.now() }]);
      } else {
         const maxReplications = maxReplicationsProp ?? MAX_REPLICATIONS;
         if (settings.storages.length >= maxReplications) return;
         onUpdate({
            ...settings,
            storages: [...settings.storages, { replicationId: nanoid(), storageId: '', storagePath: '', storageType: '', addedAt: Date.now() }],
         });
      }
   };

   const updateTempStorage = (index: number, storage: PlanReplicationStorage) => {
      setTempStorages((prev) => {
         const updated = [...prev];
         updated[index] = storage;
         return updated;
      });
   };

   const confirmAddStorage = (index: number) => {
      const storage = tempStorages[index];
      if (!storage.storageId) return;
      if (storage.storageId === primaryStorageId && storage.storagePath === primaryStoragePath) {
         toast.error('Cannot replicate to the same storage as the primary backup.');
         return;
      }
      if (isDuplicateStorage(storage.storageId, storage.storagePath, undefined, index)) {
         toast.error('This storage destination is already added.');
         return;
      }
      setTempStorages((prev) => prev.filter((_, i) => i !== index));
      onUpdate({ ...settings, storages: [...settings.storages, storage] });
   };

   const removeTempStorage = (index: number) => {
      setTempStorages((prev) => prev.filter((_, i) => i !== index));
   };

   const updateReplicationStorage = (index: number, storage: PlanReplicationStorage) => {
      const updated = [...settings.storages];
      updated[index] = storage;
      onUpdate({ ...settings, storages: updated });
   };

   const removeAddedStorage = (index: number) => {
      const updated = settings.storages.filter((_, i) => i !== index);
      onUpdate({ ...settings, storages: updated });
   };

   const removeReplicationStorage = () => {
      if (typeof showRemoveModal === 'object' && planID) {
         const storageToRemove = showRemoveModal;
         deleteStorageMutation.mutate(
            {
               planID: planID,
               storageID: storageToRemove.storageId,
               removeData: removeStorageData,
               storagePath: storageToRemove.storagePath,
               replicationId: storageToRemove.replicationId,
            },
            {
               onSuccess: () => {
                  // Remove the storage from local state and close modal
                  const updated = settings.storages.filter((s) => s.replicationId !== storageToRemove.replicationId);
                  onUpdate({ ...settings, storages: updated, ...(updated.length === 0 && { enabled: false }) });
                  setShowRemoveModal(false);
                  setRemoveStorageData(false);
                  deleteStorageMutation.reset();
               },
            },
         );
      }
   };

   const openRemoveModal = (mirror: PlanReplicationStorage) => {
      setRemoveStorageData(false);
      deleteStorageMutation.reset();
      setShowRemoveModal(mirror);
   };

   return (
      <div className={classes.field}>
         <div className={mirrorClasses.mirrorSection}>
            <Toggle
               label="Enable Replication"
               description="Replicate backups to additional storage destinations for redundancy (3-2-1 backup strategy)"
               fieldValue={settings.enabled}
               onUpdate={updateEnabled}
            />

            {settings.enabled && (
               <div className={mirrorClasses.mirrorSettings}>
                  {settings.storages.map((mirror, index) => (
                     <div key={mirror.addedAt || index} className={mirrorClasses.mirrorDestination}>
                        <div className={mirrorClasses.mirrorHeader}>
                           <label className={classes.label}>Replication Destination {index + 1}</label>
                           <div className={mirrorClasses.mirrorHeaderRight}>
                              {settings.storages.length > 1 && (
                                 <div className={mirrorClasses.storagePositionControls}>
                                    <button
                                       title="Move Up"
                                       disabled={index === 0}
                                       onClick={() => {
                                          const updatedStorages = [...(settings.storages || [])];
                                          const [movedStorage] = updatedStorages.splice(index, 1);
                                          updatedStorages.splice(index - 1, 0, movedStorage);
                                          onUpdate({ ...settings, storages: updatedStorages });
                                       }}
                                    >
                                       <Icon type={'caret-up'} size={14} />
                                    </button>
                                    <button
                                       title="Move Down"
                                       disabled={index === settings.storages.length - 1}
                                       onClick={() => {
                                          const updatedStorages = [...(settings.storages || [])];
                                          const [movedStorage] = updatedStorages.splice(index, 1);
                                          updatedStorages.splice(index + 1, 0, movedStorage);
                                          onUpdate({ ...settings, storages: updatedStorages });
                                       }}
                                    >
                                       <Icon type={'caret-down'} size={14} />
                                    </button>
                                 </div>
                              )}
                              <button
                                 className={mirrorClasses.removeBtn}
                                 onClick={() => (isEditing ? openRemoveModal(mirror) : removeAddedStorage(index))}
                                 title="Remove replication destination"
                              >
                                 <Icon type="trash" size={14} /> Remove
                              </button>
                           </div>
                        </div>
                        <StoragePicker
                           storagePath={mirror.storagePath}
                           storageId={mirror.storageId}
                           deviceId={deviceId}
                           disabled={isEditing}
                           onUpdate={(s) => {
                              if (s.storage.id === primaryStorageId && s.path === primaryStoragePath) {
                                 toast.error('Cannot replicate to the same storage as the primary backup.');
                                 return;
                              }
                              updateReplicationStorage(index, {
                                 replicationId: mirror.replicationId,
                                 storageId: s.storage.id,
                                 storagePath: s.path,
                                 storageType: s.storage.type,
                                 storageName: s.storage.name,
                                 addedAt: mirror.addedAt,
                              });
                           }}
                        />
                     </div>
                  ))}

                  {isEditing &&
                     tempStorages.map((tempStorage, index) => (
                        <div key={tempStorage.addedAt} className={mirrorClasses.mirrorDestination}>
                           <div className={mirrorClasses.mirrorHeader}>
                              <label className={classes.label}>Replication Destination {settings.storages.length + index + 1}</label>
                              <div className={mirrorClasses.mirrorHeaderRight}>
                                 <button
                                    className={mirrorClasses.confirmBtn}
                                    onClick={() => confirmAddStorage(index)}
                                    disabled={!tempStorage.storageId}
                                    title={!tempStorage.storageId ? 'Select Storage Type to add the storage' : 'Confirm replication destination'}
                                 >
                                    <Icon type="check" size={11} /> Confirm
                                 </button>
                                 <button
                                    className={mirrorClasses.removeBtn}
                                    onClick={() => removeTempStorage(index)}
                                    title="Remove replication destination"
                                 >
                                    <Icon type="trash" size={14} /> Remove
                                 </button>
                              </div>
                           </div>
                           <StoragePicker
                              storagePath={tempStorage.storagePath}
                              storageId={tempStorage.storageId}
                              deviceId={deviceId}
                              disabled={false}
                              onUpdate={(s) => {
                                 updateTempStorage(index, {
                                    replicationId: tempStorage.replicationId,
                                    storageId: s.storage.id,
                                    storagePath: s.path,
                                    storageType: s.storage.type,
                                    storageName: s.storage.name,
                                    addedAt: tempStorage.addedAt,
                                 });
                              }}
                           />
                        </div>
                     ))}

                  {settings.storages.length + (isEditing ? tempStorages.length : 0) < (maxReplicationsProp ?? MAX_REPLICATIONS) && (
                     <button className={mirrorClasses.addMirrorBtn} onClick={addReplicationStorage}>
                        <Icon type="plus" size={12} /> + Add Replication Destination
                     </button>
                  )}

                  {settings.storages.length > 1 && (
                     <div className={mirrorClasses.concurrentOption}>
                        <Toggle
                           label="Run replications concurrently"
                           description="Run replications in parallel to speed up the backup process"
                           fieldValue={settings.concurrent}
                           onUpdate={updateConcurrent}
                        />
                     </div>
                  )}
               </div>
            )}
         </div>

         {showRemoveModal && (
            <ActionModal
               title="Remove Replication Storage"
               message={
                  <div>
                     <p>Are you sure you want to remove this Replication storage from this plan?</p>
                     <Toggle
                        fieldValue={removeStorageData}
                        onUpdate={() => setRemoveStorageData((prev) => !prev)}
                        description={`Remove replicated data from the Storage`}
                        customClasses={classes.removeRemoteToggle}
                     />
                  </div>
               }
               closeModal={() => {
                  if (!deleteStorageMutation.isPending) {
                     setShowRemoveModal(false);
                     setRemoveStorageData(false);
                     deleteStorageMutation.reset();
                  }
               }}
               width="400px"
               errorMessage={deleteStorageMutation.isError && 'Error Removing Replication Storage!'}
               successMessage={deleteStorageMutation.isSuccess && 'Removed Replication Storage Successfully!'}
               primaryAction={{
                  title: 'Yes, Remove Storage',
                  type: 'danger',
                  icon: 'trash',
                  isPending: deleteStorageMutation.isPending,
                  action: () => removeReplicationStorage(),
               }}
            />
         )}
      </div>
   );
};

export default PlanReplicationSettings;
