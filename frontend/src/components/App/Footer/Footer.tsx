import classes from './Footer.module.scss';

interface FooterProps {
   version: string;
   hideUpgradeLink?: boolean;
   changeLogUrl?: string;
}

const Footer = ({ version = '1.0.0', hideUpgradeLink = false, changeLogUrl }: FooterProps) => {
   return (
      <>
         <div className={classes.footer}>
            <span>Pluton v{version}</span> <i className="pipe">|</i>
            {!hideUpgradeLink && (
               <>
                  <a href="https://usepluton.com/pluton-pro/" target="_blank">
                     Upgrade
                  </a>{' '}
                  <i className="pipe">|</i>
               </>
            )}
            <a href="https://docs.usepluton.com" target="_blank">
               Documentation
            </a>{' '}
            <i className="pipe">|</i>
            <a href={changeLogUrl || 'https://github.com/plutonhq/pluton/blob/main/CHANGELOG.md'} target="_blank">
               Changelog
            </a>
         </div>
      </>
   );
};

export default Footer;
