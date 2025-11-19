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
      <div className={classes.navMenu} tabIndex={-1}>
         <div className={classes.logo}>
            <Logo size={30} color="#fff" />
         </div>
         <nav className={classes.navMenu}>
            <NavLink to="/" end aria-label="Backup Plans">
               {() => (
                  <span
                     className={classes.navMenuLabel}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Backup Plans"
                     data-tooltip-place="left"
                     data-tooltip-delay-show={500}
                     data-tooltip-hidden={isMobile()}
                  >
                     <Icon type="plans" size={30} />
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
                     <Icon type="storages" size={26} />
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
                     <Icon type="sources" size={26} />
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
                     <Icon type="settings" size={30} />
                  </span>
               )}
            </NavLink>
            <a onClick={() => setShowLogoutModal(true)} aria-label="Logout">
               <span
                  className={classes.navMenuLabel}
                  data-tooltip-id="appTooltip"
                  data-tooltip-content="Logout"
                  data-tooltip-place="left"
                  data-tooltip-delay-show={500}
                  data-tooltip-hidden={isMobile()}
               >
                  <Icon type="logout" size={30} />
               </span>
            </a>
         </nav>
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
