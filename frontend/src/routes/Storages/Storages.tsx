import classes from './Storages.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import StorageItem from '../../components/Storage/StorageItem/StorageItem';
import TagsFilter from '../../components/common/TagsFilter/TagsFilter';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import SortItems from '../../components/common/SortItems/SortItems';
import AddStorage from '../../components/Storage/AddStorage/AddStorage';
import { useGetStorages } from '../../services/storage';
import { Storage } from '../../@types/storages';
import ItemsLayout, { getSavedLayout, ItemsLayoutValue } from '../../components/common/ItemsLayout/ItemsLayout';
import ItemsTable from '../../components/common/ItemsTable/ItemsTable';
import Icon from '../../components/common/Icon/Icon';
import StorageFileBrowser from '../../components/Storage/StorageFileBrowser/StorageFileBrowser';
import StorageActions from '../../components/Storage/StorageItem/StorageActions';
import EditStorage from '../../components/Storage/EditStorage/EditStorage';
import storageItemClasses from '../../components/Storage/StorageItem/StorageItem.module.scss';
import tableClasses from '../../components/common/ItemsTable/ItemsTable.module.scss';
import { useComponentOverride } from '../../context/ComponentOverrideContext';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';
import { formatBytes } from '../../utils/helpers';

const Storages = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [storages, setStorages] = useState<Storage[]>([]);
   const [storagesLayout, setStoragesLayout] = useState<ItemsLayoutValue>(() => getSavedLayout('storages'));
   const [sortBy, setSortBy] = useState(localStorage.getItem('storages_sort') || '');
   const itemLayout = storagesLayout === 'grid' ? 'grid' : 'list';
   const [browseStorage, setBrowseStorage] = useState<Storage | false>(false);
   const [editStorage, setEditStorage] = useState<Storage | false>(false);
   const Browser = useComponentOverride('StorageFileBrowser', StorageFileBrowser);

   const { data, isLoading } = useGetStorages();
   const fetchedStorages: Storage[] = data?.result || [];
   console.log('fetchedStorages :', fetchedStorages);

   const sortStorages = (sortBy: string, storagesToSort?: Storage[]) => {
      const theStorages = storagesToSort && storagesToSort.length > 0 ? storagesToSort : storages;
      switch (sortBy) {
         case 'name_asc':
            setStorages([...theStorages].sort((a, b) => a.name.localeCompare(b.name)));
            break;
         case 'name_desc':
            setStorages([...theStorages].sort((a, b) => b.name.localeCompare(a.name)));
            break;
         case 'type_asc':
            setStorages([...theStorages].sort((a, b) => a.storageTypeName.localeCompare(b.storageTypeName)));
            break;
         case 'type_desc':
            setStorages([...theStorages].sort((a, b) => b.storageTypeName.localeCompare(a.storageTypeName)));
            break;
         case 'plans_asc':
            setStorages([...theStorages].sort((a, b) => (a.plans?.length || 0) - (b.plans?.length || 0)));
            break;
         case 'plans_desc':
            setStorages([...theStorages].sort((a, b) => (b.plans?.length || 0) - (a.plans?.length || 0)));
            break;
         case 'size_asc':
            setStorages([...theStorages].sort((a, b) => (a.usedSize || 0) - (b.usedSize || 0)));
            break;
         case 'size_desc':
            setStorages([...theStorages].sort((a, b) => (b.usedSize || 0) - (a.usedSize || 0)));
            break;
         case '':
            setStorages([...fetchedStorages]);
            break;
         default:
            break;
      }
   };

   const onTableSort = (value: string) => {
      if (value) {
         localStorage.setItem('storages_sort', value);
      } else {
         localStorage.removeItem('storages_sort');
      }
      setSortBy(value);
      sortStorages(value);
   };

   const allTags = useMemo(() => {
      const tags: string[] = [];
      if (storages && storages.length > 0) {
         storages.forEach((storage) => {
            storage.tags.forEach((tag) => {
               if (!tags.includes(tag)) {
                  tags.push(tag);
               }
            });
         });
      }

      return tags;
   }, [storages]);

   useEffect(() => {
      if (data?.result) {
         setStorages(data.result);
         if (sortBy) {
            sortStorages(sortBy, data.result);
         }
      }
   }, [data]);

   const filterByTags = (tag: string) => {
      if (tag) {
         setStorages(fetchedStorages.filter((p) => p.tags.includes(tag)));
      } else {
         setStorages(fetchedStorages);
      }
   };

   const searchStorages = (term: string) => {
      if (term) {
         setStorages(fetchedStorages.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())));
      } else {
         setStorages(fetchedStorages);
      }
   };

   return (
      <div className={classes.storages}>
         <PageHeader
            title="Storages"
            icon="storages"
            buttonTitle="+ New"
            buttonAction={() => setShowSidePanel(true)}
            rightSection={
               <>
                  <TagsFilter tags={allTags} onSelect={filterByTags} />
                  <SearchItems onSearch={(term) => searchStorages(term)} itemName="Storages" />
                  <SortItems
                     key={sortBy}
                     id={'storages_sort'}
                     options={[
                        { label: 'Name (A to Z)', value: 'name_asc' },
                        { label: 'Name (Z to A)', value: 'name_desc' },
                        { label: 'Type (A to Z)', value: 'type_asc' },
                        { label: 'Type (Z to A)', value: 'type_desc' },
                        { label: 'Plans (Fewest First)', value: 'plans_asc' },
                        { label: 'Plans (Most First)', value: 'plans_desc' },
                        { label: 'Used Storage (Smallest First)', value: 'size_asc' },
                        { label: 'Used Storage (Largest First)', value: 'size_desc' },
                     ]}
                     onSort={onTableSort}
                  />
                  <ItemsLayout onChange={(value) => setStoragesLayout(value)} type="storages" value={storagesLayout} />
               </>
            }
         />
         <div className={`${classes.storageItems} ${storagesLayout === 'grid' ? classes.storagesGrid : ''}`}>
            {storagesLayout === 'table' && storages.length > 0 && (
               <ItemsTable
                  sortBy={sortBy}
                  onSort={onTableSort}
                  columns={[
                     { label: 'Name', sortKey: 'name' },
                     { label: 'Type', sortKey: 'type' },
                     { label: 'Plans', sortKey: 'plans', maxWidth: 100 },
                     { label: 'Used Storage', sortKey: 'size', maxWidth: 120 },
                     { label: 'Browse', maxWidth: 100 },
                     { label: '' },
                  ]}
                  rows={storages.map((storage) => ({
                     id: storage.id,
                     cells: [
                        <div className={tableClasses.itemName}>
                           <div className={tableClasses.itemTypeIcon}>
                              <img src={`providers/${storage.type}.png`} />
                           </div>
                           <span
                              className={`${tableClasses.itemTitle} ${storage.id !== 'local' ? tableClasses.itemTitleClickable : ''}`}
                              onClick={() => storage.id !== 'local' && setEditStorage(storage)}
                           >
                              {storage.name}
                           </span>
                           {storage.settings?.description && (
                              <i data-tooltip-id="appTooltip" data-tooltip-content={storage.settings.description as string} data-tooltip-place="top">
                                 <Icon type="note" size={13} />
                              </i>
                           )}
                           {storage.id === 'local' && (
                              <i>
                                 <Icon type="lock" size={14} />
                              </i>
                           )}
                        </div>,
                        storage.storageTypeName,
                        <div className={storageItemClasses.info}>
                           <Icon type="backup" size={14} /> <i>{storage.plans?.length || 0} Plans</i>
                        </div>,
                        <div className={storageItemClasses.info}>
                           <Icon type="disk" size={14} /> <i>{formatBytes(storage.usedSize || 0)}</i>
                        </div>,
                        <button
                           className={storageItemClasses.browseBtn}
                           onClick={() => setBrowseStorage(storage)}
                           aria-label="Browse Files"
                           data-tooltip-id="appTooltip"
                           data-tooltip-content="Browse Files"
                           data-tooltip-place="top"
                        >
                           <Icon type="folder-open" size={14} />
                        </button>,
                        <StorageActions storage={storage} />,
                     ],
                  }))}
               />
            )}
            {storagesLayout !== 'table' &&
               storages.length > 0 &&
               storages.map((storage) => <StorageItem key={storage.id} storage={storage} layout={itemLayout} />)}
            {!isLoading && storages.length === 0 && (
               <div className="empty_container">
                  <p>
                     No Storages Found. <button onClick={() => setShowSidePanel(true)}>+ Add a Storage</button> to backup your content.
                  </p>
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="storage" layout={itemLayout} count={6} />}
         {browseStorage && (
            <Browser
               title={`${browseStorage.name} - File Browser`}
               storageId={browseStorage.id}
               storageType={browseStorage.type}
               defaultPath={browseStorage.defaultPath && browseStorage.defaultPath !== '/' ? browseStorage.defaultPath : undefined}
               close={() => setBrowseStorage(false)}
            />
         )}
         {editStorage && <EditStorage close={() => setEditStorage(false)} storage={editStorage} />}
         {showSidePanel && <AddStorage close={() => setShowSidePanel(false)} />}
      </div>
   );
};

export default Storages;
