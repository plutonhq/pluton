import { NavLink } from 'react-router';
import { useState } from 'react';
import { useLogout } from '../../../services/users';
import Icon from '../../common/Icon/Icon';
import Logo from '../../common/Logo/Logo';
import classes from './SideNav.module.scss';
import Modal from '../../common/Modal/Modal';
import { isMobile } from '../../../utils/helpers';

const SideNav = () => {
   const [showLogoutModal, setShowLogoutModal] = useState(false);
   const logoutMutation = useLogout();

   return (
      <div className={classes.sideNavInner} tabIndex={-1}>
         <div className={classes.logo}>
            <NavLink to="/" end aria-label="Dashboard">
               <Logo size={30} />
            </NavLink>
         </div>
         <nav className={classes.navMenu}>
            <NavLink to="/" end aria-label="Dashboard">
               {() => (
                  <span
                     className={classes.navMenuLabel}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Dashboard"
                     data-tooltip-place="left"
                     data-tooltip-delay-show={500}
                     data-tooltip-hidden={isMobile()}
                  >
                     <Icon type="dashboard" size={26} />
                  </span>
               )}
            </NavLink>
            <NavLink to="/plans" end aria-label="Backup Plans">
               {() => (
                  <span
                     className={classes.navMenuLabel}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Backup Plans"
                     data-tooltip-place="left"
                     data-tooltip-delay-show={500}
                     data-tooltip-hidden={isMobile()}
                  >
                     <Icon type="plans" size={28} />
                  </span>
               )}
            </NavLink>
            <NavLink to="/storages" end aria-label="Storages">
               {() => (
                  <span
                     className={classes.navMenuLabel}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Storages"
                     data-tooltip-place="left"
                     data-tooltip-delay-show={500}
                     data-tooltip-hidden={isMobile()}
                  >
                     <Icon type="storages" size={24} />
                  </span>
               )}
            </NavLink>
            <NavLink to="/sources" end aria-label="Sources">
               {() => (
                  <span
                     className={classes.navMenuLabel}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Sources"
                     data-tooltip-place="left"
                     data-tooltip-delay-show={500}
                     data-tooltip-hidden={isMobile()}
                  >
                     <Icon type="sources" size={22} />
                  </span>
               )}
            </NavLink>
            <NavLink to="/settings" end aria-label="Settings">
               {() => (
                  <span
                     className={classes.navMenuLabel}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Settings"
                     data-tooltip-place="left"
                     data-tooltip-delay-show={500}
                     data-tooltip-hidden={isMobile()}
                  >
                     <Icon type="settings" size={24} />
                  </span>
               )}
            </NavLink>
         </nav>
         <button className={classes.logoutButton} onClick={() => setShowLogoutModal(true)} aria-label="Logout">
            <span
               className={classes.navMenuLabel}
               data-tooltip-id="appTooltip"
               data-tooltip-content="Logout"
               data-tooltip-place="left"
               data-tooltip-delay-show={500}
               data-tooltip-hidden={isMobile()}
            >
               <Icon type="logout" size={24} />
            </span>
         </button>
         {showLogoutModal && (
            <Modal title="Logout" closeModal={() => setShowLogoutModal(false)} width="300px">
               <p>Are you sure you want to Logout?</p>
               <div className="modalActions">
                  <button className="modalButton" onClick={() => setShowLogoutModal(false)}>
                     Cancel
                  </button>
                  <button className="modalButton modalButton--ok" onClick={() => logoutMutation.mutate()}>
                     <Icon type={logoutMutation.isPending ? 'loading' : 'logout'} size={12} /> Logout
                  </button>
               </div>
            </Modal>
         )}
      </div>
   );
};

export default SideNav;
