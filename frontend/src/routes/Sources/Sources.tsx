import PageHeader from '../../components/common/PageHeader/PageHeader';
import DeviceItem from '../../components/Device/DeviceItem/DeviceItem';
import { CollectionToolbar, CollectionPagination } from '../../components/common/Table/CollectionControls';
import { useCollectionPage } from '../../components/common/Table/useCollectionPage';
import { stableCollectionSort } from '../../components/common/Table/collection';
import { useState } from 'react';
import { Device } from '../../@types/devices';
import { useGetDevices } from '../../services/devices';
import classes from './Sources.module.scss';
import ItemsLayout from '../../components/common/ItemsLayout/ItemsLayout';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';
import deviceItemClasses from '../../components/Device/DeviceItem/DeviceItem.module.scss';
import AgentEnrollmentModal from '../../components/Device/AgentEnrollment/AgentEnrollment';

type SourcesProps = {
   buttonTitle?: string;
   buttonAction?: (bool: boolean) => void;
};

const Sources = ({ buttonTitle, buttonAction }: SourcesProps) => {
   const [search, setSearch] = useState('');
   const [tag, setTag] = useState('');
   const [sort, setSort] = useState('name_asc');
   const [devicesLayout, setDevicesLayout] = useState<'list' | 'grid'>(() => (localStorage.getItem('devices_layout') === 'grid' ? 'grid' : 'list'));
   const { data, isLoading, error } = useGetDevices({ refetchInterval: 15000 });
   const fetchedDevices: Device[] = data?.result || [];
   const [showEnrollment, setShowEnrollment] = useState(false);

   const allTags = [...new Set([...fetchedDevices.flatMap((device) => device.tags || []), ...(tag ? [tag] : [])])].sort();
   const devices = stableCollectionSort(
      fetchedDevices.filter((device) => device.name.toLowerCase().includes(search.trim().toLowerCase()) && (!tag || device.tags?.includes(tag))),
      (a, b) => (sort === 'name_desc' ? -1 : 1) * a.name.localeCompare(b.name),
   );
   const page = useCollectionPage(devices, JSON.stringify([search, tag, sort]));

   return (
      <div className={classes.devices}>
         <PageHeader
            title="Sources"
            icon="sources"
            buttonTitle={buttonTitle}
            buttonAction={buttonAction}
            rightSection={
               <>
                  <ItemsLayout onChange={(value) => setDevicesLayout(value)} type="devices" value={devicesLayout} />
               </>
            }
         />
         <CollectionToolbar
            label="sources"
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
               Source tag
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
         {error && <p role="alert">Could not load sources. {error.message}</p>}
         {!isLoading && !error && !devices.length && <p>{fetchedDevices.length ? 'No sources match the current filters.' : 'No sources found.'}</p>}
         <div className={`${classes.deviceItems} ${devicesLayout === 'grid' ? classes.devicesGrid : ''}`}>
            {!isLoading && page.items.map((device) => <DeviceItem key={device.id} device={device} layout={devicesLayout} />)}
            {!isLoading && (
               <div className={`${deviceItemClasses.device} ${classes.deviceUpgrade}`} onClick={() => setShowEnrollment(true)}>
                  + Add Remote Machine
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="source" layout={devicesLayout} />}
         {!error && <CollectionPagination label="sources" {...page} busy={isLoading} />}
         {showEnrollment && <AgentEnrollmentModal close={() => setShowEnrollment(false)} />}
      </div>
   );
};

export default Sources;
