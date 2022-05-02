import ReactDOM from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App';
import './index.css';

import {registerMicroApps, start} from './mirco-fe';

registerMicroApps([
  {name: 'app-react', entry: '//localhost:3001', container: '#subapp-container', activeRule: '/subapp/react'},
  {name: 'app-vue2', entry: '//localhost:3002', container: '#subapp-container', activeRule: '/subapp/vue2'},
]);

start();

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
