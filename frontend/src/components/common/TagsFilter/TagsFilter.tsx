import { useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './TagsFilter.module.scss';

type TagsFilterProps = {
   tags: string[];
   onSelect: (s: string) => void;
};

const TagsFilter = ({ tags = [], onSelect }: TagsFilterProps) => {
   const [showTags, setShowTags] = useState(false);
   const [selected, setSelected] = useState('');
   return (
      <div className={classes.tagFilter}>
         <button
            className={showTags ? classes.buttonActive : ''}
            data-tooltip-id="appTooltip"
            data-tooltip-content="Filter by Tags"
            aria-label="Filter by Tags"
            data-tooltip-place="top"
            data-tooltip-delay-show={500}
            onClick={() => {
               setShowTags(!showTags);
               if (showTags) {
                  onSelect('');
                  setSelected('');
               }
            }}
         >
            <Icon type={showTags ? 'close' : 'tags'} size={18} />
         </button>
         <div className={`${classes.tagsList} ${showTags ? classes.tagsListShow : ''}`}>
            {tags.length > 0 &&
               tags.map((t, i) => (
                  <div
                     className={`${classes.tag} ${selected === t ? classes.tagActive : ''}`}
                     key={t + i}
                     onClick={() => {
                        setSelected(selected === t ? '' : t);
                        onSelect(selected === t ? '' : t);
                     }}
                  >
                     #{t}
                  </div>
               ))}
            {tags.length === 0 && <div className={classes.tag}>No tags found..</div>}
         </div>
      </div>
   );
};

export default TagsFilter;
