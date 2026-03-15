import { PlanReplicationSettings } from '../../../@types';
import classes from './PlanStorageInfo.module.scss';

interface PlanStorageInfoProps {
   storage: { name: string; type: string; id: string };
   storagePath: string;
   replicationSettings?: PlanReplicationSettings;
   disableTooltip?: boolean;
   inline?: boolean;
}

const PlanStorageInfo = ({ replicationSettings, storage, storagePath, disableTooltip = true, inline = true }: PlanStorageInfoProps) => {
   console.log('replicationSettings :', replicationSettings);
   return (
      <>
         {replicationSettings && replicationSettings.enabled && replicationSettings.storages.length > 0 ? (
            <div
               className={`${classes.planStorages} ${inline ? classes.inline : ''}`}
               data-tooltip-hidden={disableTooltip}
               data-tooltip-id="htmlToolTip"
               data-tooltip-place="top"
               data-tooltip-html={`
                           <div style="display: flex; flex-direction: column; gap: 8px;">
                           <div>
                              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                                 <img style="width: 24px; height: 24px;" src="/providers/${storage?.type}.png" />
                                 <div>
                                    <strong style="display: block;">${storage?.name}</strong>
                                    ${storagePath || '/'}
                                 </div>
                              </div>
                           </div>
                           ${replicationSettings.storages
                              .slice(0, 3)
                              .map(
                                 (s) => `
                              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                                 <img style="width: 24px; height: 24px;" src="/providers/${s?.storageType}.png" />
                                 <div>
                                    <strong style="display: block;">${s?.storageName} (Mirror)</strong>
                                    ${s?.storagePath || '/'}
                                 </div>
                              </div>
                                    `,
                              )
                              .join('')}
                        </div>`}
            >
               <div className={classes.storageWithReplications}>
                  <div className={classes.storageIcons}>
                     <img src={`/providers/${storage?.type}.png`} />
                     {replicationSettings.storages.map((s, index) => (
                        <img key={s.replicationId} src={`/providers/${s.storageType}.png`} style={{ zIndex: 98 - index }} />
                     ))}
                  </div>
                  <div className={classes.storageName}>{replicationSettings.storages.length + 1} Storages</div>
               </div>
            </div>
         ) : (
            <div
               className={`${classes.planStorages} ${inline ? classes.inline : ''}`}
               data-tooltip-hidden={disableTooltip}
               data-tooltip-id="htmlToolTip"
               data-tooltip-place="top"
               data-tooltip-html={`
                           <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                              <img style="width: 24px; height: 24px;" src="/providers/${storage?.type}.png" />
                              <div>
                                 <strong style="display: block;">${storage?.name}</strong>
                                 ${storagePath || '/'}
                              </div>
                           </div>
                        `}
            >
               <img src={`/providers/${storage?.type}.png`} />
               <div className={classes.storageName}>{storage?.name}</div>
            </div>
         )}
      </>
   );
};

export default PlanStorageInfo;
