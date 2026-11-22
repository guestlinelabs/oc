import { createComponent } from '@guestlinelabs/oc-vite/renderer';

export default createComponent(() => ({
  mount(element) {
    element.innerHTML = '<div>hello world</div>';
  },
  unmount() {}
}));
