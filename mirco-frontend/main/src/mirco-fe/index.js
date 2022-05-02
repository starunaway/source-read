import {rewriteRouter} from './rewrite-router';
import {handleRouter} from './handle-router';

let _apps = [];

export const getApps = () => _apps;

export const registerMicroApps = (apps) => {
  console.log('registerMicroApps', apps);
  _apps = apps;
};

export const start = () => {
  // 1. 监视路由变化
  //    hash  window.onhashchange
  //    history
  //    history.go history.back history.forward  -> window.onpopstate

  rewriteRouter();

  // main初始化时执行匹配
  handleRouter();
};
