/// <reference types="vite/client" />
/// <reference types="@dcloudio/types" />
/// <reference types="@uni-helper/uni-app-types" />
/// <reference types="@tdesign/uniapp/global" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
