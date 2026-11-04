import { useState } from 'react';
import Icon from '../../common/Icon/Icon';
import classes from './StorageItem.module.scss';
import { Storage } from '../../../@types/storages';
import { formatBytes } from '../../../utils/helpers';
import EditStorage from '../EditStorage/EditStorage';
import StorageFileBrowser from '../StorageFileBrowser/StorageFileBrowser';
import { useComponentOverride } from '../../../context/ComponentOverrideContext';
import StorageActions from './StorageActions';

interface StorageItemProps {
   storage: Storage;
   layout: 'list' | 'grid';
}

const StorageItem = ({ storage, layout }: StorageItemProps) => {
   const [showEditModal, setShowEditModal] = useState(false);
   const [showActionModal, setShowActionModal] = useState(false);
   const [showBrowser, setShowBrowser] = useState(false);
   const { id, name, type, plans = [], usedSize = 200, storageTypeName, settings = {}, defaultPath } = storage;
   const isLocalStorage = id === 'local';
   const description = settings.description as string;
   const Browser = useComponentOverride('StorageFileBrowser', StorageFileBrowser);

   return (
      <div
         key={id}
         className={`${classes.storage} ${layout === 'grid' ? classes.storageGrid : classes.storageList} ${showEditModal || showActionModal ? classes.storageEditing : ''}`}
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
               className={classes.browseBtn}
               onClick={() => setShowBrowser(true)}
               data-tooltip-id="appTooltip"
               data-tooltip-content="Browse Files"
               data-tooltip-place="top"
            >
               <Icon type="folder-open" size={14} />
            </button>
            <StorageActions storage={storage} onModalChange={setShowActionModal} />
         </div>
         {showBrowser && (
            <Browser
               title={`${name} - File Browser`}
               storageId={id}
               storageType={type}
               defaultPath={defaultPath && defaultPath !== '/' ? defaultPath : undefined}
               close={() => setShowBrowser(false)}
            />
         )}
         {showEditModal && <EditStorage close={() => setShowEditModal(false)} storage={storage} />}
      </div>
   );
};
export default StorageItem;
