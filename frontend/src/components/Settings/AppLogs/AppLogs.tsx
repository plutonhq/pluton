import { useMemo } from 'react';
import { useGetAppLogs } from '../../../services/settings';
import LogViewer from '../../common/LogViewer/LogViewer';
import { LogItem } from '../../../@types/settings';

interface AppLogsProps {
   settingsID?: string;
}

const AppLogs = ({ settingsID = '1' }: AppLogsProps) => {
   const { data: logs, isLoading } = useGetAppLogs(settingsID);
   const planLogs = logs?.result || [];
   console.log('logs :', planLogs);
   console.log('settingsID: ', settingsID);

   const theLogs = useMemo(() => {
      return planLogs.sort((a: LogItem, b: LogItem) => b.time - a.time);
   }, [logs]);

   return <LogViewer type="app" logs={theLogs} settingsID={settingsID} isLoading={isLoading} />;
};

export default AppLogs;
