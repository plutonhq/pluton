import { Link } from 'react-router';
import classes from './NotFound.module.scss';

interface NotFoundProps {
   name: string;
   link: string;
   linkText?: string;
}

const NotFound = ({ name = 'page', link = '/', linkText }: NotFoundProps) => {
   return (
      <div className={classes.notFound}>
         <h1>404</h1>
         <h3>{name} Not Found</h3>
         <p>
            The {name} you are looking for does not exist. <Link to={link}>{linkText || `View All ${name}s`}</Link>
         </p>
      </div>
   );
};

export default NotFound;
