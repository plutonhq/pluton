import Icon from '../Icon/Icon';
import Modal from '../Modal/Modal';
import classes from './ActionModal.module.scss';

interface ActionModalProps {
   width?: string;
   title?: string;
   classNames?: string;
   disablePortal?: boolean;
   closeModal: () => void;
   message: React.ReactNode;
   successMessage?: React.ReactNode;
   errorMessage?: React.ReactNode;
   primaryAction?: {
      type: 'default' | 'danger';
      isPending: boolean;
      action: (params: any) => void;
      title: string;
      icon?: string;
   };
   secondaryAction?: {
      action: (params: any) => void;
      title: string;
      icon?: string;
   };
}

const ActionModal = ({
   title,
   closeModal,
   message,
   successMessage,
   errorMessage,
   primaryAction,
   secondaryAction,
   classNames,
   disablePortal = false,
   width = '400px',
}: ActionModalProps) => {
   return (
      <Modal title={title} closeModal={closeModal} classNames={classNames} disablePortal={disablePortal} width={width}>
         <div>
            {primaryAction?.isPending && (
               <div className={classes.loader}>
                  <Icon type="loading" size={24} />
               </div>
            )}
         </div>
         <div>{message}</div>
         {successMessage && <div className={classes.success}>{successMessage}</div>}
         {errorMessage && <div className={classes.error}>{errorMessage}</div>}
         <div className={classes.actions}>
            <button disabled={primaryAction?.isPending} onClick={secondaryAction?.action || closeModal} type="button">
               {secondaryAction?.title || 'Cancel'}
            </button>
            {primaryAction?.title && (
               <button
                  className={primaryAction.type === 'danger' ? classes.dangerBtn : ''}
                  disabled={primaryAction.isPending}
                  onClick={primaryAction.action}
                  type="button"
               >
                  {primaryAction.icon && <Icon type={primaryAction.icon} size={13} />} {primaryAction.title}
               </button>
            )}
         </div>
      </Modal>
   );
};

export default ActionModal;
