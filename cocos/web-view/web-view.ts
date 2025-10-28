/*
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights to
 use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 of the Software, and to permit persons to whom the Software is furnished to do so,
 subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
*/

import { ccclass, help, executeInEditMode, menu, tooltip, type, displayOrder, serializable, requireComponent } from 'cc.decorator';
import { EDITOR_NOT_IN_PREVIEW } from 'internal:constants';
import { UITransform } from '../2d/framework';
import { Component, EventHandler as ComponentEventHandler } from '../scene-graph';
import { WebViewImplManager } from './web-view-impl-manager';
import { WebViewEventType } from './web-view-enums';
import { legacyCC } from '../core/global-exports';
import type { WebViewImpl  } from './web-view-impl';

/**
 * @en
 * WebView component, used to display web pages in the game.
 * Since different platforms have different authorizations, APIs, and control methods for WebView components, there is no unified standard yet.
 * So currently only Web, iOS, and Android platforms are supported.
 * @zh
 * WebView 组件，用于在游戏中显示网页。
 * 由于不同平台对于 WebView 组件的授权、API、控制方式都不同，还没有形成统一的标准，所以目前只支持 Web、iOS 和 Android 平台。
 */
@ccclass('cc.WebView')
@help('i18n:cc.WebView')
@menu('Miscellaneous/WebView')
@requireComponent(UITransform)
@executeInEditMode
export class WebView extends Component {
    @serializable
    protected _url = 'https://cocos.com';

    protected _impl: WebViewImpl | null = null;

    /**
     * @en
     * WebView event type. Alias of `WebViewEventType` for convenient access on `WebView`.
     * Includes `LOADING`, `LOADED`, `ERROR`, and `NONE`. Useful when
     * listening via `node.on()` or triggering with `ComponentEventHandler.emitEvents`.
     *
     * @example
     * ```ts
     * node.on(WebView.EventType.LOADED, (comp: WebView) => {
     *   console.log('Page loaded:', comp.url);
     * });
     * ```
     * @zh
     * 网页视图事件类型。`WebViewEventType` 的别名，便于通过 `WebView.EventType` 访问。
     * 包含 `LOADING`、`LOADED`、`ERROR`、`NONE`。适用于通过 `node.on()` 监听
     * 或使用 `ComponentEventHandler.emitEvents` 触发事件。
     *
     */
    public static EventType = WebViewEventType;

    constructor () {
        super();
    }

    /**
     * @en
     * Current page URL for the WebView. The value should be an `http://` or `https://` URL.
     * Setting this property immediately instructs the underlying implementation to navigate
     * to the new URL via `loadURL`, replacing the currently displayed page.
     *
     * - Getter returns the last assigned URL (or the default if unchanged).
     * - Setter triggers navigation if the component has been initialized (`_impl` created).
     * - Depending on platform security policies, some URLs may be blocked.
     *
     * Returns:
     * - Getter: `string` — the current URL.
     *
     * @example
     * ```ts
     * // Read current URL
     * const current = webView.url;
     * // Navigate to another page
     * webView.url = 'https://example.com/docs';
     * ```
     * @zh
     * WebView 当前页面的 URL。该值应为 `http://` 或 `https://` 开头的地址。
     * 设置该属性会立即通过底层实现的 `loadURL` 进行跳转，替换当前显示的页面。
     *
     * - 读取时返回上次赋值的 URL（或默认值）。
     * - 写入时在组件已初始化（`_impl` 已创建）情况下触发导航。
     * - 受平台安全策略影响，部分地址可能被拦截或限制。
     *
     * 返回值：
     * - 读取：`string` — 当前 URL。
     *
     */
    @tooltip('i18n:webview.url')
    get url (): string {
        return this._url;
    }
    set url (val: string) {
        this._url = val;
        if (this._impl) {
            this._impl.loadURL(val);
        }
    }

    /**
     * @en
     * Event callbacks associated with this WebView. These handlers are invoked when the
     * WebView enters specific states: `LOADING`, `LOADED`, or `ERROR`.
     * Internally, events are dispatched via `ComponentEventHandler.emitEvents` and mirrored
     * to `node.emit(WebView.EventType.*)` for runtime listeners.
     *
     * Event payloads:
     * - `LOADING`: `(webView: WebView)`
     * - `LOADED`: `(webView: WebView)`
     * - `ERROR`: `(webView: WebView, args?: unknown[])`
     *
     * @example
     * ```ts
     * // Add in script (you can also wire these in the editor)
     * const handler = new ComponentEventHandler();
     * handler.target = someNode;
     * handler.component = 'YourComponent';
     * handler.handler = 'onWebViewLoaded';
     * webView.webviewEvents.push(handler);
     *
     * // Or listen via node events
     * webView.node.on(WebView.EventType.ERROR, (comp: WebView, args) => {
     *   console.warn('WebView error', args);
     * });
     * ```
     * @zh
     * 与该 WebView 关联的事件回调。当网页视图进入 `LOADING`、`LOADED`、`ERROR` 状态时，会调用
     * 这些回调。内部通过 `ComponentEventHandler.emitEvents` 分发，同时镜像到
     * `node.emit(WebView.EventType.*)` 供运行时监听。
     *
     * 事件载荷：
     * - `LOADING`: `(webView: WebView)`
     * - `LOADED`: `(webView: WebView)`
     * - `ERROR`: `(webView: WebView, args?: unknown[])`
     *
     */
    @serializable
    @type([ComponentEventHandler])
    @displayOrder(20)
    @tooltip('i18n:webview.webviewEvents')
    public webviewEvents: ComponentEventHandler[] = [];

    /**
     * @en
     * Raw native webview element for customization on Web platforms.
     * Returns the underlying `HTMLIFrameElement` if available; otherwise `null`.
     * Not available on iOS/Android native implementations.
     *
     * Returns:
     * - `HTMLIFrameElement | null`
     *
     * @example
     * ```ts
     * const iframe = webView.nativeWebView;
     * if (iframe) {
     *   iframe.setAttribute('sandbox', 'allow-scripts');
     *   iframe.style.pointerEvents = 'none';
     * }
     * ```
     * @zh
     * Web 平台上的原生网页元素，用于用户定制。
     * 若可用则返回底层的 `HTMLIFrameElement`，否则返回 `null`。
     * 在 iOS/Android 原生实现上不可用。
     *
     * 返回值：
     * - `HTMLIFrameElement | null`
     *
     */
    get nativeWebView (): HTMLIFrameElement | null {
        return (this._impl && this._impl.webview) || null;
    }

    /**
     * @en
     * Current WebView state. Returns one of `WebViewEventType`:
     * `NONE`, `LOADING`, `LOADED`, or `ERROR`.
     * If the implementation (`_impl`) has not been created yet, returns `NONE`.
     *
     * Returns:
     * - `WebViewEventType`
     *
     * @example
     * ```ts
     * if (webView.state === WebView.EventType.LOADING) {
     *   console.log('Still loading...');
     * }
     * ```
     * @zh
     * 当前 WebView 状态。返回 `WebViewEventType` 中的值：
     * `NONE`、`LOADING`、`LOADED` 或 `ERROR`。
     * 若底层实现（`_impl`）尚未创建，则返回 `NONE`。
     *
     * 返回值：
     * - `WebViewEventType`
     *
     */
    get state (): WebViewEventType {
        if (!this._impl) { return WebViewEventType.NONE; }
        return this._impl.state;
    }

    /**
     * @en
     * Sets the JavaScript interface scheme used by the native WebView bridge.
     * Works together with `setOnJSCallback()`. Only supported on Android and iOS.
     * On Web (HTML5), please refer to official documentation for available alternatives.
     *
     * Side effects:
     * - Configures the native bridge to intercept navigations with the given scheme
     *   (e.g., `jsbridge://action`). When the page attempts to load such URLs,
     *   the bridge will trigger the registered JS callback.
     *
     * Params:
     * - `scheme: string` — custom scheme prefix, e.g., `jsbridge`.
     *
     * Returns:
     * - `void`
     *
     * Example (Android/iOS):
     * ```ts
     * webView.setJavascriptInterfaceScheme('jsbridge');
     * webView.setOnJSCallback(() => {
     *   console.log('JS bridge invoked');
     * });
     * // In your page: location.href = 'jsbridge://doSomething';
     * ```
     * @zh
     * 设置原生 WebView 桥接所使用的 JavaScript 接口协议（scheme）。
     * 与 `setOnJSCallback()` 配合使用，仅支持 Android 与 iOS。
     * Web（HTML5）平台请参考官方文档。
     *
     * 副作用：
     * - 配置原生桥接拦截以该协议开头的导航（如 `jsbridge://action`）。
     *   当页面尝试加载此类 URL 时，将触发注册的 JS 回调。
     *
     * 参数：
     * - `scheme: string` — 自定义协议前缀，例如 `jsbridge`。
     *
     * 返回值：
     * - `void`
     *
     */
    public setJavascriptInterfaceScheme (scheme: string): void {
        if (this._impl) {
            this._impl.setJavascriptInterfaceScheme(scheme);
        }
    }

    /**
     * @en
     * Registers a callback that is invoked when the page tries to navigate
     * to a URL starting with the configured JavaScript interface scheme
     * (see `setJavascriptInterfaceScheme`). Only supported on Android and iOS.
     * On Web (HTML5), consult the official documentation for alternatives.
     *
     * Params:
     * - `callback: () => void` — function invoked when the scheme is detected.
     *   The specific payload, if any, is platform-dependent; this API does not
     *   pass arguments to the callback.
     *
     * Returns:
     * - `void`
     *
     * Example (Android/iOS):
     * ```ts
     * webView.setJavascriptInterfaceScheme('jsbridge');
     * webView.setOnJSCallback(() => {
     *   console.log('Bridge callback triggered');
     * });
     * // In page: location.href = 'jsbridge://open-settings';
     * ```
     * @zh
     * 注册一个回调，当页面尝试导航到以配置的 JavaScript 接口协议开头的 URL 时
     *（参见 `setJavascriptInterfaceScheme`），触发该回调。仅支持 Android 与 iOS。
     * Web（HTML5）端请参考官方文档。
     *
     * 参数：
     * - `callback: () => void` — 当检测到协议时调用的函数。
     *   具体载荷（若有）依赖平台实现；此 API 不向回调传参。
     *
     * 返回值：
     * - `void`
     *
     */
    public setOnJSCallback (callback: () => void): void {
        if (this._impl) {
            this._impl.setOnJSCallback(callback);
        }
    }

    /**
     * @en
     * Evaluates the given JavaScript string in the context of the currently
     * displayed page within the WebView.
     *
     * Notes:
     * - Execution behavior and sandboxing are platform-dependent.
     * - Cross-origin restrictions must be handled by the page itself.
     * - This call is asynchronous; no value is returned to the caller.
     *
     * Params:
     * - `str: string` — JavaScript code to evaluate.
     *
     * Returns:
     * - `void`
     *
     * @example
     * ```ts
     * webView.evaluateJS('document.body.style.background = "#222"');
     * ```
     * @zh
     * 在当前 WebView 页面上下文中执行指定的 JavaScript 字符串。
     *
     * 注意：
     * - 执行行为与沙箱机制因平台而异。
     * - 跨域限制需由页面自身处理。
     * - 该调用为异步执行，不会向调用方返回值。
     *
     * 参数：
     * - `str: string` — 需要执行的 JavaScript 代码。
     *
     * 返回值：
     * - `void`
     *
     */
    public evaluateJS (str: string): void {
        if (this._impl) {
            this._impl.evaluateJS(str);
        }
    }

    /**
     * @en
     * Lifecycle hook called before the component is fully enabled at runtime.
     * Initializes the underlying implementation, registers event listeners,
     * and loads the initial URL.
     * Skips initialization when running in editor preview.
     *
     * Returns:
     * - `void`
     *
     * @zh
     * 运行时在组件完全启用前调用的生命周期钩子。
     * 初始化底层实现、注册事件监听，并加载初始 URL。
     * 在编辑器预览模式下会跳过初始化。
     *
     * 返回值：
     * - `void`
     */
    public __preload (): void {
        if (EDITOR_NOT_IN_PREVIEW) {
            return;
        }
        this._impl = WebViewImplManager.getImpl(this);
        const { componentEventList } = this._impl;
        // must be register the event listener
        componentEventList.set(WebViewEventType.LOADING, this.onLoading.bind(this));
        componentEventList.set(WebViewEventType.LOADED, this.onLoaded.bind(this));
        componentEventList.set(WebViewEventType.ERROR, this.onError.bind(this));
        this._impl.loadURL(this._url);
    }

    private onLoading (): void {
        ComponentEventHandler.emitEvents(this.webviewEvents, this, WebViewEventType.LOADING);
        this.node.emit(WebViewEventType.LOADING, this);
    }

    private onLoaded (): void {
        ComponentEventHandler.emitEvents(this.webviewEvents, this, WebViewEventType.LOADED);
        this.node.emit(WebViewEventType.LOADED, this);
    }

    private onError (...args: any[any]): void {
        ComponentEventHandler.emitEvents(this.webviewEvents, this, WebViewEventType.ERROR, args);
        this.node.emit(WebViewEventType.ERROR, this, args);
    }

    /**
     * @en
     * Lifecycle hook called when the component is enabled.
     * Delegates to the underlying implementation to make the WebView visible/active.
     *
     * Returns:
     * - `void`
     *
     * @zh
     * 当组件启用时调用。
     * 激活WebView。
     *
     * 返回值：
     * - `void`
     */
    public onEnable (): void {
        if (this._impl) {
            this._impl.enable();
        }
    }

    /**
     * @en
     * Lifecycle hook called when the component is disabled.
     * Delegates to the underlying implementation to hide or deactivate the WebView.
     *
     * Returns:
     * - `void`
     *
     * @zh
     * 当组件被禁用时调用。
     * 停用 WebView。
     *
     * 返回值：
     * - `void`
     */
    public onDisable (): void {
        if (this._impl) {
            this._impl.disable();
        }
    }

    /**
     * @en
     * Lifecycle hook called when the component is destroyed.
     * Disposes the underlying implementation and releases native resources.
     * After destruction, `_impl` is set to `null`.
     *
     * Returns:
     * - `void`
     *
     * @zh
     * 当组件被销毁时调用。
     * 释放底层实现并回收原生资源，销毁后 `_impl` 被置为 `null`。
     *
     * 返回值：
     * - `void`
     */
    public onDestroy (): void {
        if (this._impl) {
            this._impl.destroy();
            this._impl = null;
        }
    }

    /**
     * @en
     * Per-frame update hook. Synchronizes the engine node's transform/matrix
     * to the native WebView so that positioning and scaling stay in sync.
     *
     * Params:
     * - `dt: number` — delta time in seconds (unused by this implementation).
     *
     * Returns:
     * - `void`
     *
     * @zh
     * 每帧更新函数。将引擎节点的变换/矩阵同步到原生 WebView，确保位置和缩放一致。
     *
     * 参数：
     * - `dt: number` — 以秒为单位的增量时间。
     *
     * 返回值：
     * - `void`
     */
    public update (dt: number): void {
        if (this._impl) {
            this._impl.syncMatrix();
        }
    }
}

// TODO Since jsb adapter does not support import cc, put it on internal first and adjust it later.
legacyCC.internal.WebView = WebView;
