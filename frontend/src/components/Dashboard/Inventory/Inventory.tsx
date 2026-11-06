import { NavLink } from 'react-router';
import DashboardWidget from '../DashboardWidget/DashboardWidget';
import Tabs, { Tab, TabList, TabPanel } from '../../common/Tabs/Tabs';
import Icon from '../../common/Icon/Icon';
import { useGetStorages } from '../../../services/storage';
import { DashboardInventorySource, DashboardSummary } from '../../../@types/dashboard';
import { Storage } from '../../../@types/storages';
import { formatBytes } from '../../../utils/helpers';
import classes from './Inventory.module.scss';

interface InventoryProps {
   inventory?: DashboardSummary['inventory'];
   isLoading?: boolean;
   availableSources: DashboardInventorySource[];
}

const Inventory = ({ inventory, isLoading, availableSources }: InventoryProps) => {
   const { data: storageData, isLoading: storagesLoading } = useGetStorages();
   const storages: Storage[] = storageData?.result || [];

   const sources: { key: DashboardInventorySource; label: string; icon: string }[] = [
      { key: 'workstations', label: 'Work Stations', icon: 'computer' },
      { key: 'servers', label: 'Servers', icon: 'server' },
      { key: 'virtualMachines', label: 'Virtual Machines', icon: 'vm' },
      { key: 'databases', label: 'Databases', icon: 'database' },
   ];

   return (
      <Tabs defaultValue="sources" variant="inline" customClasses={classes.inventoryTabs}>
         <DashboardWidget
            title="Inventory"
            icon="sources"
            headerRight={
               <TabList customClasses={classes.tabList}>
                  <Tab value="sources" label="Sources" />
                  <Tab value="storages" label="Storages" />
               </TabList>
            }
         >
            <TabPanel value="sources" customClasses={classes.panel}>
               {isLoading ? (
                  <div className={classes.loading}>
                     <Icon type="loading" size={24} />
                  </div>
               ) : (
                  <div className={classes.sources}>
                     {sources.map((source) => (
                        <div
                           key={source.key}
                           className={`${classes.source} ${availableSources.includes(source.key) ? '' : classes.sourceUnavailable}`}
                        >
                           <div className={classes.sourceCount}>
                              <Icon type={source.icon} size={22} /> {inventory?.[source.key] || 0}
                           </div>
                           <div className={classes.sourceLabel}>{source.label}</div>
                        </div>
                     ))}
                  </div>
               )}
            </TabPanel>
            <TabPanel value="storages" customClasses={classes.panel}>
               {storagesLoading ? (
                  <div className={classes.loading}>
                     <Icon type="loading" size={24} />
                  </div>
               ) : storages.length === 0 ? (
                  <div className={classes.empty}>No Storages Added Yet.</div>
               ) : (
                  <ul className={`${classes.storages} styled__scrollbar`}>
                     {storages.map((storage) => (
                        <li key={storage.id}>
                           <span className={classes.storageIcon}>
                              <img src={`/providers/${storage.type}.png`} width={22} height={22} alt={storage.type} />
                           </span>
                           <span className={classes.storageInfo}>
                              <NavLink to="/storages">{storage.name}</NavLink>
                              <span>{storage.storageTypeName || storage.type}</span>
                           </span>
                           <span className={classes.storageSize}>{formatBytes(storage.usedSize || 0)}</span>
                        </li>
                     ))}
                  </ul>
               )}
            </TabPanel>
         </DashboardWidget>
      </Tabs>
   );
};

export default Inventory;
