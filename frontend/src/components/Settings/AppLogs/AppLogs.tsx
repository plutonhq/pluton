import { useMemo } from 'react';
import { useGetAppLogs } from '../../../services/settings';
import LogViewer from '../../common/LogViewer/LogViewer';
import { LogItem } from '../../../@types/settings';

interface AppLogsProps {
   settingsID?: string;
}

const AppLogs = ({ settingsID = '1' }: AppLogsProps) => {
   const { data: logs, isLoading } = useGetAppLogs(settingsID);
   const theLogs = useMemo(() => {
      const planLogs: LogItem[] = logs?.result || [];
      return [...planLogs].sort((a, b) => b.time - a.time);
   }, [logs]);

   return <LogViewer type="app" logs={theLogs} settingsID={settingsID} isLoading={isLoading} />;
};

export default AppLogs;
