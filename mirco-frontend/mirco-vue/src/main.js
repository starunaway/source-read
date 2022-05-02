import Vue from 'vue';
import App from './App.vue';
import './public-path';
Vue.config.productionTip = false;

new Vue({
  render: (h) => h(App),
}).$mount('#app');

let instance = null;

function render(props) {
  const {container} = props;
  instance = new Vue({
    render: (h) => h(App),
  });
  instance.$mount(container ? container.querySelector('#app') : '#app');
}

if (!window.__mirco_frontend) {
  mount({});
}

// 生命周期函数必须返回promise
export async function bootstrap() {
  console.log('vue2 bootstraped');
}

export async function mount(props = {}) {
  console.log('vue2 mount');
  render(props);
}

export async function unmount() {
  console.log('vue2 unmount', instance);
  instance.$destroy();
  instance.$el.innerHTML = '';
  instance = null;
}
