import { useTheme } from '../../../context/ThemeContext';
import Input from '../../common/form/Input/Input';
import Tristate from '../../common/form/Tristate/Tristate';
import classes from './GeneralSettings.module.scss';

interface GeneralSettingsProps {
   settingsID: number;
   settings: Record<string, any>;
   onUpdate: (settings: Record<string, any>) => void;
}

const GeneralSettings = ({ settings, onUpdate }: GeneralSettingsProps) => {
   const { setTheme } = useTheme();

   const handleThemeChange = (newThemeValue: 'auto' | 'light' | 'dark') => {
      setTheme(newThemeValue);
      onUpdate({ ...settings, theme: newThemeValue });
   };

   return (
      <div>
         <div className={classes.field}>
            <Input
               label="App Instance Title"
               fieldValue={(settings?.title || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, title: val })}
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="App Instance Description"
               fieldValue={(settings?.description || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, description: val })}
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Admin Email"
               fieldValue={settings.admin_email || ''}
               onUpdate={(val) => onUpdate({ ...settings, admin_email: val })}
               type="email"
               placeholder="johndoe@mail.com"
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Tristate
               label="Color Scheme"
               fieldValue={settings.theme as string}
               options={[
                  { label: 'Auto', value: 'auto' },
                  { label: 'Dark', value: 'dark' },
                  { label: 'Light', value: 'light' },
               ]}
               onUpdate={(val: string) => handleThemeChange(val as 'auto' | 'light' | 'dark')}
               inline={true}
            />
         </div>
      </div>
   );
};

export default GeneralSettings;
