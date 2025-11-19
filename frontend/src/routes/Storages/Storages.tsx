import classes from './Storages.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import StorageItem from '../../components/Storage/StorageItem/StorageItem';
import TagsFilter from '../../components/common/TagsFilter/TagsFilter';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import AddStorage from '../../components/Storage/AddStorage/AddStorage';
import { useGetStorages } from '../../services/storage';
import { Storage } from '../../@types/storages';
import ItemsLayout from '../../components/common/ItemsLayout/ItemsLayout';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';

const Storages = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [storages, setStorages] = useState<Storage[]>([]);
   const [storagesLayout, setStoragesLayout] = useState<'list' | 'grid'>(() =>
      localStorage.getItem('storages_layout') === 'grid' ? 'grid' : 'list',
   );

   const { data, isLoading } = useGetStorages();
   const fetchedStorages: Storage[] = data?.result || [];
   console.log('fetchedStorages :', fetchedStorages);

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
                  <ItemsLayout onChange={(value) => setStoragesLayout(value)} type="storages" value={storagesLayout} />
               </>
            }
         />
         <div className={`${classes.storageItems} ${storagesLayout === 'grid' ? classes.storagesGrid : ''}`}>
            {storages.length > 0 && storages.map((storage) => <StorageItem key={storage.id} storage={storage} layout={storagesLayout} />)}
            {!isLoading && storages.length === 0 && (
               <div className="empty_container">
                  <p>
                     No Storages Found. <button onClick={() => setShowSidePanel(true)}>+ Add a Storage</button> to backup your content.
                  </p>
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="storage" layout={storagesLayout} count={6} />}
         {showSidePanel && <AddStorage close={() => setShowSidePanel(false)} />}
      </div>
   );
};

export default Storages;
