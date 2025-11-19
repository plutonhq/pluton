import { ChangeEvent, KeyboardEvent, useEffect, useState } from 'react';
import classes from './TagsInput.module.scss';
import Icon from '../../Icon/Icon';
import FormField from '../FormField/FormField';

type TagsInputProps = {
   label?: string;
   description?: string;
   customClasses?: string;
   icon?: string;
   type?: string;
   inline?: boolean;
   fieldValue: string[];
   onUpdate: (f: string[]) => void;
};

const TagsInput = ({ label, description, customClasses = '', fieldValue = [], onUpdate, icon, type = 'tag', inline }: TagsInputProps) => {
   const [tags, setTags] = useState<string[]>(() => (Array.isArray(fieldValue) ? fieldValue : []));
   const [newTag, setNewTag] = useState('');

   useEffect(() => {
      if (Array.isArray(fieldValue)) {
         setTags(fieldValue);
      }
   }, [fieldValue]);

   const addTag = (tag: string) => {
      if (tag.length > 1) {
         const updated = [...tags, tag];
         setTags(updated);
         setNewTag('');
         onUpdate(updated);
      }
   };

   const removeTag = (t: string) => {
      const updatedTags = tags.filter((tag) => t !== tag);
      setTags(updatedTags);
      onUpdate(updatedTags);
   };

   const updateTag = (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.value.includes(',')) {
         const tagValue = e.target.value.replace(',', '');
         addTag(tagValue);
      } else {
         setNewTag(e.target.value);
      }
   };

   const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
         e.preventDefault();
         addTag(newTag);
      }
   };

   return (
      <FormField type={'tags'} label={label} description={description} inline={inline} classes={`${classes.tagField} ${customClasses}`}>
         <div className={classes.tagBox}>
            {tags.map((t, i) => (
               <div className={classes.tag} key={t + i}>
                  <Icon size={13} type={icon || 'tags'} /> {t}{' '}
                  <i title="Remove" onClick={() => removeTag(t)}>
                     ✖
                  </i>
               </div>
            ))}
            <div className={classes.textInput}>
               <input
                  type="text"
                  value={newTag}
                  onChange={(e) => updateTag(e)}
                  onKeyDown={handleKeyDown}
                  placeholder={`${type}${tags.length + 1}, ${type}${tags.length + 2}`}
               />
            </div>
         </div>
      </FormField>
   );
};

export default TagsInput;
