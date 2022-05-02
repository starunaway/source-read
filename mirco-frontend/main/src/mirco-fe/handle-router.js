import {getApps} from '.';
import {importHtml} from './import-html';

import {getPreRoute, getNextRoute} from './rewrite-router';

export const handleRouter = async () => {
  // 卸载之前的应用
  const apps = getApps();

  const preApp = apps.find((item) => {
    return getPreRoute().startsWith(item.activeRule);
  });

  // 2. 匹配子应用
  // 2.1获取当前路径
  // 2.2 去apps里面找
  const app = apps.find((item) => getNextRoute().startsWith(item.activeRule));

  if (preApp) {
    await unmount(preApp);
  }

  if (!app) {
    return;
  }

  // 3. 加载子应用
  // 请求子应用的资源： html css js

  const {template, getExternalScripts, execScripts} = await importHtml(app.entry);

  const container = document.querySelector(app.container);
  container.appendChild(template);

  // 配置全局变量

  window.__mirco_frontend = true;
  window.__INJECT_PUBLIC_PATH__ = app.entry + '/';

  // 手动加载子应用script
  // eval or new Function

  const appExports = await execScripts();

  app.bootstrap = appExports.bootstrap;
  app.mount = appExports.mount;
  app.unmount = appExports.unmount;

  // 4.渲染子应用

  bootstrap(app);

  mount(app);
};

async function bootstrap(app) {
  await app?.bootstrap();
}

async function mount(app) {
  await app?.mount({
    container: document.querySelector(app.container),
  });
}

async function unmount(app) {
  await app?.unmount({
    container: document.querySelector(app.container),
  });
  document.querySelector(app.container).innerHTML = '';
}
