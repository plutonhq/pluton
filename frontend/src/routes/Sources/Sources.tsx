import PageHeader from '../../components/common/PageHeader/PageHeader';
import DeviceItem from '../../components/Device/DeviceItem/DeviceItem';
import DeviceActions from '../../components/Device/DeviceItem/DeviceActions';
import TagsFilter from '../../components/common/TagsFilter/TagsFilter';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import SortItems from '../../components/common/SortItems/SortItems';
import { useMemo, useState } from 'react';
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

const getAgentVersion = (device: Device) => device.versions?.agent || '';

const sortDevices = (list: Device[], sortBy: string): Device[] => {
   switch (sortBy) {
      case 'name_asc':
         return [...list].sort((a, b) => a.name.localeCompare(b.name));
      case 'name_desc':
         return [...list].sort((a, b) => b.name.localeCompare(a.name));
      case 'type_asc':
         return [...list].sort((a, b) => (a.type || '').localeCompare(b.type || ''));
      case 'type_desc':
         return [...list].sort((a, b) => (b.type || '').localeCompare(a.type || ''));
      case 'plans_asc':
         return [...list].sort((a, b) => (a.plans?.length || 0) - (b.plans?.length || 0));
      case 'plans_desc':
         return [...list].sort((a, b) => (b.plans?.length || 0) - (a.plans?.length || 0));
      case 'agent_asc':
         return [...list].sort((a, b) => getAgentVersion(a).localeCompare(getAgentVersion(b), undefined, { numeric: true }));
      case 'agent_desc':
         return [...list].sort((a, b) => getAgentVersion(b).localeCompare(getAgentVersion(a), undefined, { numeric: true }));
      default:
         return list;
   }
};

const Sources = () => {
   const [devicesLayout, setDevicesLayout] = useState<ItemsLayoutValue>(() => getSavedLayout('devices'));
   const [sortBy, setSortBy] = useState(localStorage.getItem('devices_sort') || '');
   const [tagFilter, setTagFilter] = useState('');
   const [searchTerm, setSearchTerm] = useState('');
   const itemLayout = devicesLayout === 'grid' ? 'grid' : 'list';
   const { data, isLoading } = useGetDevices();
   const [showUpgrade, setShowUpgrade] = useState(false);

   const fetchedDevices = useMemo<Device[]>(() => data?.result ?? [], [data]);

   const devices = useMemo(() => {
      let list = fetchedDevices;
      if (tagFilter) {
         list = list.filter((p) => p.tags.includes(tagFilter));
      }
      if (searchTerm) {
         list = list.filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
      }
      return sortDevices(list, sortBy);
   }, [fetchedDevices, tagFilter, searchTerm, sortBy]);

   const onTableSort = (value: string) => {
      if (value) {
         localStorage.setItem('devices_sort', value);
      } else {
         localStorage.removeItem('devices_sort');
      }
      setSortBy(value);
   };

   const allTags = useMemo(() => [...new Set(fetchedDevices.flatMap((d) => d.tags ?? []))], [fetchedDevices]);

   return (
      <div className={classes.devices}>
         <PageHeader
            title="Sources"
            icon="sources"
            buttonTitle={'+ New'}
            buttonAction={() => setShowUpgrade(true)}
            rightSection={
               <>
                  <TagsFilter tags={allTags} onSelect={setTagFilter} />
                  <SearchItems onSearch={(term) => setSearchTerm(term)} itemName="Sources" />
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
