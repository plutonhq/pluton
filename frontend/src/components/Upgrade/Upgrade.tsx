import ActionModal from '../common/ActionModal/ActionModal';
/** Compatibility component name only; no paid edition or licensing workflow. */
const Upgrade = ({ onClose }: { focus?: string; onClose: () => void }) => (
   <ActionModal
      title="Feature availability"
      closeModal={onClose}
      message={
         <p>
            This action is not implemented in this build. See <a href="/docs/reference/limitations">supported capabilities and limitations</a>. There
            is no commercial activation path.
         </p>
      }
      primaryAction={{ title: 'Close', type: 'default', isPending: false, action: onClose }}
   />
);
export default Upgrade;
