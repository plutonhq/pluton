import { useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './ItemsLayout.module.scss';

type ItemsLayoutProps = {
   onChange: (value: ItemsLayoutProps['value']) => void;
   type: string;
   value: 'list' | 'grid';
};

const ItemsLayout = ({ onChange, type, value = 'list' }: ItemsLayoutProps) => {
   const [selected, setSelected] = useState<'list' | 'grid'>(value);
   const options = [
      { label: 'Grid', value: 'grid', icon: 'columns' },
      { label: 'List', value: 'list', icon: 'rows' },
   ];
   const selectedLabel = options.find((item) => item.value === selected) || options[0];

   const switchLayout = () => {
      const newValue = selected === 'list' ? 'grid' : 'list';
      setSelected(newValue);
      onChange(newValue);
      localStorage.setItem(`${type}_layout`, newValue);
   };

   return (
      <div className={classes.layoutSelector}>
         <button
            className={selected ? classes.layoutActive : ''}
            onClick={() => switchLayout()}
            data-tooltip-id="appTooltip"
            data-tooltip-content="Change layout"
            aria-label="Item Layout"
            data-tooltip-place="top"
            data-tooltip-delay-show={500}
         >
            {selectedLabel && <Icon type={selectedLabel.icon} size={18} />}
         </button>
      </div>
   );
};

export default ItemsLayout;
