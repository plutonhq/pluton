import { useState } from 'react';
import classes from './Login.module.scss';
import Logo from '../../components/common/Logo/Logo';
import { APP_NAME } from '../../utils/constants';
import Icon from '../../components/common/Icon/Icon';
import { useLogin } from '../../services/users';
import PageTitle from '../../components/App/PageTitle/PageTitle';

const Login = () => {
   const [error, setError] = useState<LoginError | null>(null);
   const [username, setUsername] = useState<string>('');
   const [password, setPassword] = useState<string>('');
   const loginMutation = useLogin();

   type LoginError = {
      type: string;
      msg: string;
   };

   const handleLogin = () => {
      if (!username || !password) {
         let loginError: LoginError | null = null;
         if (!username && !password) {
            loginError = { type: 'empty_username_password', msg: 'Please Insert Your App Username & Password to login.' };
         }
         if (!username && password) {
            loginError = { type: 'empty_username', msg: 'Please Insert Your App Username' };
         }
         if (!password && username) {
            loginError = { type: 'empty_password', msg: 'Please Insert Your App Password' };
         }
         setError(loginError);
         setTimeout(() => {
            setError(null);
         }, 5000);
         return;
      }

      loginMutation.mutate(
         { username, password },
         {
            onError: (error: Error) => {
               let errorType = '';
               if (error.message.toLowerCase().includes('username')) {
                  errorType = 'incorrect_username';
               }
               if (error.message.toLowerCase().includes('password')) {
                  errorType = 'incorrect_password';
               }
               setError({ type: errorType, msg: error.message });
               setTimeout(() => {
                  setError(null);
               }, 5000);
            },
         },
      );
   };

   return (
      <div className={classes.loginPage}>
         <PageTitle title={`Login`} />
         <div className={classes.loginLogo}>
            <h3>
               <Logo size={36} /> <span>{APP_NAME}</span>
            </h3>
         </div>
         <div className={classes.container}>
            <div className="loginForm">
               <div className={classes.loginInput}>
                  <Icon type="user" classes={classes.loginInputIcon} />
                  <input
                     className={`${error && error.type.includes('username') ? 'inputError' : ''}`}
                     type="text"
                     value={username}
                     placeholder="Username"
                     onChange={(event) => setUsername(event.target.value)}
                  />
               </div>
               <div className={classes.loginInput}>
                  <Icon type="password" classes={classes.loginInputIcon} />
                  <input
                     className={`${error && error.type.includes('password') ? 'inputError' : ''}`}
                     type="password"
                     value={password}
                     placeholder="Password"
                     onChange={(event) => setPassword(event.target.value)}
                  />
               </div>
               <button className={classes.loginButton} onClick={handleLogin} disabled={loginMutation.isPending}>
                  {loginMutation.isPending ? 'Logging in...' : 'Login'}
               </button>
               {error && error.msg && <div className={classes.loginErrorMsg}>{error.msg}</div>}
            </div>
         </div>
      </div>
   );
};

export default Login;
