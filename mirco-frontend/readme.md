# 微前端之乾坤源码阅读

## 功能概述

主要是主应用-子应用加载,应用间通信，样式隔离，JS 沙箱

apis.ts 导出了常用的 loadMicroApp, registerMicroApps, start，用于应用渲染

globalState.ts 导出 initGlobalState 用于通信，发布订阅模式

sandbox.ts 导出 getCurrentRunningApp 用于 js 沙箱

## apis.ts

### registerMicroApps 注册子应用

```TS

interface RegistrableApp {
 name :string,
 entry : string | { scripts?: string[]; styles?: string[]; html?: string },
 container: string | HTMLElement
 activeRule: string | (location: Location) => boolean | Array<string | (location: Location) => boolean>
 loader?: (loading: boolean) => void
 props?: object  // 主应用需要传递给微应用的数据。
}

type Lifecycle = (app: RegistrableApp) => Promise<any>;

interface FrameworkLifeCycles {
  beforeLoad?: LifeCycleFn<T> | Array<LifeCycleFn<T>>; // function before app load
  beforeMount?: LifeCycleFn<T> | Array<LifeCycleFn<T>>; // function before app mount
  afterMount?: LifeCycleFn<T> | Array<LifeCycleFn<T>>; // function after app mount
  beforeUnmount?: LifeCycleFn<T> | Array<LifeCycleFn<T>>; // function before app unmount
  afterUnmount?: LifeCycleFn<T> | Array<LifeCycleFn<T>>; // function after app unmount
}

export function registerMicroApps<T extends ObjectType>(
  apps: Array<RegistrableApp<T>>,
  lifeCycles?: FrameworkLifeCycles<T>, //全局的微应用生命周期钩子
) {
  // 每个子应用只能注册一次
  const unregisteredApps = apps.filter((app) => !microApps.some((registeredApp) => registeredApp.name === app.name));

  microApps = [...microApps, ...unregisteredApps];

  unregisteredApps.forEach((app) => {
    const { name, activeRule, loader = noop, props, ...appConfig } = app;

    //  注册某个具体的子应用
    registerApplication({
      name,
      app: async () => {
        loader(true);
        await frameworkStartedDefer.promise;

        const { mount, ...otherMicroAppConfigs } = (
          await loadApp({ name, props, ...appConfig }, frameworkConfiguration, lifeCycles)
        )();

        return {
          mount: [async () => loader(true), ...toArray(mount), async () => loader(false)],
          ...otherMicroAppConfigs,
        };
      },
      activeWhen: activeRule,
      customProps: props,
    });
  });
}

```

registerApplication 是 single-spa 的 api，主要功能就是保存注册的子应用

### start 启动子应用

```TS
 type PrefetchStrategy =
  | boolean
  | 'all'
  | string[] // 指定需要prefetch的子应用
  | ((apps: AppMetadata[]) => { criticalAppNames: string[]; minorAppsName: string[] });

interface FrameworkConfiguration {
  prefetch?: PrefetchStrategy;
  sandbox?:
    | boolean
    | {
        strictStyleIsolation?: boolean;  // shadow dom 样式隔离
        experimentalStyleIsolation?: boolean;  // data[XXX-SXXX] 选择器做样式隔离
      };
  /*
    with singular mode, 一次只渲染一个子应用， 页面看起来更好
  */
  singular?: boolean | ((app: LoadableApp<any>) => Promise<boolean>);
  /**
   * skip some scripts or links intercept, like JSONP
   */
  excludeAssetFilter?: (url: string) => boolean;


  // ImportEntryOpts
  // 加载html 字符串参数
  fetch?: typeof window.fetch | { fn?: typeof window.fetch, autoDecodeResponse?: boolean }
  getPublicPath?: (entry: Entry) => string;
  getTemplate?: (tpl: string) => string;
  postProcessTemplate?: (tplResult: TemplateResult) => TemplateResult;
  // single-spa
  urlRerouteOnly?: boolean;

}

export function start(opts: FrameworkConfiguration = {}) {
  frameworkConfiguration = { prefetch: true, singular: true, sandbox: true, ...opts };
  const {
    prefetch,
    sandbox,
    singular,
    urlRerouteOnly = defaultUrlRerouteOnly,
    ...importEntryOpts
  } = frameworkConfiguration;

  if (prefetch) {
	// 执行 prefetch，浏览器特性
    doPrefetchStrategy(microApps, prefetch, importEntryOpts);
  }

  // 兼容低版本浏览器
  frameworkConfiguration = autoDowngradeForLowVersionBrowser(frameworkConfiguration);

  startSingleSpa({ urlRerouteOnly });
  started = true;

  frameworkStartedDefer.resolve();
}

```

可以看到，启动应用的时候做了一定的优化，之后就是开始渲染子应用了

#### 优化 doPrefetchStrategy

```TS
// single-spa
export function doPrefetchStrategy(
  apps: AppMetadata[],
  prefetchStrategy: PrefetchStrategy,
  importEntryOpts?: ImportEntryOpts,
) {
  const appsName2Apps = (names: string[]): AppMetadata[] => apps.filter((app) => names.includes(app.name));

  if (Array.isArray(prefetchStrategy)) {
    prefetchAfterFirstMounted(appsName2Apps(prefetchStrategy as string[]), importEntryOpts);
  } else if (isFunction(prefetchStrategy)) {
    (async () => {
      // critical rendering apps would be prefetch as earlier as possible
      const { criticalAppNames = [], minorAppsName = [] } = await prefetchStrategy(apps);
      prefetchImmediately(appsName2Apps(criticalAppNames), importEntryOpts);
      prefetchAfterFirstMounted(appsName2Apps(minorAppsName), importEntryOpts);
    })();
  } else {
    switch (prefetchStrategy) {
      case true:
        prefetchAfterFirstMounted(apps, importEntryOpts);
        break;

      case 'all':
        prefetchImmediately(apps, importEntryOpts);
        break;

      default:
        break;
    }
  }
}
```

核心是 prefetchAfterFirstMounted 和 prefetchImmediately 两个函数，没有本质区别。 prefetchAfterFirstMounted 会监听 single-spa:first-mount 事件，事件触发后进行 prefetch，prefetchImmediately 会立刻加载。

> 配置为 true 则会在第一个微应用 mount 完成后开始预加载其他微应用的静态资源  
> 配置为 'all' 则主应用 start 后即开始预加载所有微应用静态资源  
> 配置为 string[] 则会在第一个微应用 mounted 后开始加载数组内的微应用资源  
> 配置为 function 则可完全自定义应用的资源加载时机 (首屏应用及次屏应用)

```TS
function prefetchAfterFirstMounted(apps: AppMetadata[], opts?: ImportEntryOpts): void {
  window.addEventListener('single-spa:first-mount', function listener() {
    const notLoadedApps = apps.filter((app) => getAppStatus(app.name) === NOT_LOADED);

    notLoadedApps.forEach(({ entry }) => prefetch(entry, opts));

    window.removeEventListener('single-spa:first-mount', listener);
  });
}

export function prefetchImmediately(apps: AppMetadata[], opts?: ImportEntryOpts): void {

  apps.forEach(({ entry }) => prefetch(entry, opts));
}

```

```TS
function prefetch(entry: Entry, opts?: ImportEntryOpts): void {
  if (!navigator.onLine || isSlowNetwork) {
    // Don't prefetch if in a slow network or offline
    return;
  }

  requestIdleCallback(async () => {
    const { getExternalScripts, getExternalStyleSheets } = await importEntry(entry, opts);
    requestIdleCallback(getExternalStyleSheets);
    requestIdleCallback(getExternalScripts);
  });
}
```

其实就是 RIC 轮询请求前端静态资源
具体的逻辑可以查看 [import-html-entry 源码解读](./ImportEntry.md)

### startSingleSpa

`import { start as startSingleSpa } from 'single-spa';`

可以看到 qiankun 就是调用了 single-spa 启动子应用,详情可以查看 [single-spa 源码解读](./SingleSpa.md)

```TS
// single-spa
export function start(opts) {
  started = true;
  if (opts && opts.urlRerouteOnly) {
    setUrlRerouteOnly(opts.urlRerouteOnly);
  }
  if (isInBrowser) {
    reroute();
  }
}

```

## globalState.ts

### initGlobalState

定义全局状态，并返回通信方法，建议在主应用使用，微应用通过 props 获取通信方法

```TS

type OnGlobalStateChangeCallback = (state: Record<string, any>, prevState: Record<string, any>) => void;

// 事件中心
const deps: Record<string, OnGlobalStateChangeCallback> = {};

export function initGlobalState(state: Record<string, any> = {}) {
  const prevGlobalState = cloneDeep(globalState);
  globalState = cloneDeep(state);
  emitGlobal(globalState, prevGlobalState);
  return getMicroAppStateActions(`global-${+new Date()}`, true);
}


// 触发全局监听
function emitGlobal(state: Record<string, any>, prevState: Record<string, any>) {
  Object.keys(deps).forEach((id: string) => {
    if (deps[id] instanceof Function) {
      deps[id](cloneDeep(state), cloneDeep(prevState));
    }
  });
}

```

initGlobalState 时初始化 state，返回一个对象，可以

```TS
export function getMicroAppStateActions(id: string, isMaster?: boolean): MicroAppStateActions {
  return {
    /**
     * onGlobalStateChange 全局依赖监听
     *
     * 收集 setState 时所需要触发的依赖
     *
     * 限制条件：每个子应用只有一个激活状态的全局监听，新监听覆盖旧监听，若只是监听部分属性，请使用 onGlobalStateChange
     *
     * 这么设计是为了减少全局监听滥用导致的内存爆炸
     *
     * 依赖数据结构为：
     * {
     *   {id}: callback
     * }
     *
     * @param callback
     * @param fireImmediately
     */
    onGlobalStateChange(callback: OnGlobalStateChangeCallback, fireImmediately?: boolean) {
      if (!(callback instanceof Function)) {
        console.error('[qiankun] callback must be function!');
        return;
      }
      if (deps[id]) {
        console.warn(`[qiankun] '${id}' global listener already exists before this, new listener will overwrite it.`);
      }
      deps[id] = callback;
      if (fireImmediately) {
        const cloneState = cloneDeep(globalState);
        callback(cloneState, cloneState);
      }
    },

    /**
     * setGlobalState 更新 store 数据
     *
     * 1. 对输入 state 的第一层属性做校验，只有初始化时声明过的第一层（bucket）属性才会被更改
     * 2. 修改 store 并触发全局监听
     *
     * @param state
     */
    setGlobalState(state: Record<string, any> = {}) {
      if (state === globalState) {
        console.warn('[qiankun] state has not changed！');
        return false;
      }

      const changeKeys: string[] = [];
      const prevGlobalState = cloneDeep(globalState);
      globalState = cloneDeep(
        Object.keys(state).reduce((_globalState, changeKey) => {
          if (isMaster || _globalState.hasOwnProperty(changeKey)) {
            changeKeys.push(changeKey);
            return Object.assign(_globalState, { [changeKey]: state[changeKey] });
          }
          console.warn(`[qiankun] '${changeKey}' not declared when init state！`);
          return _globalState;
        }, globalState),
      );
      if (changeKeys.length === 0) {
        console.warn('[qiankun] state has not changed！');
        return false;
      }
      emitGlobal(globalState, prevGlobalState);
      return true;
    },

    // 注销该应用下的依赖
    offGlobalStateChange() {
      delete deps[id];
      return true;
    },
  };
}

```

## sandbox.ts

### getCurrentRunningApp 用于 js 沙箱
