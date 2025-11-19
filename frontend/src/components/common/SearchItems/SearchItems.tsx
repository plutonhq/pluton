import { useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './SearchItems.module.scss';

type SearchItemsProps = {
   onSearch: (s: string) => void;
   itemName: string;
};

const SearchItems = ({ onSearch, itemName = 'Plan' }: SearchItemsProps) => {
   const [showSearchField, setShowSearchField] = useState(false);
   const [searchText, setSearchText] = useState('');
   return (
      <div className={classes.searchItems}>
         <button
            className={showSearchField ? classes.buttonActive : ''}
            data-tooltip-id="appTooltip"
            data-tooltip-content={`Search ${itemName}`}
            aria-label={`Search ${itemName}`}
            data-tooltip-place="top"
            data-tooltip-delay-show={500}
            onClick={() => {
               setShowSearchField(!showSearchField);
               if (showSearchField) {
                  onSearch('');
               }
            }}
         >
            <Icon type={showSearchField ? 'close' : 'search'} size={18} />
         </button>
         <div className={`${classes.searchBox} ${showSearchField ? classes.searchBoxShow : ''}`}>
            <input
               value={searchText}
               onChange={(e) => {
                  setSearchText(e.target.value);
                  onSearch(e.target.value);
               }}
               placeholder="Search..."
            />
         </div>
      </div>
   );
};

export default SearchItems;
