import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import classes from '../AddStorage/AddStorage.module.scss';
import Icon from '../../common/Icon/Icon';
import { useGetStorage, useUpdateStorage } from '../../../services/storage';
import SidePanel from '../../common/SidePanel/SidePanel';
import TagsInput from '../../common/form/TagsInput/TagsInput';
import { Storage, storageOptionField } from '../../../@types/storages';
import StorageSettings from '../StorageSettings/StorageSettings';
import StorageAuthSettings from '../StorageAuthSettings/StorageAuthSettings';
import { shouldDisplayStorageField } from '../../../utils/helpers';

type EditStorageProps = {
   close: () => void;
   storage: Storage;
};

const EditStorage = ({ close, storage }: EditStorageProps) => {
   const [inputError, setInputError] = useState<Record<string, string>>({});
   // const [storageTitle, setStorageTitle] = useState(() => storage.name)/;
   const [showAdvanced, setShowAdvanced] = useState(false);
   const [currentAuthType, setCurrentAuthType] = useState<string>(() => storage.authType || '');
   const [storageCredentials, setStorageCredentials] = useState<Record<string, string | number | boolean>>({});
   const [storageSettings, setStorageSettings] = useState<Record<string, string | number | boolean>>(() => storage.settings);
   const [storageTags, setStorageTags] = useState<string[]>(() => storage.tags || []);

   const updateStorageMutation = useUpdateStorage();
   const storageType = storage.type;
   const { data: storageData } = useGetStorage(storage.id);

   useEffect(() => {
      if (storageData && storageData.success && storageData.result && storageData.result.credentials) {
         setStorageCredentials(storageData.result.credentials);
      }
   }, [storageData]);

   const storageFields = useMemo(() => {
      const groupedFields = { required: [], optional: [] };
      storage.storageFields.forEach((field: storageOptionField) => {
         if (field.required) {
            (groupedFields.required as storageOptionField[]).push(field);
         } else {
            (groupedFields.optional as storageOptionField[]).push(field);
         }
      });
      return groupedFields;
   }, [storage.storageFields]);

   const authFields = useMemo(() => {
      const types: string[] = storageData?.result?.authTypes || ['client'];
      const authFields = storage.storageFields.filter((f) => f.authFieldType);

      return { fields: authFields, types };
   }, [storage.storageFields, storageData]);

   const updateStorage = () => {
      setInputError({});
      const errors: Record<string, string> = {};

      // Validate required fields that are visible AND relevant to current auth type
      const allFields = storage.storageFields;
      allFields.forEach((fieldDef) => {
         if (!fieldDef.required) return;

         // Check if this field should be displayed based on conditions
         if (!shouldDisplayStorageField(fieldDef, storageSettings, allFields)) return;

         // Check if this field is relevant to the current auth type
         const isAuthField = !!fieldDef.authFieldType;
         const isRelevantAuthField = !isAuthField || fieldDef.authFieldType === currentAuthType;
         if (!isRelevantAuthField) return;

         // Get the field value from the appropriate state object
         const fieldValue = isAuthField ? storageCredentials[fieldDef.value] : storageSettings[fieldDef.value];

         // Check if the value is empty
         const isEmpty = fieldValue === undefined || fieldValue === null || fieldValue === '';

         if (isEmpty) {
            errors[fieldDef.value] = 'Required';
         }
      });
      // if (!storageTitle) {
      //    errors['title'] = 'Required';
      // }

      console.log('errors :', errors);

      if (Object.keys(errors).length === 0) {
         const storagePayload = {
            id: storage.id,
            data: {
               // name: storageTitle,
               type: storageType,
               settings: storageSettings,
               credentials: storageCredentials,
               authType: currentAuthType,
               tags: storageTags,
            },
         };
         console.log('payload :', storagePayload);
         updateStorageMutation.mutate(storagePayload, {
            onError: (error: Error) => {
               console.log('error :', error?.message);
               toast.error(`Error Updating Storage. Changes Reverted.\nError Detail: ${error.message}`);
               setStorageCredentials(storageData.result.credentials);
               setStorageSettings(storageData.result.settings);
            },
            onSuccess: (data: any) => {
               console.log('Success :', data);
               toast.success(`Successfully Updated Storage!`, { autoClose: 5000 });
            },
         });
      } else {
         setInputError(errors);
      }
   };

   return (
      <SidePanel
         title={`Edit ${storage.name}`}
         icon={<img src={`providers/${storage.type}.png`} />}
         close={close}
         footer={
            <>
               <div className={classes.footerLeft}>
                  <div className={classes.summary}></div>
               </div>
               <div className={classes.footerRight}>
                  <button className={classes.createButton} onClick={() => updateStorage()}>
                     <Icon type="check" size={12} /> Update Storage
                  </button>
               </div>
            </>
         }
      >
         <div className={classes.addStorageContent}>
            {(updateStorageMutation.isPending || updateStorageMutation.isPending) && (
               <div className={classes.loader}>
                  <Icon size={36} type="loading" />
               </div>
            )}

            <div className={classes.field}>
               <label className={classes.label}>
                  Storage Name*
                  <i data-tooltip-id="hintTooltip" data-tooltip-content={'Storage name Cannot be changed'} data-tooltip-place="top">
                     <Icon type="help" size={13} />
                  </i>
               </label>
               {inputError['title'] && <span className={classes.fieldErrorLabel}>{inputError['title']}</span>}
               <input
                  className={classes.input}
                  type="text"
                  placeholder="Give your Storage a Name"
                  value={storage.name || ''}
                  required
                  // onChange={(e) => setStorageTitle(e.target.value)}
                  disabled={true}
               />
            </div>
            <div className={classes.field}>
               <label className={classes.label}>
                  Storage Type*{' '}
                  <i data-tooltip-id="hintTooltip" data-tooltip-content={'Storage type cannot be changed'} data-tooltip-place="top">
                     <Icon type="help" size={13} />
                  </i>
               </label>
               <div className={classes.storageType}>
                  <img src={`providers/${storage.type}.png`} />
                  {storage.storageTypeName}
               </div>
            </div>
            {storageType && authFields.fields.length > 0 && (
               <StorageAuthSettings
                  storageType={storageType}
                  fields={authFields.fields}
                  authTypes={authFields.types}
                  settings={storageCredentials}
                  onUpdate={(newSettings) => setStorageCredentials(newSettings)}
                  errors={inputError}
                  currentAuthType={currentAuthType}
                  onAuthTypeChange={setCurrentAuthType}
               />
            )}
            {Object.keys(storageFields.optional).length > 0 && (
               <div
                  className={`${classes.advancedButton} ${showAdvanced ? classes.advancedButtonActive : ''}`}
                  onClick={() => setShowAdvanced(!showAdvanced)}
               >
                  <Icon type={'settings'} />
                  <span>Advanced Options</span>
                  <Icon type={showAdvanced ? 'caret-up' : 'caret-down'} />
               </div>
            )}
            {showAdvanced && Object.keys(storageFields.optional).length > 0 && (
               <div className={classes.advancedOptions}>
                  <StorageSettings
                     fields={storageFields.optional}
                     settings={storageSettings}
                     onUpdate={(newSettings) => setStorageSettings(newSettings)}
                  />
                  <div className={classes.field}>
                     <label className={classes.label}>Tags</label>
                     <TagsInput fieldValue={storageTags} onUpdate={(val) => setStorageTags(val)} />
                  </div>
               </div>
            )}
         </div>
      </SidePanel>
   );
};
export default EditStorage;
