import { useMemo, useState } from 'react';
import classes from './FilterPlans.module.scss';
import { Plan } from '../../..';
import { Icon, MultiSelect } from '../..';

type FilterPlansProps = {
   onUpdate: (s: Record<PlanFilterTypes, string[]> | null) => void;
   plans: Plan[];
};
export type PlanFilterTypes = 'devices' | 'tags' | 'storages' | 'methods';

const defaultState = { devices: [], tags: [], storages: [], methods: [] };

const FilterPlans = ({ onUpdate, plans }: FilterPlansProps) => {
   const [showDropDown, setShowDropDown] = useState(false);
   const [selected, setSelected] = useState<Record<PlanFilterTypes, string[]>>(() => {
      const storedSettingsRaw = localStorage.getItem('plans_filter');
      const storedSettings = storedSettingsRaw ? JSON.parse(storedSettingsRaw) : null;
      return storedSettings || defaultState;
   });

   const hasFilters = Object.values(selected).some((arr) => arr.length > 0);

   const filterableItems = useMemo(() => {
      const items: Record<PlanFilterTypes, { label: string; value: string }[]> = { devices: [], tags: [], storages: [], methods: [] };
      plans.forEach((plan) => {
         plan.tags.forEach((tag) => {
            if (!items.tags.find((t) => t.value === tag)) {
               items.tags.push({ label: tag, value: tag });
            }
         });
         if (!items.devices.find((t) => t.value === plan.device.id)) {
            items.devices.push({ label: plan.device.name, value: plan.device.id });
         }
         if (!items.storages.find((t) => t.value === plan.storage.id)) {
            items.storages.push({ label: plan.storage.name, value: plan.storage.id });
         }
         if (!items.methods.find((t) => t.value === plan.method)) {
            items.methods.push({ label: plan.method, value: plan.method });
         }
      });
      return items;
   }, [plans]);

   return (
      <div className={classes.filterItems}>
         <button
            className={`${classes.filterBtn} ${showDropDown || hasFilters ? classes.filterBtnActive : ''}`}
            onClick={() => setShowDropDown(!showDropDown)}
            data-tooltip-id="appTooltip"
            data-tooltip-content="Filter"
            aria-label="Filter Plans"
            data-tooltip-place="top"
            data-tooltip-delay-show={500}
         >
            <Icon type="filter" size={18} />{' '}
            {hasFilters && <span className={classes.filterCount}>{Object.values(selected).reduce((acc, arr) => acc + arr.length, 0)}</span>}
         </button>
         {showDropDown && (
            <div className={`${classes.dropdown} styled__scrollbar`}>
               {filterableItems.devices.length > 1 && (
                  <div className={classes.field}>
                     <label>Devices</label>
                     <MultiSelect
                        title="Devices"
                        fieldValue={selected.devices}
                        options={filterableItems.devices}
                        onUpdate={(devices) => setSelected((selected) => ({ ...selected, devices }))}
                     />
                  </div>
               )}
               <div className={classes.field}>
                  <label>Backup Type</label>
                  <MultiSelect
                     title="Backup Type"
                     fieldValue={selected.methods}
                     options={filterableItems.methods}
                     onUpdate={(methods) => setSelected((selected) => ({ ...selected, methods }))}
                  />
               </div>
               <div className={classes.field}>
                  <label>Storage</label>
                  <MultiSelect
                     title="Storages"
                     fieldValue={selected.storages}
                     options={filterableItems.storages}
                     onUpdate={(storages) => setSelected((selected) => ({ ...selected, storages }))}
                  />
               </div>
               <div className={classes.field}>
                  <label>Tags</label>
                  <MultiSelect
                     title="Tags"
                     fieldValue={selected.tags}
                     options={filterableItems.tags}
                     onUpdate={(tags) => setSelected((selected) => ({ ...selected, tags }))}
                  />
               </div>
               <div className={classes.footer}>
                  <button
                     onClick={() => {
                        localStorage.removeItem('plans_filter');
                        setSelected(defaultState);
                        onUpdate(null);
                        setShowDropDown(false);
                     }}
                  >
                     <Icon type="reload" /> Reset
                  </button>
                  <button
                     onClick={() => {
                        localStorage.setItem('plans_filter', JSON.stringify(selected));
                        onUpdate(selected);
                        setShowDropDown(false);
                     }}
                  >
                     <Icon type="check" size={12} /> Apply
                  </button>
               </div>
            </div>
         )}
      </div>
   );
};

export default FilterPlans;
