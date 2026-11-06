import { useState } from 'react';
import { NavLink } from 'react-router';
import DashboardWidget from '../DashboardWidget/DashboardWidget';
import Tabs, { Tab, TabList } from '../../common/Tabs/Tabs';
import Icon from '../../common/Icon/Icon';
import { useGetDashboardEvents } from '../../../services/dashboard';
import { DashboardEvent, DashboardEventType } from '../../../@types/dashboard';
import { timeAgo } from '../../../utils/helpers';
import classes from './BackupEvents.module.scss';

const getEventLink = ({ source, planId, backupId }: DashboardEvent) => {
   if (planId && backupId) return `/plan/${planId}?backupEvents=${backupId}`;
   if (planId && source === 'plan') return `/plan/${planId}?logs=1`;
   return '/settings?appLogs=1';
};

const EventMessage = ({ event }: { event: DashboardEvent }) => {
   const { message, planId, planTitle, source, type } = event;
   const link = getEventLink(event);
   if (source !== 'backup') {
      const label = type === 'failure' ? 'a failure' : 'a warning';
      if (!planId || !planTitle) return <NavLink to={link}>Pluton had {type === 'failure' ? 'an app error' : 'an app warning'}</NavLink>;
      return (
         <>
            <NavLink to={link}>{planTitle}</NavLink> had {label}
         </>
      );
   }
   if (!planId) return <>{message}</>;
   const titleIndex = planTitle ? message.indexOf(planTitle) : -1;
   if (!planTitle || titleIndex === -1) return <NavLink to={link}>{message}</NavLink>;
   return (
      <>
         {message.slice(0, titleIndex)}
         <NavLink to={link}>{planTitle}</NavLink>
         {message.slice(titleIndex + planTitle.length)}
      </>
   );
};

const BackupEvents = () => {
   const [eventType, setEventType] = useState<DashboardEventType | 'all'>('all');
   const { data, isLoading } = useGetDashboardEvents(eventType);
   const events: DashboardEvent[] = data?.result || [];

   return (
      <DashboardWidget title="Backup Events" icon="logs">
         <Tabs defaultValue="all" value={eventType} variant="inline" onChange={(value) => setEventType(value as DashboardEventType | 'all')}>
            <TabList customClasses={classes.tabList}>
               <Tab value="all" label="All" />
               <Tab value="success" label="Success" />
               <Tab value="warning" label="Warning" />
               <Tab value="failure" label="Failure" />
            </TabList>
         </Tabs>
         <div className={`${classes.events} styled__scrollbar`}>
            {isLoading ? (
               <div className={classes.empty}>
                  <Icon type="loading" size={24} />
               </div>
            ) : events.length === 0 ? (
               <div className={classes.empty}>No events found.</div>
            ) : (
               <ul>
                  {events.map((event) => (
                     <li key={event.id} className={classes[`event--${event.type}`]}>
                        <i className={classes.dot} />
                        <div className={classes.eventContent}>
                           <span className={classes.message}>
                              <EventMessage event={event} />
                           </span>
                           <span className={classes.time} title={new Date(event.time).toLocaleString()}>
                              {timeAgo(new Date(event.time))}
                           </span>
                        </div>
                     </li>
                  ))}
               </ul>
            )}
         </div>
      </DashboardWidget>
   );
};

export default BackupEvents;
