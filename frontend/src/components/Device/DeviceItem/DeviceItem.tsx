import Icon from '../../common/Icon/Icon';
import classes from './DeviceItem.module.scss';
import { NavLink, useNavigate } from 'react-router';
import { Device } from '../../../@types/devices';
import { useState } from 'react';
import { getOSIcon } from '../../../utils/helpers';
import EditDevice from '../EditDevice/EditDevice';

interface DeviceItemProps {
   device: Device;
   layout: 'grid' | 'list';
}

const DeviceItem = ({ device, layout }: DeviceItemProps) => {
   const [showSettings, setShowSettings] = useState(false);
   const [showEditModal, setShowEditModal] = useState(false);
   const navigate = useNavigate();
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
            <div
               className={classes.version}
               data-tooltip-id="appTooltip"
               data-tooltip-content={`Pluton Agent version: ${agentVersion ? 'v' + agentVersion : 'latest'}`}
            >
               <Icon type="compressed" size={14} /> <i>{agentVersion ? 'v' + agentVersion : 'latest'}</i>
            </div>
            <button className={`${classes.moreBtn} ${showSettings ? classes.moreBtnActive : ''}`} onClick={() => setShowSettings(!showSettings)}>
               <Icon type="dots-vertical" size={14} />
            </button>
            {showSettings && (
               <div className={classes.settings}>
                  <button
                     onClick={() => {
                        setShowEditModal(true);
                        setShowSettings(false);
                     }}
                  >
                     <Icon type="edit-settings" size={14} /> Edit
                  </button>
                  <button
                     onClick={() => {
                        setShowSettings(false);
                        navigate(`/device/${id}`);
                     }}
                  >
                     <Icon type="eye" size={14} /> System Info
                  </button>
               </div>
            )}
         </div>

         {showEditModal && <EditDevice device={device} close={() => setShowEditModal(false)} />}
      </div>
   );
};

export default DeviceItem;
