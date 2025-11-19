import Icon from '../Icon/Icon';

interface StatusLabelProps {
   status: 'completed' | 'cancelled' | 'failed' | 'started';
   hasError: boolean;
}

const StatusLabel = ({ status, hasError }: StatusLabelProps) => {
   if (status === 'completed') {
      return (
         <div>
            <Icon type={'check-circle-filled'} size={15} color="#06ba9f" /> Complete{hasError && '*'}
         </div>
      );
   } else if (status === 'cancelled') {
      return (
         <div>
            <Icon type={'close-circle'} size={15} color="#bbb" /> Cancelled
         </div>
      );
   } else if (status === 'failed') {
      return (
         <div>
            <Icon type={'error-circle-filled'} size={15} color="#ff7070" /> Failed
         </div>
      );
   } else if (status === 'started' || status === 'retrying') {
      return (
         <div>
            <Icon type={'loading'} size={15} /> In Progress
         </div>
      );
   }
};

export default StatusLabel;
