import { useState } from 'react';
import { toast } from 'react-toastify';
import Icon from '../../common/Icon/Icon';
import classes from './StorageItem.module.scss';
import { Storage } from '../../../@types/storages';
import { formatBytes } from '../../../utils/helpers';
import EditStorage from '../EditStorage/EditStorage';
import Modal from '../../common/Modal/Modal';
import { useDeleteStorage, useVerifyStorage } from '../../../services/storage';
import ActionModal from '../../common/ActionModal/ActionModal';

interface StorageItemProps {
   storage: Storage;
   layout: 'list' | 'grid';
}

const StorageItem = ({ storage, layout }: StorageItemProps) => {
   const [showSettings, setShowSettings] = useState(false);
   const [showEditModal, setShowEditModal] = useState(false);
   const [showDeleteModal, setShowDeleteModal] = useState(false);
   const [showVerifyModal, setShowVerifyModal] = useState(false);
   const { id, name, type, plans = [], usedSize = 200, storageTypeName, settings = {} } = storage;
   const deleteStorageMutation = useDeleteStorage();
   const verifyStorageMutation = useVerifyStorage();
   const isLocalStorage = id === 'local';
   const description = settings.description as string;

   const removeStorage = () => {
      deleteStorageMutation.mutate(storage.id, {
         onError: (error: Error) => {
            console.log('error :', error?.message);
            toast.error(error.message || `Error Removing Storage!`);
         },
         onSuccess: (data: any) => {
            console.log('Success :', data);
            toast.success(`Removed Storage Successfully!`, { autoClose: 5000 });
            close();
         },
      });
   };

   return (
      <div
         key={id}
         className={`${classes.storage} ${layout === 'grid' ? classes.storageGrid : classes.storageList} ${showEditModal || showDeleteModal || showVerifyModal ? classes.storageEditing : ''}`}
      >
         <div className={classes.leftContent}>
            <div className={classes.storageType}>
               <img src={`providers/${type}.png`} />
            </div>

            <div className={classes.content}>
               <div className={classes.title} onClick={() => !isLocalStorage && setShowEditModal(true)}>
                  <h4>{name}</h4>
                  {description && (
                     <i className={classes.planDescription} data-tooltip-id="appTooltip" data-tooltip-content={description} data-tooltip-place="top">
                        <Icon type="note" size={13} />
                     </i>
                  )}
                  {isLocalStorage && <Icon type="lock" size={14} />}
               </div>
               <div>{storageTypeName}</div>
            </div>
         </div>
         <div className={classes.rightContent}>
            <div className={classes.info}>
               <Icon type="backup" size={14} /> <i>{plans.length} Plans</i>
            </div>
            <div className={classes.info}>
               <Icon type="disk" size={14} /> <i>{formatBytes(usedSize)}</i>
            </div>
            <button
               className={`${classes.moreBtn} ${showSettings ? classes.moreBtnActive : ''}`}
               onClick={() => setShowSettings(!showSettings)}
               disabled={isLocalStorage}
            >
               <Icon type="dots-vertical" size={14} />
            </button>
         </div>
         {showSettings && (
            <div className={classes.settings}>
               {!isLocalStorage && (
                  <>
                     <button
                        onClick={() => {
                           setShowEditModal(true);
                           setShowSettings(false);
                        }}
                     >
                        <Icon type="edit-settings" size={14} /> Edit
                     </button>
                     <button
                        onClick={() => {
                           setShowVerifyModal(true);
                           setShowSettings(false);
                           verifyStorageMutation.mutate(storage.id);
                        }}
                     >
                        <Icon type="verify" size={14} /> Verify
                     </button>
                     <button
                        onClick={() => {
                           setShowDeleteModal(true);
                           setShowSettings(false);
                        }}
                     >
                        <Icon type="trash" size={14} /> Remove
                     </button>
                  </>
               )}
            </div>
         )}
         {showEditModal && <EditStorage close={() => setShowEditModal(false)} storage={storage} />}
         {showVerifyModal && (
            <Modal
               title={`Verifying Storage "${storage.name}"`}
               closeModal={() => !verifyStorageMutation.isPending && setShowVerifyModal(false)}
               width="600px"
            >
               <div className={classes.verifyModalContent}>
                  {verifyStorageMutation.isPending && (
                     <>
                        <Icon type="loading" size={16} /> Verifying Remote Storage Connection...
                     </>
                  )}
                  {verifyStorageMutation.isSuccess && (
                     <>
                        <Icon type="check" color="teal" size={14} /> Verification Successful! This Remote Storage Connection is Working Perfectly!
                     </>
                  )}
                  {verifyStorageMutation.isError && (
                     <>
                        <Icon type="error" color="indianred" size={16} /> Error Verifying Remote Storage Connection!{' '}
                        {verifyStorageMutation.error?.toString() || ''}
                     </>
                  )}
               </div>
            </Modal>
         )}
         {showDeleteModal && (
            <ActionModal
               title={`Remove Storage`}
               message={<>{`Are you sure you want to delete this Storage?`}</>}
               closeModal={() => setShowDeleteModal(false)}
               primaryAction={{
                  title: `Yes, Remove Storage`,
                  type: 'danger',
                  icon: 'trash',
                  isPending: deleteStorageMutation.isPending,
                  action: () => removeStorage(),
               }}
            />
         )}
      </div>
   );
};
export default StorageItem;
