import {handleRouter} from './handle-router';

export const rewriteRouter = () => {
  window.addEventListener('popstate', () => {
    console.log('popstate');
    handleRouter();
  });
  //    pushState,replaceState 函数重写

  const rawPushState = window.history.pushState;
  window.history.pushState = (...args) => {
    rawPushState.apply(window.history, args);
    console.log('pushState');
    handleRouter();
  };

  const rawReplaceState = window.history.replaceState;
  window.history.replaceState = (...args) => {
    rawReplaceState.apply(window.history, args);
    console.log('replaceState');
    handleRouter();
  };
};
