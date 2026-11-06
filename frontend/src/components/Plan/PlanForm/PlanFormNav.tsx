import Icon from '../../common/Icon/Icon';
import PFClasses from './PlanForm.module.scss';

interface PlanFProps {
   step: number;
   type: 'add' | 'edit';
   gotoStep: (step: number) => void;
}

const PlanFormNav = ({ step, type, gotoStep }: PlanFProps) => {
   return (
      <div className={`${PFClasses.steps} ${type === 'edit' ? PFClasses.stepsEdit : PFClasses.stepsAdd}`}>
         <ul>
            <li className={` ${(type === 'add' ? step >= 1 : step === 1) ? PFClasses.stepCurrent : ''}  ${type === 'add' && step > 1 ? PFClasses.stepPassed : ''}`}>
               <button type="button" disabled={type !== 'edit'} aria-current={step === 1 ? 'step' : undefined} onClick={() => gotoStep(1)}>
                  <span>
                     {type === 'add' && step > 1 && <Icon type="check" size={11} />}
                     {step === 1 ? '●' : ''}
                  </span>
                  <i>
                     <Icon type="settings" size={12} /> Basic
                  </i>
               </button>
            </li>
            <li className={` ${(type === 'add' ? step >= 2 : step === 2) ? PFClasses.stepCurrent : ''} ${type === 'add' && step > 2 ? PFClasses.stepPassed : ''}`}>
               <button type="button" disabled={type !== 'edit'} aria-current={step === 2 ? 'step' : undefined} onClick={() => gotoStep(2)}>
                  <span>
                     {type === 'add' && step > 2 && <Icon type="check" size={11} />}
                     {step === 2 ? '●' : ''}
                  </span>
                  <i>
                     <Icon type="folders" size={12} /> Source & Destination
                  </i>
               </button>
            </li>
            <li className={` ${(type === 'add' ? step >= 3 : step === 3) ? PFClasses.stepCurrent : ''} ${type === 'add' && step > 3 ? PFClasses.stepPassed : ''}`}>
               <button type="button" disabled={type !== 'edit'} aria-current={step === 3 ? 'step' : undefined} onClick={() => gotoStep(3)}>
                  <span>
                     {type === 'add' && step > 3 && <Icon type="check" size={11} />}
                     {step === 3 ? '●' : ''}
                  </span>
                  <i>
                     <Icon type="clock" size={12} /> Schedule & Retention
                  </i>
               </button>
            </li>
            <li className={` ${step === 4 ? PFClasses.stepCurrent : ''}`}>
               <button type="button" disabled={type !== 'edit'} aria-current={step === 4 ? 'step' : undefined} onClick={() => gotoStep(4)}>
                  <span>
                     {type === 'add' && step === 4 ? <Icon type="check" size={11} /> : ''}
                     {type !== 'add' && step === 4 ? '●' : ''}
                  </span>
                  <i>
                     <Icon type="cog" size={12} /> Advanced
                  </i>
               </button>
            </li>
         </ul>
      </div>
   );
};

export default PlanFormNav;
