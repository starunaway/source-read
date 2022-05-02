import {handleRouter} from './handle-router';

let preRoute = '';
let nextRoute = window.location.pathname;

export const getPreRoute = () => preRoute;
export const getNextRoute = () => nextRoute;

export const rewriteRouter = () => {
  window.addEventListener('popstate', () => {
    //   触发时路由已经完成导航了
    preRoute = nextRoute;
    nextRoute = window.location.pathname;
    handleRouter();
  });
  //    pushState,replaceState 函数重写

  const rawPushState = window.history.pushState;
  window.history.pushState = (...args) => {
    // 导航前
    preRoute = window.location.pathname;
    rawPushState.apply(window.history, args); // 改变历史记录
    // 导航后
    nextRoute = window.location.pathname;

    handleRouter();
  };

  const rawReplaceState = window.history.replaceState;
  window.history.replaceState = (...args) => {
    // 导航前
    preRoute = window.location.pathname;
    rawReplaceState.apply(window.history, args); // 改变历史记录
    // 导航后
    nextRoute = window.location.pathname;
    handleRouter();
  };
};
