import { useEffect, useMemo, useState } from 'react';
import classes from './Plans.module.scss';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import PlanItem from '../../components/Plan/PlanItems/PlanItem';
import AddPlan from '../../components/Plan/AddPlan/AddPlan';
import TagsFilter from '../../components/common/TagsFilter/TagsFilter';
import SearchItems from '../../components/common/SearchItems/SearchItems';
import SortItems from '../../components/common/SortItems/SortItems';
import { useGetPlans } from '../../services/plans';
import { Plan } from '../../@types/plans';
import { useComponentOverride } from '../../context/ComponentOverrideContext';
import ItemsLayout from '../../components/common/ItemsLayout/ItemsLayout';
import SkeletonItems from '../../components/Skeleton/SkeletonItems';

const Plans = () => {
   const [showSidePanel, setShowSidePanel] = useState(false);
   const [plans, setPlans] = useState<Plan[]>([]);
   const [plansLayout, setPlansLayout] = useState<'list' | 'grid'>(() => (localStorage.getItem('plans_layout') === 'grid' ? 'grid' : 'list'));
   const { data, isLoading } = useGetPlans();
   // const data = { result: [] };
   // const isLoading = true;

   const fetchedPlans: Plan[] = data?.result || [];

   const AddPlanModal = useComponentOverride('AddPlan', AddPlan);

   useEffect(() => {
      if (data?.result) {
         setPlans(data.result);
      }
   }, [data]);

   console.log('plans :', plans);

   const allTags = useMemo(() => {
      const tags: string[] = [];
      if (plans && plans.length > 0) {
         plans.forEach((plan) => {
            plan.tags.forEach((tag) => {
               if (!tags.includes(tag)) {
                  tags.push(tag);
               }
            });
         });
      }

      return tags;
   }, [plans]);

   const filterByTags = (tag: string) => {
      if (tag) {
         setPlans(fetchedPlans.filter((p) => p.tags.includes(tag)));
      } else {
         setPlans(fetchedPlans);
      }
   };

   const searchPlans = (term: string) => {
      if (term) {
         setPlans(fetchedPlans.filter((p) => p.title.toLowerCase().includes(term.toLowerCase())));
      } else {
         setPlans(fetchedPlans);
      }
   };

   const sortPlans = (sortBy: string) => {
      switch (sortBy) {
         case 'title_asc':
            setPlans([...plans].sort((a, b) => a.title.localeCompare(b.title)));
            break;
         case 'title_desc':
            setPlans([...plans].sort((a, b) => b.title.localeCompare(a.title)));
            break;
         case 'created_asc':
            setPlans([...plans].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
            break;
         case 'created_desc':
            setPlans([...plans].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
            break;
         case '':
            setPlans([...plans]);
            break;
         default:
            break;
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
                  <TagsFilter tags={allTags} onSelect={filterByTags} />
                  <SearchItems onSearch={(term) => searchPlans(term)} itemName="Plans" />
                  <SortItems
                     options={[
                        { label: 'Title (A to Z)', value: 'title_asc' },
                        { label: 'Title (Z to A)', value: 'title_desc' },
                        { label: 'Date Created (Oldest First)', value: 'created_asc' },
                        { label: 'Date Created (Newest First)', value: 'created_desc' },
                     ]}
                     onSort={(sortBy) => sortPlans(sortBy)}
                  />
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
