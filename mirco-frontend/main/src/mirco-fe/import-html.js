// qiankun 用的是 import-html-extry
import {fetchResorce} from './fetch-resource';

export const importHtml = async (url) => {
  const html = await fetchResorce(url);
  const template = document.createElement('div');
  template.innerHTML = html;
  // 1. csr需要执行js生成内容
  // 2. 浏览器处于安全考虑，innerHTML中的script不会加载执行

  const scripts = template.querySelectorAll('script');

  // 获取所有script标签的代码
  async function getExternalScripts() {
    return Promise.all(
      Array.from(scripts).map((script) => {
        const src = script.getAttribute('src');
        if (!src) {
          // 直接写的script
          return Promise.resolve(script.innerHTML);
        } else {
          return fetchResorce(src.startsWith('http') ? src : `${url}${src}`);
        }
      })
    );
  }

  // 获取并指向所有script脚本代码
  async function execScripts() {
    const scripts = await getExternalScripts();

    // 手动构建 CommonJS环境
    const module = {exports: {}};
    const exports = module.exports;

    scripts.forEach((code) => {
      eval(code);
    });

    return module.exports;
  }

  return {
    template,
    getExternalScripts,
    execScripts,
  };
};
