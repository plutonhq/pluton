import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import classes from './AddStorage.module.scss';
import Icon from '../../common/Icon/Icon';
import Select from '../../common/form/Select/Select';
import { useAddStorage, useGetAvailableStorages } from '../../../services/storage';
import SidePanel from '../../common/SidePanel/SidePanel';
import TagsInput from '../../common/form/TagsInput/TagsInput';
import { storageOptionField } from '../../../@types/storages';
import StorageSettings from '../StorageSettings/StorageSettings';
// import { useGetDevice } from '../../../services/devices';
import { shouldDisplayStorageField } from '../../../utils/helpers';
import StorageAuthSettings from '../StorageAuthSettings/StorageAuthSettings';

type AddStorageProps = {
   close: () => void;
};

const AddStorage = ({ close }: AddStorageProps) => {
   const [inputError, setInputError] = useState<Record<string, string>>({});
   const [storageTitle, setStorageTitle] = useState('');
   const [storageType, setStorageType] = useState('');
   const [currentAuthType, setCurrentAuthType] = useState<string>('');
   const [showAdvanced, setShowAdvanced] = useState(false);
   const [storageCredentials, setStorageCredentials] = useState<Record<string, string | number | boolean>>({});
   const [storageSettings, setStorageSettings] = useState<Record<string, string | number | boolean>>({});
   const [storageTags, setStorageTags] = useState<string[]>([]);
   const addStorageMutation = useAddStorage();
   const { data } = useGetAvailableStorages();
   // const { data: deviceData } = useGetDevice('main', true);
   // const mainDeviceIsServer =
   //    deviceData?.result?.os && deviceData?.result?.platform ? isServerEdition(deviceData.result.os, deviceData.result.platform) : false;
   const storageProviders = data?.result || {};

   const providersOptions = useMemo(() => {
      return Object.keys(storageProviders)
         .map((k) => ({
            label: storageProviders[k as keyof typeof storageProviders].name,
            value: k,
            image: <img src={`providers/${k}.png`} />,
         }))
         .sort((a, b) => a.label.localeCompare(b.label));
   }, [storageProviders]);

   const storageFields = useMemo(() => {
      const allFields: storageOptionField[] = storageProviders[storageType as keyof typeof storageProviders]?.settings || [];
      const groupedFields = { required: [], optional: [], authFields: { fields: [], types: [] } } as {
         required: storageOptionField[];
         optional: storageOptionField[];
         authFields: { fields: storageOptionField[]; types: string[] };
      };

      allFields.forEach((field: storageOptionField) => {
         if (field.required) {
            (groupedFields.required as storageOptionField[]).push(field);
         } else {
            if (!field.authFieldType) {
               (groupedFields.optional as storageOptionField[]).push(field);
            }
         }
      });
      const types: string[] = storageProviders[storageType as keyof typeof storageProviders]?.authTypes;
      const authFields = allFields.filter((f) => f.authFieldType);
      groupedFields.authFields = { fields: authFields, types };

      return groupedFields;
   }, [storageProviders, storageType]);

   // Initialize credentials when storage type changes
   useEffect(() => {
      if (storageType) {
         const storageCreds: Record<string, string> = {};
         storageFields.required.forEach((field: storageOptionField) => {
            storageCreds[field.value] = '';
         });
         setStorageCredentials(storageCreds);
      }
   }, [storageType, storageFields]);

   useEffect(() => {
      if (storageTitle) {
         setInputError((currentState) => {
            const data = { ...currentState };
            delete data['title'];
            return data;
         });
      }
      if (storageType) {
         setInputError((currentState) => {
            const data = { ...currentState };
            delete data['storageType'];
            return data;
         });
      }
      Object.entries(storageCredentials).forEach(([key, value]) => {
         if (value) {
            setInputError((currentState) => {
               const data = { ...currentState };
               delete data[key];
               return data;
            });
         }
      });
      console.log('storageCredentials :', storageCredentials);
   }, [storageTitle, storageType, storageCredentials]);

   const addStorage = () => {
      setInputError({});
      const errors: Record<string, string> = {};
      // Get all fields for the selected storage type
      const allFields: storageOptionField[] = storageProviders[storageType as keyof typeof storageProviders]?.settings || [];

      // Validate required fields that are visible AND relevant to current auth type
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
      if (!storageTitle) {
         errors['title'] = 'Required';
      }
      if (!storageType) {
         errors['storageType'] = 'Required';
      }
      console.log('storageType :', storageType, currentAuthType, storageCredentials);
      console.log('errors :', errors);

      if (Object.keys(errors).length === 0) {
         const storagePayload = {
            name: storageTitle,
            type: storageType,
            settings: storageSettings,
            credentials: storageCredentials,
            authType: currentAuthType,
            tags: storageTags,
         };
         console.log('payload :', storagePayload);

         addStorageMutation.mutate(storagePayload, {
            onError: (error: Error) => {
               console.log('error :', error?.message);
               toast.error(error.message || `Error Adding Storage!`);
            },
            onSuccess: (data: any) => {
               console.log('Success :', data);
               toast.success(`Successfully Added Storage!`, { autoClose: 5000 });
               close();
            },
         });
      } else {
         setInputError(errors);
      }
   };

   return (
      <SidePanel
         title="Add New Remote Storage"
         icon={<Icon type={'storages'} size={18} />}
         close={close}
         footer={
            <>
               <div className={classes.footerLeft}>
                  <div className={classes.summary}></div>
               </div>
               <div className={classes.footerRight}>
                  <button className={classes.createButton} onClick={() => addStorage()}>
                     <Icon type="check" size={12} /> Add Storage
                  </button>
               </div>
            </>
         }
      >
         <div className={classes.addStorageContent}>
            {addStorageMutation.isPending && (
               <div className={classes.loader}>
                  <Icon size={36} type="loading" />
               </div>
            )}
            <div className={classes.field}>
               <label className={classes.label}>
                  Storage Name*
                  <i data-tooltip-id="hintTooltip" data-tooltip-content={'Storage name cannot be changed in future'} data-tooltip-place="top">
                     <Icon type="help" size={13} />
                  </i>
               </label>
               {inputError['title'] && <span className={classes.fieldErrorLabel}>{inputError['title']}</span>}
               <input
                  className={`${classes.input} ${inputError['title'] ? classes.inputHasError : ''}`}
                  type="text"
                  placeholder="Give your Storage a Name"
                  value={storageTitle || ''}
                  required
                  onChange={(e) => setStorageTitle(e.target.value)}
               />
            </div>
            <div className={classes.field}>
               <label className={classes.label}>Storage Type*</label>
               {inputError['storageType'] && <span className={classes.fieldErrorLabel}>{inputError['storageType']}</span>}
               <div className={classes.selectField}>
                  <Select
                     options={[{ label: 'Select Storage Type', value: '' }, ...providersOptions]}
                     fieldValue={storageType}
                     onUpdate={(val: string) => {
                        setStorageCredentials({});
                        setStorageSettings({});
                        setStorageType(val);
                        const fields = storageProviders[val as keyof typeof storageProviders]?.fields || [];
                        const newCredentials = fields.reduce(
                           (acc: any, field: { value: any }) => ({
                              ...acc,
                              [field.value]: '',
                           }),
                           {},
                        );
                        setStorageCredentials(newCredentials);
                     }}
                     size="large"
                     full={true}
                     search={true}
                     error={inputError['storageType']}
                  />
               </div>
            </div>

            {storageType && storageFields.authFields.fields.length > 0 && (
               <StorageAuthSettings
                  storageType={storageType}
                  fields={storageFields.authFields.fields}
                  authTypes={storageFields.authFields.types}
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
export default AddStorage;
