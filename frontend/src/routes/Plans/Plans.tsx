import { useEffect, useState } from 'react';
import classes from './Plans.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import PlanItem from '../../components/Plan/PlanItems/PlanItem';
import AddPlan from '../../components/Plan/AddPlan/AddPlan';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import SortItems from '../../components/common/SortItems/SortItems';
import { useGetPlans } from '../../services/plans';
import { Plan } from '../../@types/plans';
import { useComponentOverride } from '../../context/ComponentOverrideContext';
import ItemsLayout from '../../components/common/ItemsLayout/ItemsLayout';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';
import { getIntervalMinutes } from '../../utils';
import FilterPlans, { PlanFilterTypes } from '../../components/Plan/FilterPlans/FilterPlans';

const Plans = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [plans, setPlans] = useState<Plan[]>([]);
   const [plansLayout, setPlansLayout] = useState<'list' | 'grid'>(() => (localStorage.getItem('plans_layout') === 'grid' ? 'grid' : 'list'));
   const { data, isLoading } = useGetPlans();

   const fetchedPlans: Plan[] = data?.result || [];

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
            filteredPlans = filteredPlans.filter((plan) => filter.devices.includes(plan.device.id));
         }
         if (filter.methods.length > 0) {
            filteredPlans = filteredPlans.filter((plan) => filter.methods.includes(plan.method));
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
                     onSort={(sortBy) => sortPlans(sortBy)}
                  />
                  <FilterPlans plans={fetchedPlans} onUpdate={(filterSettings) => applyFilters(filterSettings)} />
                  <ItemsLayout onChange={(value) => setPlansLayout(value)} type="plans" value={plansLayout} />
               </>
            }
         />
         <div className={` ${classes.planItems} ${plansLayout === 'grid' ? classes.plansGrid : classes.plansListView}`}>
            {plans.length > 0 && plans.map((plan) => <PlanItem key={plan.id} plan={plan} layout={plansLayout} />)}
            {plans.length === 0 && !isLoading && (
               <div className="empty_container">
                  <p>
                     No Plans Created Yet. <button onClick={() => setShowSidePanel(true)}>+ Add a Plan</button> to backup your content.
                  </p>
               </div>
            )}
         </div>
         {isLoading && <SkeletonItems type="plan" layout={plansLayout} count={6} />}
         {showSidePanel && <AddPlanModal close={() => setShowSidePanel(false)} />}
      </div>
   );
};

export default Plans;
