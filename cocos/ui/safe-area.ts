/*
 Copyright (c) 2020-2023 Xiamen Yaji Software Co., Ltd.

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

import { ccclass, help, executionOrder, menu, executeInEditMode, requireComponent, serializable, visible, tooltip } from 'cc.decorator';
import { EDITOR } from 'internal:constants';
import { screenAdapter } from 'pal/screen-adapter';
import { Component } from '../scene-graph/component';
import { UITransform } from '../2d/framework';
import { sys } from '../core/platform';
import { Widget } from './widget';
import { widgetManager } from './widget-manager';
import { legacyCC } from '../core/global-exports';
import { view } from './view';

/**
 * @en
 * This component is used to adjust the layout of current node to respect the safe area of a notched mobile device such as the iPhone X.
 * It is typically used for the top node of the UI interaction area. For specific usage,
 * refer to the official [test-cases-3d/assets/cases/ui/20.safe-area/safe-area.scene](https://github.com/cocos-creator/test-cases-3d).
 *
 * The concept of safe area is to give you a fixed inner rectangle in which you can safely display content that will be drawn on screen.
 * You are strongly discouraged from providing controls outside of this area. But your screen background could embellish edges.
 *
 * This component internally uses the API `sys.getSafeAreaRect();` to obtain the safe area of the current iOS or Android device,
 * and implements the adaptation by using the Widget component and set anchor.
 *
 * @zh
 * 该组件会将所在节点的布局适配到 iPhone X 等异形屏手机的安全区域内，通常用于 UI 交互区域的顶层节点，
 * 具体用法可参考官方范例 [test-cases-3d/assets/cases/ui/20.safe-area/safe-area.scene](https://github.com/cocos-creator/test-cases-3d)。
 *
 * 该组件内部通过 API `sys.getSafeAreaRect();` 获取到当前 iOS 或 Android 设备的安全区域，并通过 Widget 组件实现适配。
 *
 */

@ccclass('cc.SafeArea')
@help('i18n:cc.SafeArea')
@executionOrder(110)
@executeInEditMode
@menu('UI/SafeArea')
@requireComponent(Widget)
export class SafeArea extends Component {
    /**
     * @en
     * Controls whether to use symmetric safe area handling.
     *
     * Symmetric mode (`true`):
     * - Applies the same insets to paired sides (landscape: left/right; portrait: top/bottom)
     * - Keeps UI visually centered and balanced
     * - Recommended for most UI layouts focusing on aesthetic symmetry
     *
     * Asymmetric mode (`false`):
     * - Uses actual device-specific insets per side
     * - Maximizes usable space when notch or indicators only affect one side
     * - Suitable for content-heavy layouts needing precision
     *
     * Default: `true`
     *
     * @zh
     * 是否采用对称安全区域处理。
     *
     * 对称模式（`true`）：
     * - 对成对边进行相同的内边距（横屏：左右；竖屏：上下）
     * - 保持 UI 居中和平衡
     * - 适用于大多数强调视觉对称的布局
     *
     * 非对称模式（`false`）：
     * - 按设备实际情况分别设置各边内边距
     * - 当刘海或系统指示器仅影响一侧时可最大化可用空间
     * - 适用于内容密集、需要精确适配的布局
     *
     * 默认值：`true`
     */
    @visible(true)
    @tooltip('i18n:safe_area.symmetric')
    get symmetric (): boolean {
        return this._symmetric;
    }
    set symmetric (value) {
        this._symmetric = value;
    }
    @serializable
    private _symmetric: boolean = true;

    constructor () {
        super();
    }

    /**
     * @en
     * Lifecycle: called when the component becomes enabled.
     * - Applies initial safe-area layout via `updateArea()`
     * - Subscribes to screen changes for real-time adaptation:
     *   - `window-resize`: browser or desktop window resizing
     *   - `orientation-change`: mobile device rotation
     *
     * Notes:
     * - On native platforms, callbacks may need delaying (implementation comment).
     *
     * @zh
     * 生命周期：组件启用时调用。
     * - 通过 `updateArea()` 应用初始安全区域布局
     * - 注册屏幕变化以实时适配：
     *   - `window-resize`：浏览器或桌面窗口尺寸变化
     *   - `orientation-change`：移动设备旋转
     *
     * 说明：
     * - 原生平台可能需要延迟处理回调（实现层注释）。
     */
    public onEnable (): void {
        this.updateArea();
        // IDEA: need to delay the callback on Native platform ?
        screenAdapter.on('window-resize', this.updateArea, this);
        screenAdapter.on('orientation-change', this.updateArea, this);
    }

    /**
     * @en
     * Lifecycle: called when the component is disabled.
     * - Unsubscribes previously registered screen change listeners
     * - Pauses automatic safe-area updates; current layout remains
     *
     * @zh
     * 生命周期：组件禁用时调用。
     * - 取消注册之前添加的屏幕变化监听器
     * - 暂停自动安全区域更新；保留当前布局
     */
    public onDisable (): void {
        screenAdapter.off('window-resize', this.updateArea, this);
        screenAdapter.off('orientation-change', this.updateArea, this);
    }

    /**
     * @en
     * Immediately adapts the node's layout to the device safe area.
     *
     * Steps:
     * 1) Check dependencies: `Widget` and `UITransform`
     * 2) In editor: set all margins to 0 for consistent preview
     * 3) At runtime:
     *    - Fetch visible size and `sys.getSafeAreaRect(this._symmetric)`
     *    - Compute top/bottom/left/right insets
     *    - Preserve the node's visual position by adjusting anchor to offset alignment changes
     * 4) Update alignment and register widget to manager
     *
     * @zh
     * 立即适配安全区域
     *
     * 步骤：
     * 1) 检查依赖：`Widget` 与 `UITransform`
     * 2) 编辑器模式：统一将边距置为 0，便于预览
     * 3) 运行时：
     *    - 获取可视大小与 `sys.getSafeAreaRect(this._symmetric)`
     *    - 计算上下左右边距
     *    - 通过调整锚点抵消对齐变化，保持视觉位置不变
     * 4) 更新对齐并将 Widget 注册到管理器
     *
     * @example
     * // Manual update
     * import { SafeArea } from 'cc';
     * const safeArea = this.node.addComponent(SafeArea);
     * safeArea.updateArea();
     *
     */
    public updateArea (): void {
        // TODO Remove Widget dependencies in the future
        const widget = this.node.getComponent(Widget) as Widget;
        const uiTransComp = this.node.getComponent(UITransform) as UITransform;
        if (!widget || !uiTransComp) {
            return;
        }

        if (EDITOR) {
            widget.top = widget.bottom = widget.left = widget.right = 0;
            widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
            return;
        }
        // IMPORTANT: need to update alignment to get the latest position
        widget.updateAlignment();
        const lastPos = this.node.position.clone();
        const lastAnchorPoint = uiTransComp.anchorPoint.clone();
        //
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        const visibleSize = view.getVisibleSize();
        const screenWidth = visibleSize.width;
        const screenHeight = visibleSize.height;
        const safeArea = sys.getSafeAreaRect(this._symmetric);
        widget.top = screenHeight - safeArea.y - safeArea.height;
        widget.bottom = safeArea.y;
        widget.left = safeArea.x;
        widget.right = screenWidth - safeArea.x - safeArea.width;
        widget.updateAlignment();
        // set anchor, keep the original position unchanged
        const curPos = this.node.position.clone();
        const anchorX = lastAnchorPoint.x - (curPos.x - lastPos.x) / uiTransComp.width;
        const anchorY = lastAnchorPoint.y - (curPos.y - lastPos.y) / uiTransComp.height;
        uiTransComp.setAnchorPoint(anchorX, anchorY);
        // IMPORTANT: restore to lastPos even if widget is not ALWAYS
        widgetManager.add(widget);
    }
}

legacyCC.SafeArea = SafeArea;
