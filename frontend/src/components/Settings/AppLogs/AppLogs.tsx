import LogViewer from '../../common/LogViewer/LogViewer';

interface AppLogsProps {
   settingsID?: string;
}

const AppLogs = ({ settingsID = '1' }: AppLogsProps) => {
   return <LogViewer type="app" id={settingsID} />;
};

export default AppLogs;
