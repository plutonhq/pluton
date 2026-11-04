import { useContext, useEffect, useState } from 'react';
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

const Plans = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [plans, setPlans] = useState<Plan[]>([]);
   const [plansLayout, setPlansLayout] = useState<ItemsLayoutValue>(() => getSavedLayout('plans'));
   const [sortBy, setSortBy] = useState(localStorage.getItem('plans_sort') || '');
   const itemLayout = plansLayout === 'grid' ? 'grid' : 'list';
   const { data, isLoading } = useGetPlans();
   const { data: storageData } = useGetStorages();

   const fetchedPlans: Plan[] = data?.result || [];

   const getSourceName = (plan: Plan) =>
      plan.sourceType === 'storage'
         ? ((storageData?.result as { id: string; name: string }[]) || []).find((s) => s.id === plan.sourceId)?.name || ''
         : plan.device?.name || '';
   const getLastRun = (plan: Plan) => Date.parse(plan.lastBackupTime || '') || 0;

   const onSort = (value: string) => {
      setSortBy(value);
      sortPlans(value);
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

   useEffect(() => {
      if (data?.result) {
         setPlans(data.result);
         const sortSetting = localStorage.getItem('plans_sort');
         const filterSettingsRaw = localStorage.getItem('plans_filter');
         const filterSettings = filterSettingsRaw ? JSON.parse(filterSettingsRaw) : null;
         if (filterSettings) {
            applyFilters(filterSettings, data.result);
         }
         if (sortSetting) {
            sortPlans(sortSetting, data.result);
         }
      }
   }, [data]);

   // console.log('plans :', plans);

   const searchPlans = (term: string) => {
      if (term) {
         setPlans(fetchedPlans.filter((p) => p.title.toLowerCase().includes(term.toLowerCase())));
      } else {
         setPlans(fetchedPlans);
      }
   };

   const sortPlans = (sortBy: string, plansToSort?: Plan[]) => {
      const thePlans = plansToSort && plansToSort.length > 0 ? plansToSort : plans;
      switch (sortBy) {
         case 'title_asc':
            setPlans([...thePlans].sort((a, b) => a.title.localeCompare(b.title)));
            break;
         case 'title_desc':
            setPlans([...thePlans].sort((a, b) => b.title.localeCompare(a.title)));
            break;
         case 'created_asc':
            setPlans([...thePlans].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
            break;
         case 'created_desc':
            setPlans([...thePlans].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
            break;
         case 'size_asc':
            setPlans([...thePlans].sort((a, b) => a.stats.size - b.stats.size));
            break;
         case 'size_desc':
            setPlans([...thePlans].sort((a, b) => b.stats.size - a.stats.size));
            break;
         case 'run_frequency_asc':
            setPlans([...thePlans].sort((a, b) => getIntervalMinutes(a.settings.interval) - getIntervalMinutes(b.settings.interval)));
            break;
         case 'run_frequency_desc':
            setPlans([...thePlans].sort((a, b) => getIntervalMinutes(b.settings.interval) - getIntervalMinutes(a.settings.interval)));
            break;
         case 'source_asc':
            setPlans([...thePlans].sort((a, b) => getSourceName(a).localeCompare(getSourceName(b))));
            break;
         case 'source_desc':
            setPlans([...thePlans].sort((a, b) => getSourceName(b).localeCompare(getSourceName(a))));
            break;
         case 'storage_asc':
            setPlans([...thePlans].sort((a, b) => a.storage.name.localeCompare(b.storage.name)));
            break;
         case 'storage_desc':
            setPlans([...thePlans].sort((a, b) => b.storage.name.localeCompare(a.storage.name)));
            break;
         case 'last_run_asc':
            setPlans([...thePlans].sort((a, b) => getLastRun(a) - getLastRun(b)));
            break;
         case 'last_run_desc':
            setPlans([...thePlans].sort((a, b) => getLastRun(b) - getLastRun(a)));
            break;
         case 'health_asc':
            setPlans([...thePlans].sort((a, b) => Number(!!a.verified?.hasError) - Number(!!b.verified?.hasError)));
            break;
         case 'health_desc':
            setPlans([...thePlans].sort((a, b) => Number(!!b.verified?.hasError) - Number(!!a.verified?.hasError)));
            break;
         case '':
            setPlans([...fetchedPlans]);
            break;
         default:
            break;
      }
   };

   const applyFilters = (filter: Record<PlanFilterTypes, string[]> | null, plansToSort?: Plan[]) => {
      if (!filter) {
         setPlans(fetchedPlans);
         const sortSetting = localStorage.getItem('plans_sort');
         if (sortSetting) {
            sortPlans(sortSetting, fetchedPlans);
         }
         return;
      } else {
         let filteredPlans = plansToSort && plansToSort.length > 0 ? plansToSort : plans;

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

         setPlans(filteredPlans);
         const sortSetting = localStorage.getItem('plans_sort');
         if (sortSetting) {
            sortPlans(sortSetting, filteredPlans);
         }
      }
   };

   return (
      <div className={classes.plans}>
         <PageHeader
            title="Backup Plans"
            icon="plans"
            buttonTitle="+ New"
            buttonAction={() => setShowSidePanel(true)}
            rightSection={
               <>
                  <SearchItems onSearch={(term) => searchPlans(term)} itemName="Plans" />
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
                  <FilterPlans plans={fetchedPlans} onUpdate={(filterSettings) => applyFilters(filterSettings)} />
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
