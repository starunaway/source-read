import {getApps} from '.';
import {importHtml} from './import-html';
export const handleRouter = async () => {
  // 2. 匹配子应用
  // 2.1获取当前路径
  // 2.2 去apps里面找
  const apps = getApps();
  const app = apps.find((item) => window.location.pathname.startsWith(item.activeRule));

  if (!app) {
    return;
  }

  // 3. 加载子应用
  // 请求子应用的资源： html css js

  const {template, getExternalScripts, execScripts} = await importHtml(app.entry);

  const container = document.querySelector(app.container);
  container.appendChild(template);

  // 手动加载子应用script
  // eval or new Function

  execScripts();

  // 4.渲染子应用
};
