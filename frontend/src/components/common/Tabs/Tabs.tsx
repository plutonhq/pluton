import React, { createContext, useContext, useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './Tabs.module.scss';

interface TabsContextType {
   activeTab: string;
   setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

interface TabsProps {
   children: React.ReactNode;
   defaultValue: string;
   value?: string;
   variant?: 'default' | 'inline' | 'underline';
   onChange?: (value: string) => void;
   customClasses?: string;
}

const Tabs = ({ children, defaultValue, value, variant = 'default', onChange, customClasses = '' }: TabsProps) => {
   const [internalValue, setInternalValue] = useState(defaultValue);
   const activeTab = value !== undefined ? value : internalValue;

   const setActiveTab = (tab: string) => {
      if (value === undefined) {
         setInternalValue(tab);
      }
      onChange?.(tab);
   };

   return (
      <TabsContext.Provider value={{ activeTab, setActiveTab }}>
         <div className={`${customClasses}  ${variant ? classes[`tabs--${variant}`] : ''}`}>{children}</div>
      </TabsContext.Provider>
   );
};

interface TabListProps {
   children: React.ReactNode;
   customClasses?: string;
}

const TabList = ({ children, customClasses }: TabListProps) => {
   return (
      <div className={`${classes.tabs} ${customClasses || ''}`}>
         <ul>{children}</ul>
      </div>
   );
};

interface TabProps {
   value: string;
   label: string | React.ReactNode;
   icon?: string;
   customClasses?: string;
}

const Tab = ({ value, label, icon, customClasses }: TabProps) => {
   const context = useContext(TabsContext);
   if (!context) throw new Error('Tab must be used within Tabs');

   const { activeTab, setActiveTab } = context;
   const isActive = activeTab === value;

   return (
      <li onClick={() => setActiveTab(value)} className={`${isActive ? classes.tabActive : ''} ${customClasses || ''}`}>
         {icon && (
            <>
               <Icon type={icon} size={13} />{' '}
            </>
         )}
         <span>{label}</span>
      </li>
   );
};

interface TabPanelProps {
   value: string;
   children: React.ReactNode;
   customClasses?: string;
   minHeight?: string;
}

const TabPanel = ({ value, children, customClasses, minHeight }: TabPanelProps) => {
   const context = useContext(TabsContext);
   if (!context) throw new Error('TabPanel must be used within Tabs');

   const { activeTab } = context;

   if (activeTab !== value) return null;

   return (
      <div className={`${classes.tabContent} ${customClasses || ''}`} style={{ minHeight }}>
         {children}
      </div>
   );
};

export { Tab, TabList, TabPanel };
export default Tabs;
