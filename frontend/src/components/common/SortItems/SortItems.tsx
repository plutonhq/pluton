import { useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './SortItems.module.scss';
type SortItemsProps = {
   onSort: (s: string) => void;
   options: { label: string; value: string }[];
};

const SortItems = ({ options, onSort }: SortItemsProps) => {
   const [showDropDown, setshowDropDown] = useState(false);
   const [selected, setsSelected] = useState('');
   const selectedLabel = options.find((item) => item.value === selected);
   return (
      <div className={classes.sortItems}>
         <button
            className={selected ? classes.sortActive : ''}
            onClick={() => setshowDropDown(!showDropDown)}
            data-tooltip-id="appTooltip"
            data-tooltip-content="Sort"
            aria-label="Sort Plans"
            data-tooltip-place="top"
            data-tooltip-delay-show={500}
         >
            {selectedLabel && <span className={classes.sortItemLabel}>{selectedLabel.label}</span>} <Icon type="sort" size={18} />
         </button>
         {showDropDown && (
            <div className={`${classes.lists} styled__scrollbar`}>
               <ul>
                  {options.length > 0 &&
                     options.map((item, indx) => {
                        return (
                           <li
                              key={item.value + indx}
                              onClick={() => {
                                 setsSelected(item.value);
                                 onSort(item.value);
                                 setshowDropDown(false);
                              }}
                              className={`${selected && item.value === selected ? classes.selectedItem : ''}`}
                           >
                              {item.label}
                           </li>
                        );
                     })}
                  <li
                     onClick={() => {
                        setsSelected('');
                        onSort('');
                        setshowDropDown(false);
                     }}
                  >
                     Clear Sort
                  </li>
               </ul>
            </div>
         )}
      </div>
   );
};

export default SortItems;
