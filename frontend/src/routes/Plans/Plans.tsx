import { useState } from 'react';
import { planReportedSize } from '../../utils/backupStatistics';
import classes from './Plans.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import PlanItem from '../../components/Plan/PlanItems/PlanItem';
import AddPlan from '../../components/Plan/AddPlan/AddPlan';
import { CollectionToolbar, CollectionPagination } from '../../components/common/Table/CollectionControls';
import { useCollectionPage } from '../../components/common/Table/useCollectionPage';
import { stableCollectionSort } from '../../components/common/Table/collection';
import { useGetPlans } from '../../services/plans';
import { Plan } from '../../@types/plans';
import { useComponentOverride } from '../../context/ComponentOverrideContext';
import ItemsLayout from '../../components/common/ItemsLayout/ItemsLayout';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';
import { getIntervalMinutes } from '../../utils';
import FilterPlans, { PlanFilterTypes } from '../../components/Plan/FilterPlans/FilterPlans';

const Plans = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [search, setSearch] = useState('');
   const [sort, setSort] = useState(() => localStorage.getItem('plans_sort') || '');
   const [filter, setFilter] = useState<Record<PlanFilterTypes, string[]> | null>(() => {
      try {
         const stored = JSON.parse(localStorage.getItem('plans_filter') || 'null');
         return stored && ['devices', 'methods', 'storages', 'tags'].every((key) => Array.isArray(stored[key])) ? stored : null;
      } catch {
         return null;
      }
   });
   const [plansLayout, setPlansLayout] = useState<'list' | 'grid'>(() => (localStorage.getItem('plans_layout') === 'grid' ? 'grid' : 'list'));
   const { data, isLoading, error } = useGetPlans();

   const fetchedPlans: Plan[] = data?.result || [];

   const AddPlanModal = useComponentOverride('AddPlan', AddPlan);

   const plans = fetchedPlans.filter(
      (plan) =>
         plan.title.toLowerCase().includes(search.trim().toLowerCase()) &&
         (!filter?.devices.length || (!!plan.device && filter.devices.includes(plan.device.id))) &&
         (!filter?.methods.length || filter.methods.includes(plan.sourceType === 'storage' ? 'storage-sync' : plan.method)) &&
         (!filter?.storages.length || filter.storages.includes(plan.storage.id)) &&
         (!filter?.tags.length || plan.tags.some((tag) => filter.tags.includes(tag))),
   );
   const sorted = sort
      ? stableCollectionSort(plans, (a, b) => {
           const direction = sort.endsWith('_desc') ? -1 : 1;
           if (sort.startsWith('title_')) return direction * a.title.localeCompare(b.title);
           if (sort.startsWith('created_')) return direction * (Date.parse(a.createdAt) - Date.parse(b.createdAt));
           if (sort.startsWith('size_')) return direction * ((planReportedSize(a) ?? 0) - (planReportedSize(b) ?? 0));
           if (sort.startsWith('run_frequency_'))
              return direction * (getIntervalMinutes(a.settings.interval) - getIntervalMinutes(b.settings.interval));
           return 0;
        })
      : plans;
   const page = useCollectionPage(sorted, JSON.stringify([search, sort, filter]));

   return (
      <div className={classes.plans}>
         <PageHeader
            title="Backup Plans"
            icon="plans"
            buttonTitle="+ New"
            buttonAction={() => setShowSidePanel(true)}
            rightSection={
               <>
                  <FilterPlans plans={fetchedPlans} onUpdate={setFilter} />
                  <ItemsLayout onChange={(value) => setPlansLayout(value)} type="plans" value={plansLayout} />
               </>
            }
         />
         <CollectionToolbar
            label="plans"
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={(value) => {
               setSort(value);
               localStorage.setItem('plans_sort', value);
            }}
            options={[
               { label: 'Default order', value: '' },
               { label: 'Title (A to Z)', value: 'title_asc' },
               { label: 'Title (Z to A)', value: 'title_desc' },
               { label: 'Size (Smallest First)', value: 'size_asc' },
               { label: 'Size (Largest First)', value: 'size_desc' },
               { label: 'Date Created (Oldest First)', value: 'created_asc' },
               { label: 'Date Created (Newest First)', value: 'created_desc' },
               { label: 'Run Frequency (Shortest First)', value: 'run_frequency_asc' },
               { label: 'Run Frequency (Longest First)', value: 'run_frequency_desc' },
            ]}
         />
         {error && <p role="alert">Could not load plans. {error.message}</p>}
         <div className={` ${classes.planItems} ${plansLayout === 'grid' ? classes.plansGrid : classes.plansListView}`}>
            {!isLoading && page.items.map((plan) => <PlanItem key={plan.id} plan={plan} layout={plansLayout} />)}
            {plans.length === 0 && !isLoading && !error && (
               <div className="empty_container">
                  <p>
                     {fetchedPlans.length ? (
                        'No plans match the current filters.'
                     ) : (
                        <>
                           No Plans Created Yet. <button onClick={() => setShowSidePanel(true)}>+ Add a Plan</button> to backup your content.
                        </>
                     )}
                  </p>
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="plan" layout={plansLayout} count={6} />}
         {!error && <CollectionPagination label="plans" {...page} busy={isLoading} />}
         {showSidePanel && <AddPlanModal close={() => setShowSidePanel(false)} />}
      </div>
   );
};

export default Plans;
