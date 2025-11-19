import { useParams } from 'react-router';
import { useState } from 'react';
import Icon from '../../components/common/Icon/Icon';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import { useGetDevice, useGetSystemMetrics } from '../../services/devices';
import DeviceInfo from '../../components/Device/DeviceInfo/DeviceInfo';
import EditDevice from '../../components/Device/EditDevice/EditDevice';
import classes from './DeviceSingle.module.scss';
// import { compareVersions } from '../../utils/helpers';
import NotFound from '../../components/common/NotFound/NotFound';
import DeviceBackups from '../../components/Device/DeviceBackups/DeviceBackups';
import { DevicePlan } from '../../@types/devices';

const DeviceSingle = () => {
   const { id } = useParams();
   const [showEditModal, setShowEditModal] = useState(false);
   const { data, isLoading, error: DeviceError } = useGetDevice(id as string);
   const { data: metricsData } = useGetSystemMetrics(id as string);

   console.log('DeviceError :', DeviceError, (DeviceError as Error & { status?: number })?.status);

   const errorStatusCode = (DeviceError as Error & { status?: number })?.status;
   if (!id || errorStatusCode === 404) {
      return <NotFound name="Device" link="/sources" linkText="All Sources" />;
   }

   const device = data?.result?.device;
   const metrics = metricsData?.result && metricsData?.result?.system ? metricsData.result : device?.metrics;
   const devicePlans: DevicePlan[] = data?.result?.plans || [];
   const deviceName = device?.name;
   const isPending = device?.status && device?.status === 'pending';

   const { restic = '100.0.0', rclone = '100.0.0' } = device?.versions || {};

   return (
      <div className={classes.device}>
         {deviceName ? (
            <PageHeader
               title={
                  <>
                     {deviceName}
                     {id === 'main' && <span className="label in_progress">Main</span>}
                  </>
               }
               pageTitle={deviceName}
               icon="devices"
               rightSection={
                  <>
                     {(!isPending || id === 'main') && (
                        <>
                           <button className={`${classes.version}`} data-tooltip-id="appTooltip" data-tooltip-content={`Restic version: ${restic}`}>
                              <Icon type="restic" size={14} /> <i>v{restic}</i>
                           </button>
                           <button className={`${classes.version}`} data-tooltip-id="appTooltip" data-tooltip-content={`Rclone version: ${rclone}`}>
                              <Icon type="rclone" size={14} /> <i>v{rclone}</i>
                           </button>
                           <b>|</b>
                        </>
                     )}
                     <button className={classes.actionBtn} onClick={() => setShowEditModal(true)}>
                        <Icon size={14} type="edit-settings" /> Edit
                     </button>
                  </>
               }
            />
         ) : (
            <span className={`skeleton-box ${classes.titleSkeleton}`} />
         )}
         <div className={classes.deviceContent}>
            {isLoading ? (
               <div className="loadingScreen">
                  <Icon size={60} type="loading" />
               </div>
            ) : (
               <>
                  <DeviceBackups plans={devicePlans} />
                  {metrics?.system && <DeviceInfo metrics={metrics} isRefetching={false} />}
               </>
            )}
         </div>
         {device && showEditModal && <EditDevice device={device} close={() => setShowEditModal(false)} />}
      </div>
   );
};

export default DeviceSingle;
