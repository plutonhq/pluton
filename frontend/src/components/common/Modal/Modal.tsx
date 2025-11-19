import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './Modal.module.scss';
import { createPortal } from 'react-dom';

export interface ModalProps {
   children: React.ReactNode;
   width?: string;
   title?: string;
   classNames?: string;
   disablePortal?: boolean;
   disableBackdropClick?: boolean;
   closeModal: () => void;
}

const Modal = ({ children, width, closeModal, title, disablePortal = false, classNames = '', disableBackdropClick = false }: ModalProps) => {
   const [isActive, setIsActive] = useState(false);
   const [isAutoVertical, setIsAutoVertical] = useState(false);
   const modalContentRef = useRef<HTMLDivElement>(null);
   const animationDuration = 300;

   useEffect(() => {
      const closeModalOnEsc = (event: KeyboardEvent) => {
         if (event.key === 'Escape') {
            closeModal();
         }
      };
      window.addEventListener('keydown', closeModalOnEsc, false);

      // Trigger animation after component mounts
      setTimeout(() => {
         setIsActive(true);
      }, 10);

      return () => {
         window.removeEventListener('keydown', closeModalOnEsc, false);
      };
   }, [closeModal]);

   useEffect(() => {
      const checkModalHeight = () => {
         if (modalContentRef.current) {
            const height = modalContentRef.current.offsetHeight;
            setIsAutoVertical(height > 500);
         }
      };
      checkModalHeight();
   }, [isActive, children]);

   const handleClose = () => {
      setIsActive(false);
      // Wait for animation to complete before actually closing
      setTimeout(() => {
         closeModal();
      }, animationDuration);
   };

   const closeOnBGClick = (e: React.SyntheticEvent) => {
      if (disableBackdropClick) return;
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (e.target === e.currentTarget) {
         handleClose();
      }
   };

   const renderModalContent = () => {
      return (
         <div
            className={`${classes.modal} ${classNames} ${isAutoVertical ? classes.autoVertical : ''} ${isActive ? classes.active : ''}`}
            onClick={closeOnBGClick}
            data-testid="modal"
         >
            <div className={`${classes.modalContent} ${isActive ? classes.active : ''}`} style={{ width: width }} ref={modalContentRef}>
               {title && <h3>{title}</h3>}
               <button className={classes.modalClose} onClick={handleClose}>
                  <Icon type="close" size={24} />
               </button>
               <div className={classes.modalChildren}>{children}</div>
            </div>
         </div>
      );
   };

   return disablePortal ? renderModalContent() : createPortal(renderModalContent(), document.body);
};

export default Modal;
