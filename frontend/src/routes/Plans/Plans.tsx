import { useContext, useMemo, useState } from 'react';
import classes from './Plans.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import PlanItem from '../../components/Plan/PlanItems/PlanItem';
import AddPlan from '../../components/Plan/AddPlan/AddPlan';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import SortItems from '../../components/common/SortItems/SortItems';
import { useGetPlans } from '../../services/plans';
import { Plan, PlanSourceDisplayResolver } from '../../@types/plans';
import { ComponentOverrideContext, useComponentOverride } from '../../context/ComponentOverrideContext';
import { NavLink } from 'react-router';
import ItemsLayout, { getSavedLayout, ItemsLayoutValue } from '../../components/common/ItemsLayout/ItemsLayout';
import ItemsTable from '../../components/common/ItemsTable/ItemsTable';
import tableClasses from '../../components/common/ItemsTable/ItemsTable.module.scss';
import Icon from '../../components/common/Icon/Icon';
import StorageIcon from '../../components/common/Icon/StorageIcon';
import PlanHistory from '../../components/Plan/PlanHistory/PlanHistory';
import PlanStorageInfo from '../../components/Plan/PlanStorageInfo/PlanStorageInfo';
import PlanActions from '../../components/Plan/PlanItems/PlanActions';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';
import { getIntervalMinutes } from '../../utils';
import { formatBytes, getBackupIconName, timeAgo } from '../../utils/helpers';
import { planIntervalName } from '../../utils/plans';
import { useGetStorages } from '../../services/storage';
import FilterPlans, { PlanFilterTypes } from '../../components/Plan/FilterPlans/FilterPlans';

// A component, not a render function: the PlanSourceDisplay resolver can call hooks.
const PlanTableSource = ({ plan }: { plan: Plan }) => {
   const resolveSourceDisplay = useContext(ComponentOverrideContext)['PlanSourceDisplay'] as unknown as PlanSourceDisplayResolver | undefined;
   const sourceDisplay = resolveSourceDisplay?.(plan);
   const { data: storageData } = useGetStorages();
   const includes = plan.sourceConfig?.includes || [];
   const sourceStorage =
      plan.sourceType === 'storage'
         ? ((storageData?.result as { id: string; name: string; type: string }[]) || []).find((s) => s.id === plan.sourceId)
         : undefined;
   return (
      <span
         className={tableClasses.itemSource}
         data-tooltip-id="htmlToolTip"
         data-tooltip-place="top"
         data-tooltip-hidden={!!sourceDisplay}
         data-tooltip-html={includes.map((p) => `<div>${p}</div>`).join('')}
      >
         {sourceDisplay ? (
            <>
               <Icon type={sourceDisplay.icon} size={13} /> {sourceDisplay.label}
            </>
         ) : sourceStorage ? (
            <>
               <StorageIcon type={sourceStorage.type} size={13} /> {sourceStorage.name}
            </>
         ) : (
            plan.device?.name && (
               <>
                  <Icon type={plan.device.id === 'main' ? 'computer' : 'computer-remote'} size={13} /> {plan.device.name}
               </>
            )
         )}
         {!sourceDisplay && <span className={tableClasses.itemCount}>{includes.length}</span>}
      </span>
   );
};

type StorageRef = { id: string; name: string };
type PlanFilter = Record<PlanFilterTypes, string[]>;

const getSourceName = (plan: Plan, storages: StorageRef[]) =>
   plan.sourceType === 'storage' ? storages.find((s) => s.id === plan.sourceId)?.name || '' : plan.device?.name || '';
const getLastRun = (plan: Plan) => Date.parse(plan.lastBackupTime || '') || 0;

const getSavedFilter = (): PlanFilter | null => {
   try {
      const filterSettingsRaw = localStorage.getItem('plans_filter');
      return filterSettingsRaw ? JSON.parse(filterSettingsRaw) : null;
   } catch {
      return null;
   }
};

const searchPlans = (plans: Plan[], term: string) =>
   term ? plans.filter((p) => p.title.toLowerCase().includes(term.toLowerCase())) : plans;

const filterPlans = (plans: Plan[], filter: PlanFilter | null) => {
   if (!filter) return plans;
   let filteredPlans = plans;
   if (filter.devices.length > 0) {
      filteredPlans = filteredPlans.filter((plan) => !!plan.device && filter.devices.includes(plan.device.id));
   }
   if (filter.methods.length > 0) {
      filteredPlans = filteredPlans.filter((plan) => filter.methods.includes(plan.sourceType === 'storage' ? 'storage-sync' : plan.method));
   }
   if (filter.storages.length > 0) {
      filteredPlans = filteredPlans.filter((plan) => filter.storages.includes(plan.storage.id));
   }
   if (filter.tags.length > 0) {
      filteredPlans = filteredPlans.filter((plan) => plan.tags.some((tag) => filter.tags.includes(tag)));
   }
   return filteredPlans;
};

const sortPlans = (plans: Plan[], sortBy: string, storages: StorageRef[]) => {
   switch (sortBy) {
      case 'title_asc':
         return [...plans].sort((a, b) => a.title.localeCompare(b.title));
      case 'title_desc':
         return [...plans].sort((a, b) => b.title.localeCompare(a.title));
      case 'created_asc':
         return [...plans].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      case 'created_desc':
         return [...plans].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      case 'size_asc':
         return [...plans].sort((a, b) => a.stats.size - b.stats.size);
      case 'size_desc':
         return [...plans].sort((a, b) => b.stats.size - a.stats.size);
      case 'run_frequency_asc':
         return [...plans].sort((a, b) => getIntervalMinutes(a.settings.interval) - getIntervalMinutes(b.settings.interval));
      case 'run_frequency_desc':
         return [...plans].sort((a, b) => getIntervalMinutes(b.settings.interval) - getIntervalMinutes(a.settings.interval));
      case 'source_asc':
         return [...plans].sort((a, b) => getSourceName(a, storages).localeCompare(getSourceName(b, storages)));
      case 'source_desc':
         return [...plans].sort((a, b) => getSourceName(b, storages).localeCompare(getSourceName(a, storages)));
      case 'storage_asc':
         return [...plans].sort((a, b) => a.storage.name.localeCompare(b.storage.name));
      case 'storage_desc':
         return [...plans].sort((a, b) => b.storage.name.localeCompare(a.storage.name));
      case 'last_run_asc':
         return [...plans].sort((a, b) => getLastRun(a) - getLastRun(b));
      case 'last_run_desc':
         return [...plans].sort((a, b) => getLastRun(b) - getLastRun(a));
      case 'health_asc':
         return [...plans].sort((a, b) => Number(!!a.verified?.hasError) - Number(!!b.verified?.hasError));
      case 'health_desc':
         return [...plans].sort((a, b) => Number(!!b.verified?.hasError) - Number(!!a.verified?.hasError));
      default:
         return plans;
   }
};

const Plans = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [plansLayout, setPlansLayout] = useState<ItemsLayoutValue>(() => getSavedLayout('plans'));
   const [sortBy, setSortBy] = useState(localStorage.getItem('plans_sort') || '');
   const [searchTerm, setSearchTerm] = useState('');
   const [filter, setFilter] = useState<PlanFilter | null>(getSavedFilter);
   const itemLayout = plansLayout === 'grid' ? 'grid' : 'list';
   const { data, isLoading } = useGetPlans();
   const { data: storageData } = useGetStorages();

   const fetchedPlans: Plan[] = useMemo(() => data?.result ?? [], [data]);

   const plans = useMemo(() => {
      const storages = (storageData?.result as StorageRef[]) || [];
      return sortPlans(filterPlans(searchPlans(fetchedPlans, searchTerm), filter), sortBy, storages);
   }, [fetchedPlans, searchTerm, filter, sortBy, storageData]);

   const onSort = (value: string) => {
      setSortBy(value);
   };

   const onTableSort = (value: string) => {
      if (value) {
         localStorage.setItem('plans_sort', value);
      } else {
         localStorage.removeItem('plans_sort');
      }
      onSort(value);
   };

   const renderPlanName = (plan: Plan) => {
      const { id, title, description, settings, inProgress, isActive, verified, method = 'backup', sourceType } = plan;
      return (
         <div className={tableClasses.itemName}>
            <span className={`${tableClasses.itemNameIcon} ${!isActive || inProgress ? tableClasses.itemNameIconDimmed : ''}`}>
               {inProgress && (
                  <span className={tableClasses.inProgressIcon}>
                     <Icon type="loading" size={14} />
                  </span>
               )}
               <Icon type={getBackupIconName(method, sourceType)} size={20} />
            </span>
            <NavLink to={`/plan/${id}`}>{title}</NavLink>
            {description && (
               <i data-tooltip-id="appTooltip" data-tooltip-content={description} data-tooltip-place="top">
                  <Icon type="note" size={13} />
               </i>
            )}
            {settings.encryption && (
               <i data-tooltip-id="appTooltip" data-tooltip-content="Encrypted" data-tooltip-place="top">
                  <Icon type="encrypted" size={14} />
               </i>
            )}
            {settings.compression && (
               <i data-tooltip-id="appTooltip" data-tooltip-content="Compressed" data-tooltip-place="top">
                  <Icon type="compressed" size={14} />
               </i>
            )}
            {!isActive && (
               <i data-tooltip-id="appTooltip" data-tooltip-content="Plan Paused" data-tooltip-place="top">
                  <Icon type="pause" size={14} />
               </i>
            )}
            {verified?.hasError && (
               <i data-tooltip-id="appTooltip" data-tooltip-content="Plan Has Error" data-tooltip-place="top">
                  <Icon size={14} type="error-circle-filled" color="#dd6b6b" />
               </i>
            )}
         </div>
      );
   };

   const AddPlanModal = useComponentOverride('AddPlan', AddPlan);

   // console.log('plans :', plans);

   return (
      <div className={classes.plans}>
         <PageHeader
            title="Backup Plans"
            icon="plans"
            buttonTitle="+ New"
            buttonAction={() => setShowSidePanel(true)}
            rightSection={
               <>
                  <SearchItems onSearch={(term) => setSearchTerm(term)} itemName="Plans" />
                  <SortItems
                     key={sortBy}
                     id={'plans_sort'}
                     options={[
                        { label: 'Title (A to Z)', value: 'title_asc' },
                        { label: 'Title (Z to A)', value: 'title_desc' },
                        { label: 'Size (Smallest First)', value: 'size_asc' },
                        { label: 'Size (Largest First)', value: 'size_desc' },
                        { label: 'Date Created (Oldest First)', value: 'created_asc' },
                        { label: 'Date Created (Newest First)', value: 'created_desc' },
                        { label: 'Run Frequency (Shortest First)', value: 'run_frequency_asc' },
                        { label: 'Run Frequency (Longest First)', value: 'run_frequency_desc' },
                     ]}
                     onSort={onSort}
                  />
                  <FilterPlans plans={fetchedPlans} onUpdate={(filterSettings) => setFilter(filterSettings)} />
                  <ItemsLayout onChange={(value) => setPlansLayout(value)} type="plans" value={plansLayout} />
               </>
            }
         />
         <div className={` ${classes.planItems} ${plansLayout === 'grid' ? classes.plansGrid : classes.plansListView}`}>
            {plansLayout === 'table' && plans.length > 0 && (
               <ItemsTable
                  sortBy={sortBy}
                  onSort={onTableSort}
                  columns={[
                     { label: 'Name', sortKey: 'title' },
                     { label: 'Source', sortKey: 'source' },
                     { label: 'Destination', sortKey: 'storage' },
                     { label: 'Size', sortKey: 'size', maxWidth: 100 },
                     { label: 'Frequency', sortKey: 'run_frequency', maxWidth: 100 },
                     { label: 'Last Run', sortKey: 'last_run', maxWidth: 100 },
                     { label: 'Health', sortKey: 'health', maxWidth: 100 },
                     { label: '' },
                  ]}
                  rows={plans.map((plan) => ({
                     id: plan.id,
                     cells: [
                        renderPlanName(plan),
                        <PlanTableSource plan={plan} />,
                        <div className={tableClasses.itemSource}>
                           <PlanStorageInfo replicationSettings={plan.settings.replication} storage={plan.storage} storagePath={plan.storagePath} />
                        </div>,
                        formatBytes(plan.stats.size),
                        planIntervalName(plan.settings.interval),
                        plan.inProgress ? 'In Progress' : plan.lastBackupTime ? timeAgo(new Date(plan.lastBackupTime)) : 'Not Yet',
                        <PlanHistory planId={plan.id} history={plan.backups || []} />,
                        <PlanActions plan={plan} />,
                     ],
                  }))}
               />
            )}
            {plansLayout !== 'table' && plans.length > 0 && plans.map((plan) => <PlanItem key={plan.id} plan={plan} layout={itemLayout} />)}
            {plans.length === 0 && !isLoading && (
               <div className="empty_container">
                  <p>
                     No Plans Created Yet. <button onClick={() => setShowSidePanel(true)}>+ Add a Plan</button> to backup your content.
                  </p>
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="plan" layout={itemLayout} count={6} />}
         {showSidePanel && <AddPlanModal close={() => setShowSidePanel(false)} />}
      </div>
   );
};

export default Plans;
