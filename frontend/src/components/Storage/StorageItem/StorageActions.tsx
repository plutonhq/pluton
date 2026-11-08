import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Icon from '../../common/Icon/Icon';
import classes from './StorageItem.module.scss';
import { Storage } from '../../../@types/storages';
import EditStorage from '../EditStorage/EditStorage';
import Modal from '../../common/Modal/Modal';
import { useDeleteStorage, useVerifyStorage } from '../../../services/storage';
import ActionModal from '../../common/ActionModal/ActionModal';

interface StorageActionsProps {
   storage: Storage;
   onModalChange?: (isOpen: boolean) => void;
}

const StorageActions = ({ storage, onModalChange }: StorageActionsProps) => {
   const [showSettings, setShowSettings] = useState(false);
   const [showEditModal, setShowEditModal] = useState(false);
   const [showDeleteModal, setShowDeleteModal] = useState(false);
   const [showVerifyModal, setShowVerifyModal] = useState(false);
   const deleteStorageMutation = useDeleteStorage();
   const verifyStorageMutation = useVerifyStorage();
   const isLocalStorage = storage.id === 'local';

   useEffect(() => {
      onModalChange?.(showEditModal || showDeleteModal || showVerifyModal);
   }, [showEditModal, showDeleteModal, showVerifyModal, onModalChange]);

   const removeStorage = () => {
      deleteStorageMutation.mutate(storage.id, {
         onError: (error: Error) => {
            console.log('error :', error?.message);
            toast.error(error.message || `Error Removing Storage!`);
         },
         onSuccess: (data: any) => {
            console.log('Success :', data);
            toast.success(`Removed Storage Successfully!`, { autoClose: 5000 });
         },
      });
   };

   return (
      <>
         <button
            className={`${classes.moreBtn} ${showSettings ? classes.moreBtnActive : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            disabled={isLocalStorage}
         >
            <Icon type="dots-vertical" size={14} />
         </button>
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
      </>
   );
};

export default StorageActions;
