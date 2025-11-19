import React, { createContext, ReactNode, useContext } from 'react';

// Define a type for the component map
interface ComponentOverrides {
   [key: string]: React.ComponentType<any>;
}

// Create the context with an empty object as default value
export const ComponentOverrideContext = createContext<ComponentOverrides>({});

// Provider component that will wrap your application
interface ComponentProviderProps {
   overrides: ComponentOverrides;
   children: ReactNode;
}

export const ComponentProvider: React.FC<ComponentProviderProps> = ({ overrides, children }) => {
   return <ComponentOverrideContext.Provider value={overrides}>{children}</ComponentOverrideContext.Provider>;
};

// Custom hook to use in components that might be overridden
export const useComponentOverride = (componentKey: string, DefaultComponent: React.ComponentType<any>) => {
   const overrides = useContext(ComponentOverrideContext);
   return overrides[componentKey] || DefaultComponent;
};
