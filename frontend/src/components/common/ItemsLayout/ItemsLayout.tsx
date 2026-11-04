import { useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './ItemsLayout.module.scss';

export type ItemsLayoutValue = 'list' | 'grid' | 'table';

type ItemsLayoutProps = {
   onChange: (value: ItemsLayoutValue) => void;
   type: string;
   value: ItemsLayoutValue;
};

export const getSavedLayout = (type: string): ItemsLayoutValue => {
   const saved = localStorage.getItem(`${type}_layout`);
   return saved === 'grid' || saved === 'table' ? saved : 'list';
};

const ItemsLayout = ({ onChange, type, value = 'list' }: ItemsLayoutProps) => {
   const [selected, setSelected] = useState<ItemsLayoutValue>(value);
   const [showDropDown, setShowDropDown] = useState(false);
   const options: { label: string; value: ItemsLayoutValue; icon: string }[] = [
      { label: 'Grid', value: 'grid', icon: 'columns' },
      { label: 'List', value: 'list', icon: 'rows' },
      { label: 'Table', value: 'table', icon: 'table' },
   ];
   const selectedLabel = options.find((item) => item.value === selected) || options[0];

   const switchLayout = (newValue: ItemsLayoutValue) => {
      setSelected(newValue);
      onChange(newValue);
      localStorage.setItem(`${type}_layout`, newValue);
      setShowDropDown(false);
   };

   return (
      <div className={classes.layoutSelector}>
         <button
            className={selected ? classes.layoutActive : ''}
            onClick={() => setShowDropDown(!showDropDown)}
            data-tooltip-id="appTooltip"
            data-tooltip-content="Change layout"
            aria-label="Item Layout"
            data-tooltip-place="top"
            data-tooltip-delay-show={500}
         >
            {selectedLabel && <Icon type={selectedLabel.icon} size={18} />}
         </button>
         {showDropDown && (
            <div className={classes.lists}>
               <ul>
                  {options.map((item) => (
                     <li
                        key={item.value}
                        className={item.value === selected ? classes.selectedItem : ''}
                        onClick={() => switchLayout(item.value)}
                        title={item.label}
                        aria-label={item.label}
                     >
                        <Icon type={item.icon} size={18} />
                     </li>
                  ))}
               </ul>
            </div>
         )}
      </div>
   );
};

export default ItemsLayout;
