import PageHeader from '../../components/common/PageHeader/PageHeader';
import DeviceItem from '../../components/Device/DeviceItem/DeviceItem';
import DeviceActions from '../../components/Device/DeviceItem/DeviceActions';
import TagsFilter from '../../components/common/TagsFilter/TagsFilter';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import SortItems from '../../components/common/SortItems/SortItems';
import { useEffect, useMemo, useState } from 'react';
import { Device } from '../../@types/devices';
import { useGetDevices } from '../../services/devices';
import classes from './Sources.module.scss';
import { NavLink } from 'react-router';
import ItemsLayout, { getSavedLayout, ItemsLayoutValue } from '../../components/common/ItemsLayout/ItemsLayout';
import ItemsTable from '../../components/common/ItemsTable/ItemsTable';
import tableClasses from '../../components/common/ItemsTable/ItemsTable.module.scss';
import Icon from '../../components/common/Icon/Icon';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';
import deviceItemClasses from '../../components/Device/DeviceItem/DeviceItem.module.scss';
import Upgrade from '../../components/Upgrade/Upgrade';

type SourcesProps = {
   buttonTitle?: string;
   buttonAction?: (bool: boolean) => void;
};

const Sources = ({}: SourcesProps) => {
   const [devices, setDevices] = useState<Device[]>([]);
   const [devicesLayout, setDevicesLayout] = useState<ItemsLayoutValue>(() => getSavedLayout('devices'));
   const [sortBy, setSortBy] = useState(localStorage.getItem('devices_sort') || '');
   const itemLayout = devicesLayout === 'grid' ? 'grid' : 'list';
   const { data, isLoading } = useGetDevices();
   const fetchedDevices: Device[] = data?.result || [];
   const [showUpgrade, setShowUpgrade] = useState(false);

   useEffect(() => {
      if (data?.result) {
         setDevices(data.result);
         if (sortBy) {
            sortDevices(sortBy, data.result);
         }
      }
   }, [data]);

   const getAgentVersion = (device: Device) => device.versions?.agent || '';

   const sortDevices = (sortBy: string, devicesToSort?: Device[]) => {
      const theDevices = devicesToSort && devicesToSort.length > 0 ? devicesToSort : devices;
      switch (sortBy) {
         case 'name_asc':
            setDevices([...theDevices].sort((a, b) => a.name.localeCompare(b.name)));
            break;
         case 'name_desc':
            setDevices([...theDevices].sort((a, b) => b.name.localeCompare(a.name)));
            break;
         case 'type_asc':
            setDevices([...theDevices].sort((a, b) => (a.type || '').localeCompare(b.type || '')));
            break;
         case 'type_desc':
            setDevices([...theDevices].sort((a, b) => (b.type || '').localeCompare(a.type || '')));
            break;
         case 'plans_asc':
            setDevices([...theDevices].sort((a, b) => (a.plans?.length || 0) - (b.plans?.length || 0)));
            break;
         case 'plans_desc':
            setDevices([...theDevices].sort((a, b) => (b.plans?.length || 0) - (a.plans?.length || 0)));
            break;
         case 'agent_asc':
            setDevices([...theDevices].sort((a, b) => getAgentVersion(a).localeCompare(getAgentVersion(b), undefined, { numeric: true })));
            break;
         case 'agent_desc':
            setDevices([...theDevices].sort((a, b) => getAgentVersion(b).localeCompare(getAgentVersion(a), undefined, { numeric: true })));
            break;
         case '':
            setDevices([...fetchedDevices]);
            break;
         default:
            break;
      }
   };

   const onTableSort = (value: string) => {
      if (value) {
         localStorage.setItem('devices_sort', value);
      } else {
         localStorage.removeItem('devices_sort');
      }
      setSortBy(value);
      sortDevices(value);
   };

   const allTags = useMemo(() => {
      const tags: string[] = [];
      if (devices && devices.length > 0) {
         devices.forEach(({ tags = [] }) => {
            console.log('tags :', tags);
            if (tags && Array.isArray(tags)) {
               tags.forEach((tag) => {
                  if (!tags.includes(tag)) {
                     tags.push(tag);
                  }
               });
            }
         });
      }

      return tags;
   }, [devices]);

   const filterByTags = (tag: string) => {
      if (tag) {
         setDevices(fetchedDevices.filter((p) => p.tags.includes(tag)));
      } else {
         setDevices(fetchedDevices);
      }
   };

   const searchStorages = (term: string) => {
      if (term) {
         setDevices(fetchedDevices.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())));
      } else {
         setDevices(fetchedDevices);
      }
   };

   return (
      <div className={classes.devices}>
         <PageHeader
            title="Sources"
            icon="sources"
            buttonTitle={'+ New'}
            buttonAction={() => setShowUpgrade(true)}
            rightSection={
               <>
                  <TagsFilter tags={allTags} onSelect={filterByTags} />
                  <SearchItems onSearch={(term) => searchStorages(term)} itemName="Sources" />
                  <SortItems
                     key={sortBy}
                     id={'devices_sort'}
                     options={[
                        { label: 'Name (A to Z)', value: 'name_asc' },
                        { label: 'Name (Z to A)', value: 'name_desc' },
                        { label: 'Type (A to Z)', value: 'type_asc' },
                        { label: 'Type (Z to A)', value: 'type_desc' },
                        { label: 'Plans (Fewest First)', value: 'plans_asc' },
                        { label: 'Plans (Most First)', value: 'plans_desc' },
                        { label: 'Agent Version (Oldest First)', value: 'agent_asc' },
                        { label: 'Agent Version (Newest First)', value: 'agent_desc' },
                     ]}
                     onSort={onTableSort}
                  />
                  <ItemsLayout onChange={(value) => setDevicesLayout(value)} type="devices" value={devicesLayout} />
               </>
            }
         />
         <div
            className={`${classes.deviceItems} ${devicesLayout === 'grid' ? classes.devicesGrid : ''} ${devicesLayout === 'table' ? classes.devicesTable : ''}`}
         >
            {devicesLayout === 'table' && !isLoading && devices.length > 0 && (
               <ItemsTable
                  sortBy={sortBy}
                  onSort={onTableSort}
                  columns={[
                     { label: 'Name', sortKey: 'name' },
                     { label: 'Type', sortKey: 'type', maxWidth: 100 },
                     { label: 'Plans', sortKey: 'plans', maxWidth: 100 },
                     { label: 'Agent Version', sortKey: 'agent', maxWidth: 120 },
                     { label: '' },
                  ]}
                  rows={devices.map((device) => ({
                     id: device.id,
                     cells: [
                        <div className={tableClasses.itemName}>
                           <div className={tableClasses.itemTypeIcon} data-tooltip-id="appTooltip" data-tooltip-content={device.os || 'linux'}>
                              {device.id !== 'main' && (
                                 <span
                                    title={device.connected ? 'Connected' : 'Disconnected'}
                                    className={`${tableClasses.connectionStatus} ${device.connected ? tableClasses.connected : ''}`}
                                 />
                              )}
                              <Icon type={device.isRemote ? 'computer-remote' : 'computer'} size={20} />
                           </div>
                           <NavLink to={`/device/${device.id}`}>{device.name}</NavLink>
                           {device.id === 'main' && <span className={`label in_progress ${deviceItemClasses.mainLabel}`}>Main</span>}
                           {device.status === 'pending' && <span className={`label error ${deviceItemClasses.mainLabel}`}>Agent not Installed</span>}
                        </div>,
                        <span className={deviceItemClasses.type}>{device.type}</span>,
                        <div className={deviceItemClasses.version}>
                           <Icon type="backup" size={14} /> <i>{device.plans?.length || 0} Plans</i>
                        </div>,
                        device.id === 'main' ? (
                           '-'
                        ) : (
                           <div
                              className={`${deviceItemClasses.version} ${tableClasses.itemVersion}`}
                              data-tooltip-id="appTooltip"
                              data-tooltip-content={`Pluton Agent version: ${getAgentVersion(device) ? 'v' + getAgentVersion(device) : 'latest'}`}
                           >
                              <Icon type="logo" size={13} /> <i>{getAgentVersion(device) ? 'v' + getAgentVersion(device) : 'latest'}</i>
                           </div>
                        ),
                        <DeviceActions device={device} />,
                     ],
                  }))}
               />
            )}
            {devicesLayout !== 'table' &&
               !isLoading &&
               devices.length > 0 &&
               devices.map((device) => <DeviceItem key={device.id} device={device} layout={itemLayout} />)}
         </div>
         {isLoading && <SkeletonItems type="source" layout={itemLayout} />}
         {showUpgrade && <Upgrade focus="remote" onClose={() => setShowUpgrade(false)} />}
      </div>
   );
};

export default Sources;
