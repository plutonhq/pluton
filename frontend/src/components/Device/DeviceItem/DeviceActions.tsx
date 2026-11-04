import { useState } from 'react';
import { useNavigate } from 'react-router';
import Icon from '../../common/Icon/Icon';
import classes from './DeviceItem.module.scss';
import { Device } from '../../../@types/devices';
import EditDevice from '../EditDevice/EditDevice';

const DeviceActions = ({ device }: { device: Device }) => {
   const [showSettings, setShowSettings] = useState(false);
   const [showEditModal, setShowEditModal] = useState(false);
   const navigate = useNavigate();

   return (
      <>
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
                     navigate(`/device/${device.id}`);
                  }}
               >
                  <Icon type="eye" size={14} /> System Info
               </button>
            </div>
         )}
         {showEditModal && <EditDevice device={device} close={() => setShowEditModal(false)} />}
      </>
   );
};

export default DeviceActions;
