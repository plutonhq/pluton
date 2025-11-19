import { createPortal } from 'react-dom';
import Icon from '../Icon/Icon';
import { FileManager } from '../FileManager/FileManager';
import classes from './FolderPicker.module.scss';
import { useState } from 'react';

interface FolderPickerProps {
   title: string;
   selected: string;
   deviceId: string;
   footerText?: string;
   buttonText?: string;
   close: () => void;
   onSelect: (path: string) => void;
}

const FolderPicker = ({ title, selected, footerText = '', buttonText = 'Insert Path', deviceId = 'main', close, onSelect }: FolderPickerProps) => {
   const [selectedPath, setSelectedPath] = useState(selected);
   const closeOnBGClick = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (e.target === e.currentTarget) {
         close();
      }
   };

   return createPortal(
      <div className={classes.folderPickerModal} onClick={closeOnBGClick}>
         <div className={classes.folderPickerModalInner}>
            <div className={classes.folderPickerHeader}>
               <h4>{title}</h4>
               <button onClick={() => close()}>
                  <Icon type="close" size={20} />
               </button>
            </div>
            <FileManager
               deviceId={deviceId}
               onSelect={(p) => setSelectedPath(p)}
               selectionType={'directory'}
               allowMultiple={false}
               selectedPaths={{ includes: [selectedPath], excludes: [] }}
            />
            <div className={`${classes.folderPickerFooter} ${footerText ? classes.folderPickerFooterWithText : ''}`}>
               {footerText && <div>{footerText}</div>}
               <button
                  onClick={() => {
                     onSelect(selectedPath);
                     close();
                  }}
               >
                  <Icon type="check" size={12} /> {buttonText}
               </button>
            </div>
         </div>
      </div>,
      document.body,
   );
};

export default FolderPicker;
