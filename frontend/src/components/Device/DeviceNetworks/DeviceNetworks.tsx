import classes from '../DeviceInfo/DeviceInfo.module.scss';
import { DeviceMetrics } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';

interface DeviceNetworksProps {
   network: DeviceMetrics['network'];
}

const DeviceNetworks = ({ network }: DeviceNetworksProps) => {
   return (
      <div className={classes.networks}>
         {network.length > 0 && (
            <div className={classes.component}>
               <div className={classes.componentTitle}>
                  <Icon type="net-wired" size={12} /> Network
               </div>
               <div className={classes.componentContent}>
                  {[...network]
                     .sort((a, b) => {
                        if (a.operstate === 'up' && b.operstate !== 'up') return -1;
                        if (a.operstate !== 'up' && b.operstate === 'up') return 1;
                        return 0;
                     })
                     .map((net) => {
                        return (
                           <div key={net.ifaceName} className={classes.item}>
                              <div className={`label ${net.operstate === 'up' ? 'success' : 'disabled'} ${classes.blockLabel}`}>
                                 {net.operstate === 'up' ? 'Active' : 'Inactive'}
                              </div>
                              <div className={classes.iconBlock}>
                                 <Icon type={`net-${net.type === 'wireless' ? 'wireless' : 'wired'}`} size={18} />
                              </div>
                              <div className={classes.contentBlock}>
                                 <h4>{net.ifaceName}</h4>
                                 <div>IP4: {net.ip4}</div>
                                 <div>IP6: {net.ip6}</div>
                              </div>
                           </div>
                        );
                     })}
               </div>
            </div>
         )}
      </div>
   );
};

export default DeviceNetworks;
