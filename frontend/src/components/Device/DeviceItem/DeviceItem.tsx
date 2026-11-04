import Icon from '../../common/Icon/Icon';
import classes from './DeviceItem.module.scss';
import { NavLink } from 'react-router';
import { Device } from '../../../@types/devices';
import { getOSIcon } from '../../../utils/helpers';
import DeviceActions from './DeviceActions';

interface DeviceItemProps {
   device: Device;
   layout: 'grid' | 'list';
}

const DeviceItem = ({ device, layout }: DeviceItemProps) => {
   const { id, versions, name, isRemote, plans = [], os = 'linux', type, status, connected } = device;
   const { agent: agentVersion } = versions || {};
   const isPlutonServer = id === 'main';

   const osIcon = getOSIcon(os || 'linux');

   return (
      <div key={id} className={`${classes.device} ${layout === 'grid' ? classes.deviceGrid : classes.list}`}>
         <div className={classes.leftContent}>
            <div className={classes.deviceType}>
               {!isPlutonServer && (
                  <span
                     title={connected ? 'Connected' : 'Disconnected'}
                     className={`${classes.connectionStatus} ${connected ? classes.connected : ''}`}
                  />
               )}
               <Icon type={isRemote ? 'computer-remote' : 'computer'} size={36} />
               <span className={classes.deviceOS} data-tooltip-id="appTooltip" data-tooltip-content={os}>
                  <Icon type={osIcon} size={14} />
               </span>
            </div>

            <div className={classes.content}>
               <NavLink to={`/device/${id}`}>
                  <div className={classes.title}>
                     <h4>
                        {name}
                        {id === 'main' && <span className={`label in_progress ${classes.mainLabel}`}>Main</span>}{' '}
                        {status === 'pending' && <span className={`label error ${classes.mainLabel}`}>Agent not Installed</span>}
                     </h4>
                  </div>
                  <div className={classes.type}>{type}</div>
               </NavLink>
            </div>
         </div>
         <div className={classes.rightContent}>
            <div className={classes.version}>
               <Icon type="backup" size={14} /> <i>{plans.length} Plans</i>
            </div>
            {id !== 'main' && (
               <div
                  className={classes.version}
                  data-tooltip-id="appTooltip"
                  data-tooltip-content={`Pluton Agent version: ${agentVersion ? 'v' + agentVersion : 'latest'}`}
               >
                  <Icon type="logo" size={13} /> <i>{agentVersion ? 'v' + agentVersion : 'latest'}</i>
               </div>
            )}
            <DeviceActions device={device} />
         </div>
      </div>
   );
};

export default DeviceItem;
