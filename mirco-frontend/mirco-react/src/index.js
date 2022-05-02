import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import './public-path';

let instance;

function render(props) {
  const {container} = props;
  instance = ReactDOM.createRoot(container ? container.querySelector('#root') : document.getElementById('root'));
  instance.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if (!window.__mirco_frontend) {
  mount({});
}

// 生命周期函数必须返回promise
export async function bootstrap() {
  console.log('react bootstraped');
}

export async function mount(props = {}) {
  console.log('react mount');
  render(props);
}

export async function unmount() {
  console.log('react unmount', instance);
  instance.unmount();
  instance = null;
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
