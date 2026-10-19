import classes from './Storages.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import { useState } from 'react';
import StorageItem from '../../components/Storage/StorageItem/StorageItem';
import { CollectionToolbar, CollectionPagination } from '../../components/common/Table/CollectionControls';
import { useCollectionPage } from '../../components/common/Table/useCollectionPage';
import { stableCollectionSort } from '../../components/common/Table/collection';
import AddStorage from '../../components/Storage/AddStorage/AddStorage';
import { useGetStorages } from '../../services/storage';
import { Storage } from '../../@types/storages';
import ItemsLayout from '../../components/common/ItemsLayout/ItemsLayout';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';

const Storages = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [search, setSearch] = useState('');
   const [tag, setTag] = useState('');
   const [sort, setSort] = useState('name_asc');
   const [storagesLayout, setStoragesLayout] = useState<'list' | 'grid'>(() =>
      localStorage.getItem('storages_layout') === 'grid' ? 'grid' : 'list',
   );

   const { data, isLoading, error } = useGetStorages();
   const fetchedStorages: Storage[] = data?.result || [];
   const allTags = [...new Set([...fetchedStorages.flatMap((storage) => storage.tags || []), ...(tag ? [tag] : [])])].sort();
   const storages = stableCollectionSort(
      fetchedStorages.filter((storage) => storage.name.toLowerCase().includes(search.trim().toLowerCase()) && (!tag || storage.tags.includes(tag))),
      (a, b) => (sort === 'name_desc' ? -1 : 1) * a.name.localeCompare(b.name),
   );
   const page = useCollectionPage(storages, JSON.stringify([search, tag, sort]));

   return (
      <div className={classes.storages}>
         <PageHeader
            title="Storages"
            icon="storages"
            buttonTitle="+ New"
            buttonAction={() => setShowSidePanel(true)}
            rightSection={
               <>
                  <ItemsLayout onChange={(value) => setStoragesLayout(value)} type="storages" value={storagesLayout} />
               </>
            }
         />
         <CollectionToolbar
            label="storages"
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={setSort}
            options={[
               { label: 'Name (A to Z)', value: 'name_asc' },
               { label: 'Name (Z to A)', value: 'name_desc' },
            ]}
         >
            <label>
               Storage tag
               <select value={tag} onChange={(event) => setTag(event.target.value)}>
                  <option value="">All tags</option>
                  {allTags.map((value) => (
                     <option key={value} value={value}>
                        {value}
                     </option>
                  ))}
               </select>
            </label>
         </CollectionToolbar>
         {error && <p role="alert">Could not load storages. {error.message}</p>}
         <div className={`${classes.storageItems} ${storagesLayout === 'grid' ? classes.storagesGrid : ''}`}>
            {!isLoading && page.items.map((storage) => <StorageItem key={storage.id} storage={storage} layout={storagesLayout} />)}
            {!isLoading && !error && storages.length === 0 && (
               <div className="empty_container">
                  <p>
                     {fetchedStorages.length ? (
                        'No storages match the current filters.'
                     ) : (
                        <>
                           No Storages Found. <button onClick={() => setShowSidePanel(true)}>+ Add a Storage</button> to backup your content.
                        </>
                     )}
                  </p>
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="storage" layout={storagesLayout} count={6} />}
         {!error && <CollectionPagination label="storages" {...page} busy={isLoading} />}
         {showSidePanel && <AddStorage close={() => setShowSidePanel(false)} />}
      </div>
   );
};

export default Storages;
