import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon/Icon';
import classes from './PathPicker.module.scss';
import { FileManager } from '../FileManager/FileManager';
import Modal from '../Modal/Modal';
import Select from '../form/Select/Select';
import Input from '../form/Input/Input';

const excludePatternHints = [
   ['**/folder', 'Match folder in any subdirectory recursively'],
   ['*.ext', 'Match all files with specific extension'],
   ['path/to/folder/*', 'Match everything in specific folder'],
   ['path/*/folder', 'Match folder in any immediate subdirectory'],
   ['path/to/file?', 'Match single character wildcard'],
   ['[abc]', 'Match any character in brackets'],
   ['[a-z]', 'Match any character in range'],
   ['/absolute/path/*', 'Match from absolute path'],
   ['./relative/path/*', 'Match from relative path'],
];

// Include patterns are expanded by restic --files-from: full paths only, and * matches one folder level.
const includePatternHints = [
   ['/path/to/folder/*', 'Match everything in specific folder'],
   ['/path/to/*.ext', 'Match files with specific extension in a folder'],
   ['/path/*/folder', 'Match folder in any immediate subdirectory'],
   ['C:\\path\\to\\*.ext', 'Match files on Windows'],
   ['/path/to/file?', 'Match single character wildcard'],
   ['/path/[abc]', 'Match any character in brackets'],
   ['/path/[a-z]', 'Match any character in range'],
   ['**', 'Same as *. It does not match subdirectories recursively'],
];

type PathPickerProps = {
   onUpdate: (paths: { includes: string[]; excludes: string[] }) => void;
   paths: { includes: string[]; excludes: string[] };
   deviceId: string;
   single?: boolean;
   disallowChange?: boolean;
};

const PathPicker = ({ onUpdate, single = false, disallowChange = false, paths = { includes: [], excludes: [] }, deviceId }: PathPickerProps) => {
   const [showAddPicker, setShowAddPicker] = useState(false);
   const [showPatternPicker, setShowPatternPicker] = useState(false);
   const [showPicker, setShowPicker] = useState(false);
   const [showPatternHint, setShowPatternHint] = useState(false);
   const [patternInput, setPatternInput] = useState('');
   const [patternInputType, setPatternInputType] = useState<'includes' | 'excludes'>('includes');
   const [openPath, setOpenPath] = useState<string | undefined>();
   const [selectedPaths, setSelectedPaths] = useState<{ includes: string[]; excludes: string[] }>(() => paths);
   const pickerRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      const el = pickerRef.current;
      if (showPicker && el && !el.contains(document.activeElement)) {
         el.focus({ preventScroll: true });
      }
   }, [showPicker]);

   const closeOnEsc = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
         e.stopPropagation();
         setShowPicker(false);
      }
   };

   const closeOnBGClick = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (e.target === e.currentTarget) {
         setShowPicker(false);
      }
   };

   const removePath = (path: string) => {
      const updatedPaths = {
         ...selectedPaths,
         includes: selectedPaths.includes.filter((p) => p !== path),
         excludes: selectedPaths.excludes.filter((p) => p !== path && !p.startsWith(path + '/') && !p.startsWith(path + '#')),
      };
      setSelectedPaths(updatedPaths);
      onUpdate(updatedPaths);
   };

   const addPattern = () => {
      const patternPath = (patternInputType === 'includes' ? 'ip#' : 'ep#') + patternInput;
      const updatedPaths = {
         ...selectedPaths,
         [patternInputType]: [...selectedPaths[patternInputType], patternPath],
      };
      console.log('updatedPaths :', selectedPaths, updatedPaths);
      setSelectedPaths(updatedPaths);
      onUpdate(updatedPaths);
      setShowPatternPicker(false);
   };

   const addPath = (path: string) => {
      const isParentSelected = selectedPaths.includes.some((p) => path.startsWith(p + '/'));

      if (!isParentSelected) {
         // Handle inclusion of new paths
         setSelectedPaths({
            ...selectedPaths,
            includes: selectedPaths.includes.includes(path) ? selectedPaths.includes.filter((p) => p !== path) : [...selectedPaths.includes, path],
         });
      } else {
         // Handle exclusion of child paths
         setSelectedPaths({
            ...selectedPaths,
            excludes: selectedPaths.excludes.includes(path) ? selectedPaths.excludes.filter((p) => p !== path) : [...selectedPaths.excludes, path],
         });
      }
   };

   const getExcludedCount = (path: string) => {
      return selectedPaths.excludes.filter((p) => p.startsWith(path + '/')).length;
   };

   return (
      <div className={`${classes.pathPicker} ${disallowChange ? classes.disabled : ''} ${single ? classes.isSingle : ''} `}>
         <div className={classes.paths}>
            {[...paths.includes, ...paths.excludes.filter((p) => p.startsWith('ep#'))].map((p, i) => {
               const pathSlice = p.slice(0, 3);
               const isPattern = pathSlice === 'ep#' || pathSlice === 'ip#';
               const pathName = isPattern ? p.replace('ep#', '').replace('ip#', '') : p;
               return (
                  <div
                     className={classes.path}
                     key={p + i}
                     onClick={() => {
                        if (disallowChange || isPattern) return;
                        setOpenPath(p);
                        setShowPicker(true);
                     }}
                  >
                     <Icon type={isPattern ? 'pattern' : 'folders'} />

                     {pathName}
                     {getExcludedCount(p) > 0 && <span className={classes.excludeCount}>{getExcludedCount(p)} Excluded</span>}
                     {pathSlice === 'ep#' && <span className={classes.excludeCount}>Exclude</span>}
                     {!disallowChange && (
                        <button
                           onClick={(e) => {
                              e.stopPropagation();
                              removePath(p);
                           }}
                        >
                           <Icon type="close" />
                        </button>
                     )}
                  </div>
               );
            })}
            {(!single || (single && paths.includes.length === 0)) && (
               <div className={classes.pathAdd}>
                  <button type="button" title="Add Path" aria-expanded={showAddPicker} onClick={() => setShowAddPicker(!showAddPicker)}>
                     + <span>Add</span>
                  </button>
                  {showAddPicker && (
                     <div className={classes.addDropDown}>
                        <button
                           onClick={() => {
                              setOpenPath(undefined);
                              setShowPicker(true);
                              setShowAddPicker(false);
                           }}
                        >
                           <Icon type="folders" size={13} /> Add Files/Folders
                        </button>
                        <button
                           onClick={() => {
                              setOpenPath(undefined);
                              setShowPatternPicker(true);
                              setShowAddPicker(false);
                           }}
                        >
                           <Icon type="pattern" size={13} /> Add Pattern
                        </button>
                     </div>
                  )}
               </div>
            )}
         </div>
         {showPatternPicker && (
            <Modal title={`Add Source Pattern`} closeModal={() => setShowPatternPicker(false)} width="500px">
               <div className={classes.patternPickerModal}>
                  <div className={classes.patternPickerContent}>
                     <Select
                        fieldValue={patternInputType}
                        options={[
                           { label: 'Include', value: 'includes' },
                           { label: 'Exclude', value: 'excludes' },
                        ]}
                        onUpdate={(val) => setPatternInputType(val as 'includes' | 'excludes')}
                        full={true}
                     />
                     <Input fieldValue={patternInput} onUpdate={(val) => setPatternInput(val)} placeholder={patternInputType === 'includes' ? '/path/to/*.log' : '**/node_modules/**'} full={true} />
                  </div>
                  {showPatternHint && (
                     <div className={classes.patternPickerHint}>
                        <table>
                           <thead>
                              <tr>
                                 <th>Pattern</th>
                                 <th>Description</th>
                              </tr>
                           </thead>
                           <tbody>
                              {(patternInputType === 'includes' ? includePatternHints : excludePatternHints).map(([pattern, description]) => (
                                 <tr key={pattern}>
                                    <td>{pattern}</td>
                                    <td>{description}</td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  )}
                  <div className={`${classes.patternModalFooter} modalActions`}>
                     <button className={showPatternHint ? classes.hintBtnActive : ''} onClick={() => setShowPatternHint(!showPatternHint)}>
                        <Icon type="help" size={12} /> {showPatternHint ? 'Hide' : 'Show'} Pattern Hint
                     </button>
                     <div>
                        <button className="modalButton" onClick={() => setShowPatternPicker(false)}>
                           Cancel
                        </button>
                        <button className="modalButton modalButton--ok" onClick={addPattern}>
                           Add Pattern
                        </button>
                     </div>
                  </div>
               </div>
            </Modal>
         )}
         {showPicker &&
            createPortal(
               <div className={classes.pathPickerModal} onClick={closeOnBGClick} onKeyDown={closeOnEsc}>
                  <div className={classes.pathPickerModalInner} ref={pickerRef} tabIndex={-1}>
                     <div className={classes.pathPickerHeader}>
                        <h4>Choose Paths/Files to Backup</h4>
                        <button type="button" aria-label="Close" onClick={() => setShowPicker(false)}>
                           <Icon type="close" size={20} />
                        </button>
                     </div>
                     <FileManager deviceId={deviceId} onSelect={addPath} selectedPaths={selectedPaths} defaultPath={openPath || undefined} />
                     <div className={classes.pathPickerFooter}>
                        {/* <div>{`${selectedPaths.includes.length} sources Included`}</div> */}
                        <button
                           onClick={() => {
                              onUpdate(selectedPaths);
                              setShowPicker(false);
                           }}
                        >
                           <Icon type="check" size={12} /> {openPath ? `Update Sources` : 'Add Sources'}
                        </button>
                     </div>
                  </div>
               </div>,
               document.body,
            )}
      </div>
   );
};

export default PathPicker;
