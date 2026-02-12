import { useState } from 'react';
import { FormField, Icon } from '../../..';
import classes from './StorageProviderSelect.module.scss';

interface StorageProviderSelectProps {
   label?: string;
   description?: string;
   full?: boolean;
   error?: string;
   customClasses?: string;
   options: { label: string; value: string; image?: JSX.Element; disabled?: boolean; doc?: string }[];
   fieldValue: string;
   onUpdate: (f: string) => void;
   disabled?: boolean;
}

const StorageProviderSelect = ({
   options,
   fieldValue,
   onUpdate,
   disabled,
   label,
   description,
   full,
   customClasses,
   error,
}: StorageProviderSelectProps) => {
   const [showDropDown, setShowDropDown] = useState(false);
   const [searchText, setSearchText] = useState('');
   const selectedItemIndex = options.length > 0 && fieldValue ? options.findIndex((x) => x.value === fieldValue) : null;
   console.log('selectedItemIndex :', selectedItemIndex);
   const selectedItem = selectedItemIndex === -1 || selectedItemIndex === null ? null : options[selectedItemIndex || 0];
   const selectedItemLabel = selectedItem && selectedItem.label ? selectedItem.label : 'Select Storage Provider..';
   const selectedItemValue = selectedItem && selectedItem.value ? selectedItem.value : '';
   const selectedItemImage = selectedItem && selectedItem.image ? selectedItem.image : '';

   const updateOption = (val: string) => {
      onUpdate(val);
      setShowDropDown(false);
   };

   const optionsItems = searchText ? options.filter((s) => s.label.toLowerCase().includes(searchText.toLowerCase())) : options;

   return (
      <FormField
         type="select"
         label={label}
         description={description}
         required={false}
         error={error}
         classes={`${classes.storageProviderSelectField} ${full ? classes.storageProviderSelectFieldFull : ''} ${customClasses}`}
      >
         <div className={`${classes.dropdown} ${showDropDown ? classes.dropdownOpen : ''} ${disabled ? classes.dropdownDisabled : ''}`}>
            {selectedItem && (
               <div className={classes.docLink}>
                  <a href={`https://docs.usepluton.com/docs/${selectedItem.doc}`} target="_blank" rel="noopener noreferrer">
                     <Icon type="link" size={12} /> {selectedItem.label} Setup Guide
                  </a>
               </div>
            )}
            <div className={classes.selected} onClick={() => setShowDropDown(!disabled ? !showDropDown : false)}>
               <span>
                  {selectedItemImage} {selectedItemLabel}
               </span>
               <button className={classes.dropBtn}>
                  <Icon type={showDropDown ? 'caret-up' : 'caret-down'} size={12} />
               </button>
            </div>
            {showDropDown && (
               <div>
                  <div className={classes.search}>
                     <Icon type="search" size={15} />
                     <input placeholder="Search Storage Providers..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                     {searchText && (
                        <button onClick={() => setSearchText('')}>
                           <Icon type="close" size={15} />
                        </button>
                     )}
                  </div>

                  <div className={`${classes.lists} styled__scrollbar`}>
                     <ul>
                        {optionsItems.length > 0 &&
                           optionsItems.map((item, indx) => {
                              return (
                                 <li
                                    key={indx}
                                    onClick={() => !item.disabled && updateOption(item.value)}
                                    className={`${item.value === selectedItemValue ? classes.selectedItem : ''} ${item.disabled ? classes.disabledItem : ''}`}
                                 >
                                    {item.image && item.image}
                                    {item.label}
                                 </li>
                              );
                           })}
                     </ul>
                     {searchText && !optionsItems && <div>No Providers Found</div>}
                  </div>
               </div>
            )}
         </div>
      </FormField>
   );
};

export default StorageProviderSelect;
