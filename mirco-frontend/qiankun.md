# 微前端之乾坤源码阅读

## 功能概述

qiankun 主要实现了主应用-子应用加载,应用间通信，样式隔离，JS 沙箱

apis.ts 导出了常用的 loadMicroApp, registerMicroApps, start，用于应用渲染

globalState.ts 导出 initGlobalState 用于通信，发布订阅模式

sandbox.ts 导出 getCurrentRunningApp 用于 实现 js/css 沙箱

## apis.ts

### registerMicroApps 注册子应用

```TS

interface RegistrableApp {
 name :string,
 entry : string | { scripts?: string[]; styles?: string[]; html?: string },
 container: string | HTMLElement  // 或者一个自定义的render函数
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

registerApplication 是 single-spa 的 api，主要功能就是保存注册的子应用。registerApplication 的 app 属性是一个 async 函数，用来加载前端的静态资源。这部分逻辑被 qiankun 接管了，主要是用来实现沙箱，在下文 sandbox 源码中再详细阐述

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

initGlobalState 时初始化 state，返回一个对象，可以用来注册/注销父子应用间通信。state 需要主/子应用自己管理，qiankun 没有提供管理的方法

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

在上文 registerApplication 中有讲到 qiankun 重新封装了加载静态资源的逻辑，也就是为了实现 js/css 的沙箱。其入口是 loadApp，我们先从这个函数看起。这个函数的实现还是比较复杂的，有 200 多行。阅读时只看核心逻辑即可。

```TS
export async function loadApp<T extends ObjectType>(
  app: LoadableApp<T>,
  configuration: FrameworkConfiguration = {},
  lifeCycles?: FrameworkLifeCycles<T>,
): Promise<ParcelConfigObjectGetter> {
  const { entry, name: appName } = app;
  const appInstanceId = genAppInstanceIdByName(appName);


  const {
    singular = false,
    sandbox = true,
    excludeAssetFilter,
    globalContext = window,
    ...importEntryOpts
  } = configuration;

  // 具体的逻辑可以查看 import-html-entry 源码解读
  const { template, execScripts, assetPublicPath } = await importEntry(entry, importEntryOpts);

// 生成子应用的html字符串
  const appContent = getDefaultTplWrapper(appInstanceId)(template);

// 使用shadow-dom实现css样式隔离
  const strictStyleIsolation = typeof sandbox === 'object' && !!sandbox.strictStyleIsolation;

// 使用css-scope 实现样式隔离，在div上添加data[XXX]属性作为选择器，类似vue scope
  const scopedCSS = isEnableScopedCSS(sandbox);
  //  createElement 可以看下文的细节详解
  let initialAppWrapperElement: HTMLElement | null = createElement(
    appContent,
    strictStyleIsolation,
    scopedCSS,
    appInstanceId,
  );

  const initialContainer = 'container' in app ? app.container : undefined;
  const legacyRender = 'render' in app ? app.render : undefined;

  // 渲染子应用逻辑，主要工作是预先清除 container的其他内容，如果子应用卸载的时候没有清除，会执行清除过程并给用户一个错误提醒
  const render = getRender(appInstanceId, appContent, legacyRender);

  // 第一次加载设置应用可见区域 dom 结构
  // 确保每次应用加载前容器 dom 结构已经设置完毕
  render({ element: initialAppWrapperElement, loading: true, container: initialContainer }, 'loading');

  //获取子应用的dom节点，如果是shadow-dom，返回的是挂载节点的shadowRoot
  const initialAppWrapperGetter:Function = getAppWrapperGetter(
    appInstanceId,
    !!legacyRender,
    strictStyleIsolation,
    scopedCSS,
    () => initialAppWrapperElement,
  );

  let global = globalContext;
  let mountSandbox = () => Promise.resolve();
  let unmountSandbox = () => Promise.resolve();
  const useLooseSandbox = typeof sandbox === 'object' && !!sandbox.loose;
  let sandboxContainer;
  // 这里是创建js沙箱，实现js的隔离
  if (sandbox) {
    // createSandboxContainer 就是sandbox.ts的主要逻辑了
    sandboxContainer = createSandboxContainer(
      appInstanceId,
      initialAppWrapperGetter,
      scopedCSS,
      useLooseSandbox,
      excludeAssetFilter,
      global,
    );
    // 用沙箱的代理对象作为接下来使用的全局对象
    global = sandboxContainer.instance.proxy as typeof window;
    mountSandbox = sandboxContainer.mount;
    unmountSandbox = sandboxContainer.unmount;
  }

// 生命周期函数，主应用在对应的生命周期里注入了一些逻辑，就两点：
//    global.__POWERED_BY_QIANKUN__ = true   标识乾坤环境
//    global.__INJECTED_PUBLIC_PATH_BY_QIANKUN__ = publicPath  webpack运行时的publicPath
  const {
    beforeUnmount = [],
    afterUnmount = [],
    afterMount = [],
    beforeMount = [],
    beforeLoad = [],
  } = mergeWith({}, getAddOns(global, assetPublicPath), lifeCycles, (v1, v2) => concat(v1 ?? [], v2 ?? []));

// beforeLoad链式调用，类似redux的compose函数，钩子函数相互独立，不需要继续传递
  await execHooksChain(toArray(beforeLoad), app, global);

  // 在沙箱内执行每个子应用的script内容
  // eval可以访问外部上下文，所以可以使子应用注册的生命周期放到沙箱的全局上下文内
  const scriptExports: any = await execScripts(global, sandbox && !useLooseSandbox);
  const { bootstrap, mount, unmount, update } = getLifecyclesFromExports(
    scriptExports,
    appName,
    global,
    sandboxContainer?.instance?.latestSetProp,
  );

  const { onGlobalStateChange, setGlobalState, offGlobalStateChange }: Record<string, CallableFunction> =
    getMicroAppStateActions(appInstanceId);

   // 每次子应用切换的时候，主应用要保存当期子应用的dom
  const syncAppWrapperElement2Sandbox = (element: HTMLElement | null) => (initialAppWrapperElement = element);

//主应用需要处理切换逻辑，在此注入完整的生命周期逻辑
  const parcelConfigGetter: ParcelConfigObjectGetter = (remountContainer = initialContainer) => {
    let appWrapperElement: HTMLElement | null;
    let appWrapperGetter: ReturnType<typeof getAppWrapperGetter>;

    const parcelConfig: ParcelConfigObject = {
      name: appInstanceId,
      bootstrap,
      // 封装成single-spa的生命周期
      mount: [

        async () => {
          //需要等前一个子应用卸载
          if ((await validateSingularMode(singular, app)) && prevAppUnmountedDeferred) {
            return prevAppUnmountedDeferred.promise;
          }

          return undefined;
        },
        // 创建新的子应用前要初始化挂载节点，dom or shadowRoot
        async () => {
          appWrapperElement = initialAppWrapperElement;
          appWrapperGetter = getAppWrapperGetter(
            appInstanceId,
            !!legacyRender,
            strictStyleIsolation,
            scopedCSS,
            () => appWrapperElement,
          );
        },
        // 添加 mount hook, 确保每次应用加载前容器 dom 结构已经设置完毕
        async () => {
          const useNewContainer = remountContainer !== initialContainer;
          if (useNewContainer || !appWrapperElement) {
            // 子应用卸载之后就没有了，需要重新创建
            // 如果使用了新的 Container，也得重新创建（比如两个子应用的container id 不一样）
            appWrapperElement = createElement(appContent, strictStyleIsolation, scopedCSS, appInstanceId);
            syncAppWrapperElement2Sandbox(appWrapperElement);
          }

          render({ element: appWrapperElement, loading: true, container: remountContainer }, 'mounting');
        },
        mountSandbox,
        // exec the chain after rendering to keep the behavior with beforeLoad
        async () => execHooksChain(toArray(beforeMount), app, global),
        // 子应用的逻辑，注入了 GlobalState用于和主应用通信
        async (props) => mount({ ...props, container: appWrapperGetter(), setGlobalState, onGlobalStateChange }),
        // finish loading after app mounted
        async () => render({ element: appWrapperElement, loading: false, container: remountContainer }, 'mounted'),
        async () => execHooksChain(toArray(afterMount), app, global),
        // initialize the unmount defer after app mounted and resolve the defer after it unmounted
        async () => {
          if (await validateSingularMode(singular, app)) {
            prevAppUnmountedDeferred = new Deferred<void>();
          }
        },

      ],
      unmount: [
        async () => execHooksChain(toArray(beforeUnmount), app, global),
        async (props) => unmount({ ...props, container: appWrapperGetter() }),
        unmountSandbox,
        async () => execHooksChain(toArray(afterUnmount), app, global),
        async () => {
          render({ element: null, loading: false, container: remountContainer }, 'unmounted');
          offGlobalStateChange(appInstanceId);
          // for gc
          appWrapperElement = null;
          syncAppWrapperElement2Sandbox(appWrapperElement);
        },
        async () => {
          if ((await validateSingularMode(singular, app)) && prevAppUnmountedDeferred) {
            prevAppUnmountedDeferred.resolve();
          }
        },
      ],
    };

    if (typeof update === 'function') {
      parcelConfig.update = update;
    }

    return parcelConfig;
  };

  return parcelConfigGetter;
}

```

### createSandboxContainer 用于 创建 js 沙箱

qiankun 中保存了每个子应用的上下文，即子应用对 window 的修改。其主要思想是子应用 bootstrap 后，记录此时子应用的上下文，在子应用卸载后，将该子应用的上下文还原到 bootstrap 的那一刻。在上文 loadApp 的讲解中，也可以看到 mountSandbox 也即 sandbox.active 的运行是在子应用的 beforeMount 之前，也即时序是 renderDom(mounting，子应用已经执行 csr，dom 已生成)-> mountSandbox() -> 子应用的 beforeMount -> renderDom(mounted)。这里执行了两次 renderDom，但内部的执行逻辑只有第一次有效，多次执行是为了给自定义的 legacyRender 传递 loading 状态和子应用渲染阶段，qiankun 本身没有这个逻辑。

```TS
/*
 * 生成应用运行时沙箱
 *
 * 沙箱分两个类型：
 * 1. app 环境沙箱
 *  app 环境沙箱是指应用初始化过之后，应用会在什么样的上下文环境运行。每个应用的环境沙箱只会初始化一次，因为子应用只会触发一次 bootstrap 。
 *  子应用在切换时，实际上切换的是 app 环境沙箱。
 * 2. render 沙箱
 *  子应用在 app mount 开始前生成好的的沙箱。每次子应用切换过后，render 沙箱都会重现初始化。
 *
 * 这么设计的目的是为了保证每个子应用切换回来之后，还能运行在应用 bootstrap 之后的环境下。
 * */
export function createSandboxContainer(
  appName: string,
  elementGetter: () => HTMLElement | ShadowRoot,
  scopedCSS: boolean,
  useLooseSandbox?: boolean,
  excludeAssetFilter?: (url: string) => boolean,
  globalContext?: typeof window,
) {
  let sandbox: SandBox;
  //创建沙箱，这里 LegacySandbox 和 ProxySandbox类似，都是使用proxy
  //  SnapshotSandbox 直接创建了一个空对象用于保存 window的自有属性（非原型链上的方法）
  if (window.Proxy) {
    sandbox = useLooseSandbox ? new LegacySandbox(appName, globalContext) : new ProxySandbox(appName, globalContext);
  } else {
    sandbox = new SnapshotSandbox(appName);
  }

  // bootstrap的副作用
  const bootstrappingFreers = patchAtBootstrapping(appName, elementGetter, sandbox, scopedCSS, excludeAssetFilter);
  // mount时的副作用
  let mountingFreers: Freer[] = [];

  let sideEffectsRebuilders: Rebuilder[] = [];

  return {
    instance: sandbox,

    /**
     * 沙箱被 mount
     * 可能是从 bootstrap 状态进入的 mount
     * 也可能是从 unmount 之后再次唤醒进入 mount
     */
    async mount() {
      /* ---- 因为有上下文依赖（window），以下代码执行顺序不能变 ------ */

      /* ----- 1. 启动/恢复 沙箱------------- */
      sandbox.active();

      const sideEffectsRebuildersAtBootstrapping = sideEffectsRebuilders.slice(0, bootstrappingFreers.length);
      const sideEffectsRebuildersAtMounting = sideEffectsRebuilders.slice(bootstrappingFreers.length);

      // must rebuild the side effects which added at bootstrapping firstly to recovery to nature state
      if (sideEffectsRebuildersAtBootstrapping.length) {
        sideEffectsRebuildersAtBootstrapping.forEach((rebuild) => rebuild());
      }

      /* ----- 2. 开启全局变量补丁 ----------*/
      // render 沙箱启动时开始劫持各类全局监听，尽量不要在应用初始化阶段有 事件监听/定时器 等副作用
      mountingFreers = patchAtMounting(appName, elementGetter, sandbox, scopedCSS, excludeAssetFilter);

      /* ---- 3. 重置一些初始化时的副作用 ---------*/
      // 存在 rebuilder 则表明有些副作用需要重建
      if (sideEffectsRebuildersAtMounting.length) {
        sideEffectsRebuildersAtMounting.forEach((rebuild) => rebuild());
      }

      // clean up rebuilders
      sideEffectsRebuilders = [];
    },

    /**
     * 恢复 global 状态，使其能回到应用加载之前的状态
     */
    async unmount() {
      sideEffectsRebuilders = [...bootstrappingFreers, ...mountingFreers].map((free) => free());

      sandbox.inactive();
    },
  };
}
```

### patchAtBootstrapping

重写了以下方法,每次在修改 dom 节点时，记录到当前子应用的 snapshot 中，在切换时进行保存。
主要是拦截 script style link 这三种标签，其他的不做修改。具体的处理逻辑可以看[qiankun 的实现](https://github.com/umijs/qiankun/blob/master/src/sandbox/patchers/css.ts)

```TS
const rawHeadRemoveChild = HTMLHeadElement.prototype.removeChild;
const rawBodyAppendChild = HTMLBodyElement.prototype.appendChild;
const rawBodyRemoveChild = HTMLBodyElement.prototype.removeChild;
const rawHeadInsertBefore = HTMLHeadElement.prototype.insertBefore;
const rawRemoveChild = HTMLElement.prototype.removeChild;
```

当子应用卸载后，重置了 dom 的原型方法

### patchAtMounting

window 上的属性监听，主要是 Interval (子应用卸载时清空定时器)，WindowListener(子应用卸载时要移除 addEventListener 添加的事件)和 HistoryListener(window.g_history 属性，猜测是 import-html-entry 的方法)

不过没有处理 local storage，不同子应用可能会起到冲突

### createElement 实现 css 样式隔离

```TS
const supportShadowDOM = document.head.attachShadow || document.head.createShadowRoot;

function createElement(
  appContent: string,
  strictStyleIsolation: boolean,
  scopedCSS: boolean,
  appInstanceId: string,
): HTMLElement {
  const containerElement = document.createElement('div');
  containerElement.innerHTML = appContent;
  // 子应用总是在一个div下面
  const appElement = containerElement.firstChild as HTMLElement;
  // shadowdom 隔离css
  if (strictStyleIsolation) {
    if (!supportShadowDOM) {
      console.warn(

      );
    } else {
      const { innerHTML } = appElement;
      appElement.innerHTML = '';
      let shadow: ShadowRoot;

      if (appElement.attachShadow) {
        shadow = appElement.attachShadow({ mode: 'open' });
      } else {
        // createShadowRoot was proposed in initial spec, which has then been deprecated
        shadow = (appElement as any).createShadowRoot();
      }
      shadow.innerHTML = innerHTML;
    }
  }

  // scope隔离css，
  if (scopedCSS) {
    const attr = appElement.getAttribute(css.QiankunCSSRewriteAttr);
    if (!attr) {
      appElement.setAttribute(css.QiankunCSSRewriteAttr, appInstanceId);
    }

    const styleNodes = appElement.querySelectorAll('style') || [];
    forEach(styleNodes, (stylesheetElement: HTMLStyleElement) => {
      css.process(appElement!, stylesheetElement, appInstanceId);
    });
  }

  return appElement;
}
```

scopedCSS 的处理过程可以在[这里](https://github.com/umijs/qiankun/blob/master/src/sandbox/patchers/css.ts)看到,具体不在详细阐述，主要就是解析 CSSStyleRule,然后给每一项 css 选择器添加子应用样式前缀 `${tag}[${QiankunCSSRewriteAttr}="${appName}"]`，这也是一些 webpack loader 的做法

## 总结

总体看来 qiankun 是对 single-spa 的封装，使用了 single-spa 的子应用注册加载和生命周期。在子应用生命周期内注入了 css/js 沙箱和应用间通信过程。css 的沙箱支持 scope 和 shadow-dom，js 的沙箱是保存子应用环境变量的修改

参考连接:  
[微前端框架 之 qiankun 从入门到源码分析](https://mp.weixin.qq.com/s?__biz=MzA3NTk4NjQ1OQ==&mid=2247484411&idx=1&sn=7e67d2843b8576fce01b18269f33f7e9&chksm=9f69608fa81ee99954b6b5a1e3eb40e194c05c1edb504baac27577a0217f61c78ff9d0bb7e23&token=165646905&lang=zh_CN#rd)  
[qiankun 2.x 运行时沙箱 源码分析](https://mp.weixin.qq.com/s?__biz=MzA3NTk4NjQ1OQ==&mid=2247484446&idx=1&sn=0b918d4c185900a15d1874012c2da2b3&chksm=9f69676aa81eee7c673243da440d65a5d3354d0a2a40557bc84a28222cc3d3210aa3f681d655&scene=178&cur_album_id=2251416802327232513#rd)
