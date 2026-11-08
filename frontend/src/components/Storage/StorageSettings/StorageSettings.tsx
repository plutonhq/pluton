import { useState } from 'react';
import Input from '../../common/form/Input/Input';
import Tristate from '../../common/form/Tristate/Tristate';
import SizePicker from '../../common/form/SizePicker/SizePicker';
import Toggle from '../../common/form/Toggle/Toggle';
import { storageOptionField } from '../../../@types/storages';
import classes from './StorageSettings.module.scss';
import NumberInput from '../../common/form/NumberInput/NumberInput';
import Select from '../../common/form/Select/Select';
import { shouldDisplayStorageField } from '../../../utils/helpers';
import PasswordField from '../../common/form/PasswordField/PasswordField';

type StorageSettingsProps = {
   fields: storageOptionField[];
   settings: Record<string, string | number | boolean>;
   errors?: Record<string, string>;
   onUpdate: (newSettings: StorageSettingsProps['settings']) => void;
};

const StorageSettings = ({ fields, onUpdate, settings, errors = {} }: StorageSettingsProps) => {
   // Only the user's choices. Fields without a choice fall back to the saved setting.
   const [customFieldsActive, setCustomFieldsActive] = useState<Record<string, boolean>>({});
   const isCustomActive = (field: storageOptionField) =>
      !!field.allowCustom && (customFieldsActive[field.value] ?? settings[field.value] === 'custom');

   return (
      <>
         {fields.map((field) => {
            // Skip rendering if conditions aren't met
            if (!shouldDisplayStorageField(field, settings, fields)) {
               return null;
            }
            const hint = field.description + '\n' + (field.default ? `Default: ${field.default}` : '');
            const fieldLabel = field.label + (field.required ? '*' : '');
            if (field.fieldType === 'bool') {
               return (
                  <div key={field.value} className={classes.field}>
                     <Toggle
                        label={fieldLabel}
                        inline={true}
                        hint={hint}
                        fieldValue={(settings[field.value] as boolean) || false}
                        onUpdate={(newVal: boolean) => onUpdate({ ...settings, [field.value]: newVal })}
                        error={errors[field.value] || ''}
                     />
                  </div>
               );
            }
            if (field.fieldType === 'password') {
               return (
                  <div key={field.value} className={classes.field}>
                     <PasswordField
                        label={fieldLabel}
                        inline={true}
                        hint={hint}
                        fieldValue={(settings[field.value] as string) || ''}
                        onUpdate={(newVal: string) => onUpdate({ ...settings, [field.value]: newVal })}
                        error={errors[field.value] || ''}
                     />
                  </div>
               );
            }
            if (['input', 'string', 'time', 'duration', 'encoding', 'bits', 'spaceseplist', 'commaseplist'].includes(field.fieldType)) {
               return (
                  <div key={field.value} className={classes.field}>
                     <Input
                        label={fieldLabel}
                        inline={true}
                        hint={hint}
                        fieldValue={(settings[field.value] as string) || ''}
                        onUpdate={(newVal: string) => onUpdate({ ...settings, [field.value]: newVal })}
                        error={errors[field.value] || ''}
                     />
                  </div>
               );
            }

            if (field.fieldType === 'int') {
               return (
                  <div key={field.value} className={classes.field}>
                     <NumberInput
                        label={fieldLabel}
                        inline={true}
                        fieldValue={(settings[field.value] as number) || ''}
                        hint={hint}
                        onUpdate={(newVal) => onUpdate({ ...settings, [field.value]: newVal })}
                        error={errors[field.value] || ''}
                     />
                  </div>
               );
            }
            if (field.fieldType === 'tristate') {
               return (
                  <div key={field.value} className={classes.field}>
                     <Tristate
                        label={fieldLabel}
                        inline={true}
                        fieldValue={(settings[field.value] as string) || ''}
                        options={[
                           { label: 'On', value: 'true' },
                           { label: 'Off', value: 'false' },
                           { label: 'Unset', value: 'unset' },
                        ]}
                        hint={hint}
                        onUpdate={(newVal: string) => onUpdate({ ...settings, [field.value]: newVal })}
                     />
                  </div>
               );
            }
            if (field.fieldType === 'sizesuffix') {
               return (
                  <div key={field.value} className={classes.field}>
                     <SizePicker
                        label={fieldLabel}
                        inline={true}
                        fieldValue={(settings[field.value] as string) || ''}
                        hint={hint}
                        onUpdate={(newVal: string) => onUpdate({ ...settings, [field.value]: newVal })}
                     />
                  </div>
               );
            }
            if (field.fieldType === 'select' && field.options) {
               const customField = field.options.find((o) => o.value === 'custom');
               return (
                  <>
                     <div key={field.value} className={classes.field}>
                        <Select
                           label={fieldLabel}
                           options={field.options}
                           fieldValue={
                              isCustomActive(field) && customField?.value ? customField?.value : (settings[field.value] as string) || ''
                           }
                           hint={hint}
                           onUpdate={(newVal: string) => {
                              if (field.allowCustom) {
                                 setCustomFieldsActive((prev) => ({
                                    ...prev,
                                    [field.value]: newVal === 'custom',
                                 }));
                              }
                              onUpdate({ ...settings, [field.value]: newVal });
                           }}
                           error={errors[field.value] || ''}
                           inline={true}
                        />
                        {isCustomActive(field) && (
                           <div key={field.value} className={classes.field} style={{ margin: '20px 0' }}>
                              <Input
                                 label={customField?.label || 'Insert Custom'}
                                 inline={true}
                                 fieldValue={(settings[field.value] as string) || ''}
                                 onUpdate={(newVal: string) => onUpdate({ ...settings, [field.value]: newVal })}
                                 error={errors[field.value] || ''}
                              />
                           </div>
                        )}
                     </div>
                  </>
               );
            }
            return null;
         })}{' '}
      </>
   );
};
export default StorageSettings;
