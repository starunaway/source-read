# import-html-entry 源码阅读

import-html-entry 可以动态获取 html 内容以及解析 html，可以用于手动加载前端的静态资源。该库主要对外暴露了三个函数:importHTML importEntry execScripts,代码相对来说并不太复杂，约 6/700 行的样子，现在就来初窥一下其实现过程

## importHTML

```JS
export default function importHTML(url, opts = {}) {
 let fetch = defaultFetch;
 let autoDecodeResponse = false;
 let getPublicPath = defaultGetPublicPath;
 let getTemplate = defaultGetTemplate;
 const { postProcessTemplate } = opts;


 return fetch(url)
 // 文件格式解析， 兼容 utf-8 / blob,其中 blob使用 window.FileReader().readAsText
  .then(response => readResAsString(response, autoDecodeResponse))
  .then(html => {

   const assetPublicPath = getPublicPath(url);
   /*
      processTpl 用于解析获取到的html字符串，主要是收集script / link /style标签
      scripts: [脚本地址  或者 代码块],
      styles: [样式的http地址 或者内联样式],
   */
   const { template, scripts, entry, styles } = processTpl(html, assetPublicPath, postProcessTemplate);

   /**
    * getEmbedHTML 返回一个包含完整style的html文本，script没有处理
    * 最后整个函数返回一个对象，用于运行时执行操作
   */
   return getEmbedHTML(template, styles, { fetch }).then(embedHTML => ({
    template: embedHTML,
    assetPublicPath,
    getExternalScripts: () => getExternalScripts(scripts, fetch),
    getExternalStyleSheets: () => getExternalStyleSheets(styles, fetch),
    execScripts: (proxy, strictGlobal, execScriptsHooks = {}) => {
     if (!scripts.length) {
      return Promise.resolve();
     }
     return execScripts(entry, scripts, proxy, {
      fetch,
      strictGlobal,
      beforeExec: execScriptsHooks.beforeExec,
      afterExec: execScriptsHooks.afterExec,
     });
    },
   }));
  }));
}
```

## importEntry

和 importHTML 类似，只不过在 entry 是非 string 的情况下单独处理了一下，相当与手动添加了一些待处理的 style/link/script 标签

```TS
export function importEntry(entry, opts = {}) {
 const { fetch = defaultFetch, getTemplate = defaultGetTemplate, postProcessTemplate } = opts;
 const getPublicPath = opts.getPublicPath || opts.getDomain || defaultGetPublicPath;

 // html entry
 if (typeof entry === 'string') {
  return importHTML(entry, {
   fetch,
   getPublicPath,
   getTemplate,
   postProcessTemplate,
  });
 }

 // config entry
 if (Array.isArray(entry.scripts) || Array.isArray(entry.styles)) {

  const { scripts = [], styles = [], html = '' } = entry;
  const getHTMLWithStylePlaceholder = tpl => styles.reduceRight((html, styleSrc) => `${genLinkReplaceSymbol(styleSrc)}${html}`, tpl);
  const getHTMLWithScriptPlaceholder = tpl => scripts.reduce((html, scriptSrc) => `${html}${genScriptReplaceSymbol(scriptSrc)}`, tpl);

  return getEmbedHTML(getTemplate(getHTMLWithScriptPlaceholder(getHTMLWithStylePlaceholder(html))), styles, { fetch }).then(embedHTML => ({
   template: embedHTML,
   assetPublicPath: getPublicPath(entry),
   getExternalScripts: () => getExternalScripts(scripts, fetch),
   getExternalStyleSheets: () => getExternalStyleSheets(styles, fetch),
   execScripts: (proxy, strictGlobal, execScriptsHooks = {}) => {
    if (!scripts.length) {
     return Promise.resolve();
    }
    return execScripts(scripts[scripts.length - 1], scripts, proxy, {
     fetch,
     strictGlobal,
     beforeExec: execScriptsHooks.beforeExec,
     afterExec: execScriptsHooks.afterExec,
    });
   },
  }));

 }
}

```

## execScripts

执行获取到的 script 字符串，时尚就是

```TS
export function execScripts(entry, scripts, proxy = window, opts = {}) {
 const {
  fetch = defaultFetch, strictGlobal = false, success, error = () => {
  }, beforeExec = () => {
  }, afterExec = () => {
  },
 } = opts;

// 获取script的内容
 return getExternalScripts(scripts, fetch, error)
  .then(scriptsText => {

   const geval = (scriptSrc, inlineScript) => {
    const rawCode = beforeExec(inlineScript, scriptSrc) || inlineScript;
 //
    const code = getExecutableScript(scriptSrc, rawCode, proxy, strictGlobal);

    evalCode(scriptSrc, code);

    afterExec(inlineScript, scriptSrc);
   };

   function exec(scriptSrc, inlineScript, resolve) {


    if (scriptSrc === entry) {
     noteGlobalProps(strictGlobal ? proxy : window);

     try {
      // bind window.proxy to change `this` reference in script
      geval(scriptSrc, inlineScript);
      const exports = proxy[getGlobalProp(strictGlobal ? proxy : window)] || {};
      resolve(exports);
     } catch (e) {
      // entry error must be thrown to make the promise settled
      console.error(`[import-html-entry]: error occurs while executing entry script ${scriptSrc}`);
      throw e;
     }
    } else {
     if (typeof inlineScript === 'string') {
      try {
       // bind window.proxy to change `this` reference in script
       geval(scriptSrc, inlineScript);
      } catch (e) {
       // consistent with browser behavior, any independent script evaluation error should not block the others
       throwNonBlockingError(e, `[import-html-entry]: error occurs while executing normal script ${scriptSrc}`);
      }
     } else {
      // external script marked with async
      inlineScript.async && inlineScript?.content
       .then(downloadedScriptText => geval(inlineScript.src, downloadedScriptText))
       .catch(e => {
        throwNonBlockingError(e, `[import-html-entry]: error occurs while executing async script ${inlineScript.src}`);
       });
     }
    }


   }

 // 所有 schedule 依次执行。exec是同步调用，不需要设置promise
   function schedule(i, resolvePromise) {

    if (i < scripts.length) {
     const scriptSrc = scripts[i];
     const inlineScript = scriptsText[i];

     exec(scriptSrc, inlineScript, resolvePromise);
     // resolve the promise while the last script executed and entry not provided
     if (!entry && i === scripts.length - 1) {
      resolvePromise();
     } else {
      schedule(i + 1, resolvePromise);
     }
    }
   }

   return new Promise(resolve => schedule(0, success || resolve));
  });
}
```

## getExecutableScript

```TS
function getExecutableScript(scriptSrc, scriptText, proxy, strictGlobal) {
 const sourceUrl = isInlineCode(scriptSrc) ? '' : `//# sourceURL=${scriptSrc}\n`;

 // 通过这种方式获取全局 window，因为 script 也是在全局作用域下运行的，所以我们通过 window.proxy 绑定时也必须确保绑定到全局 window 上
 // 否则在嵌套场景下， window.proxy 设置的是内层应用的 window，而代码其实是在全局作用域运行的，会导致闭包里的 window.proxy 取的是最外层的微应用的 proxy
 const globalWindow = (0, eval)('window');
 globalWindow.proxy = proxy;

 // 生成用于eval执行的js字符串

 return strictGlobal
  ? `;(function(window, self, globalThis){with(window){;${scriptText}\n${sourceUrl}}}).bind(window.proxy)(window.proxy, window.proxy, window.proxy);`
  : `;(function(window, self, globalThis){;${scriptText}\n${sourceUrl}}).bind(window.proxy)(window.proxy, window.proxy, window.proxy);`;
}
```

## processTpl

```TS
export default function processTpl(tpl, baseURI, postProcessTemplate) {

 let scripts = [];
 const styles = [];
 let entry = null;
 const moduleSupport = isModuleScriptSupported();

 const template = tpl

  /*
  移除 html 模版中的注释内容 <!-- xx -->
  */
  .replace(HTML_COMMENT_REGEX, '')
   // link 标签
  .replace(LINK_TAG_REGEX, match => {
   // <link rel = "stylesheet" />
   const styleType = !!match.match(STYLE_TYPE_REGEX);
   if (styleType) {
    // <link rel = "stylesheet" href = "xxx" />
    const styleHref = match.match(STYLE_HREF_REGEX);
    // <link rel = "stylesheet" ignore />
    const styleIgnore = match.match(LINK_IGNORE_REGEX);

    if (styleHref) {
  const href = styleHref && styleHref[2];
     let newHref = href;

     // 如果 href 没有协议说明是相对地址，需要拼接 baseURI 得到绝对地址，可以直接粘贴到url访问的那种
     if (href && !hasProtocol(href)) {
      newHref = getEntirePath(href, baseURI);
     }
     if (styleIgnore) {
      // 换成注释
      return genIgnoreAssetReplaceSymbol(newHref);
     }
     // 保存href用于后续加载，并将该link换成注释
     styles.push(newHref);
     return genLinkReplaceSymbol(newHref);
    }
   }
   // <link rel = "preload or prefetch" href = "xxx" /> 预加载资源
   const preloadOrPrefetchType = match.match(LINK_PRELOAD_OR_PREFETCH_REGEX) && match.match(LINK_HREF_REGEX) && !match.match(LINK_AS_FONT);
   if (preloadOrPrefetchType) {
    const [, , linkHref] = match.match(LINK_HREF_REGEX);
    // 将 preload link 替换成锚点注释
    return genLinkReplaceSymbol(linkHref, true);
   }

   return match;
  })
  // 匹配 <style></style>
  .replace(STYLE_TAG_REGEX, match => {
   if (STYLE_IGNORE_REGEX.test(match)) {
    //  将<style ignore>xxx</style> 变成 <!-- ignore asset style file replaced by import-html-entry -->
    return genIgnoreAssetReplaceSymbol('style file');
   }
   return match;
  })
  // 匹配 <script></script>
  .replace(ALL_SCRIPT_REGEX, (match, scriptTag) => {
   // <script ignore></script>
   const scriptIgnore = scriptTag.match(SCRIPT_IGNORE_REGEX);
  //  <script nomodule></script> 或者 <script type = "module"></script>
   const moduleScriptIgnore =
    (moduleSupport && !!scriptTag.match(SCRIPT_NO_MODULE_REGEX)) ||
    (!moduleSupport && !!scriptTag.match(SCRIPT_MODULE_REGEX));
   // <script type = "xx" />
   const matchedScriptTypeMatch = scriptTag.match(SCRIPT_TYPE_REGEX);
   const matchedScriptType = matchedScriptTypeMatch && matchedScriptTypeMatch[2];
   if (!isValidJavaScriptType(matchedScriptType)) {
    // type不合法，跳过
    return match;
   }

   // if it is a external script
   if (SCRIPT_TAG_REGEX.test(match) && scriptTag.match(SCRIPT_SRC_REGEX)) {
    /*
    collect scripts and replace the ref
    */

    // <script entry />
    const matchedScriptEntry = scriptTag.match(SCRIPT_ENTRY_REGEX);
    // <script src = "xx" />
    const matchedScriptSrcMatch = scriptTag.match(SCRIPT_SRC_REGEX);
    let matchedScriptSrc = matchedScriptSrcMatch && matchedScriptSrcMatch[2];

    if (entry && matchedScriptEntry) {
     throw new SyntaxError('You should not set multiply entry script!');
    } else {

     // 同link，如果没有协议，说明是一个相对路径，需要补全
     if (matchedScriptSrc && !hasProtocol(matchedScriptSrc)) {
      matchedScriptSrc = getEntirePath(matchedScriptSrc, baseURI);
     }

     entry = entry || matchedScriptEntry && matchedScriptSrc;
    }

    // 匹配到的外链地址换成锚点，加载之后替换回来
    if (scriptIgnore) {
     return genIgnoreAssetReplaceSymbol(matchedScriptSrc || 'js file');
    }

    if (moduleScriptIgnore) {
     return genModuleScriptReplaceSymbol(matchedScriptSrc || 'js file', moduleSupport);
    }

    if (matchedScriptSrc) {
     const asyncScript = !!scriptTag.match(SCRIPT_ASYNC_REGEX);
     scripts.push(asyncScript ? { async: true, src: matchedScriptSrc } : matchedScriptSrc);
     return genScriptReplaceSymbol(matchedScriptSrc, asyncScript);
    }

    return match;
   } else {
    if (scriptIgnore) {
     return genIgnoreAssetReplaceSymbol('js file');
    }

    if (moduleScriptIgnore) {
     return genModuleScriptReplaceSymbol('js file', moduleSupport);
    }

    // 内联script，获取内部的js
    const code = getInlineCode(match);

    // remove script blocks when all of these lines are comments.
    const isPureCommentBlock = code.split(/[\r\n]+/).every(line => !line.trim() || line.trim().startsWith('//'));

    if (!isPureCommentBlock) {
     scripts.push(match);
    }

    return inlineScriptReplaceSymbol;
   }
  });

 scripts = scripts.filter(function (script) {
  // filter empty script
  return !!script;
 });

 let tplResult = {
  template,
  scripts,
  styles,
  // set the last script as entry if have not set
  entry: entry || scripts[scripts.length - 1],
 };
 if (typeof postProcessTemplate === 'function') {
  tplResult = postProcessTemplate(tplResult);
 }

 return tplResult;
}

```
