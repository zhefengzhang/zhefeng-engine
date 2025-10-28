/*
 Copyright (c) 2013-2016 Chukong Technologies Inc.
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

import { EDITOR, DEV } from 'internal:constants';
import { screenAdapter } from 'pal/screen-adapter';
import { director, DirectorEvent } from '../game/director';
import { Vec2, Vec3, visibleRect, js, cclegacy, approx, EPSILON } from '../core';
import { View } from './view';
import { Scene } from '../scene-graph';
import { Node } from '../scene-graph/node';
import { AlignFlags, AlignMode, computeInverseTransForTarget, getReadonlyNodeSize, Widget } from './widget';
import { UITransform } from '../2d/framework';

const _tempPos = new Vec3();
const _defaultAnchor = new Vec2();

const tInverseTranslate = new Vec2();
const tInverseScale = new Vec2(1, 1);
const _tempVec2_1 = new Vec2();
const _tempVec2_2 = new Vec2();

/**
 * @en Align a `node` to its parent or `target` borders by computing position and size
 *     according to `Widget` rules. Rotation is ignored. Supports horizontal/vertical
 *     stretch and center alignment. When `widget.target` is set, inverse transform
 *     of the target is applied via `computeInverseTransForTarget` to account for
 *     parent/target space differences.
 * @zh 按 `Widget` 规则将 `node` 对齐到父级或 `target` 的边界，
 *     通过计算位置与尺寸实现对齐，忽略旋转。支持水平/垂直拉伸与居中对齐。
 *     当设置了 `widget.target` 时，会通过 `computeInverseTransForTarget` 应用目标的逆变换，
 *     以消除父/目标空间的差异。
 * @param {Node} node 要进行对齐的节点。
 * @param {Widget} widget 驱动对齐的 `Widget` 组件，包含偏移、拉伸与居中等配置。
 * @returns {void}
 * @example
 * // Align immediately when a widget becomes dirty
 * const w = node.getComponent(Widget);
 * w.setDirty();
 * // internal usage: align(node, w);
 */
function align (node: Node, widget: Widget): void {
    // Hack: this flag use to ONCE mode
    if (widget._hadAlignOnce) return;
    if ((!EDITOR) && widget.alignMode === AlignMode.ONCE) {
        widget._hadAlignOnce = true;
    }
    const hasTarget = widget.target;
    let target: Node | Scene;
    const inverseTranslate = tInverseTranslate;
    const inverseScale = tInverseScale;
    if (hasTarget) {
        target = hasTarget;
        // inverseTranslate = tInverseTranslate;
        // inverseScale = tInverseScale;
        computeInverseTransForTarget(node, target, inverseTranslate, inverseScale);
    } else {
        target = node.parent!;
    }
    const targetSize = getReadonlyNodeSize(target);
    const useGlobal = target instanceof Scene || !target.getComponent(UITransform);
    const targetAnchor = useGlobal ? _defaultAnchor : target.getComponent(UITransform)!.anchorPoint;

    const isRoot = useGlobal;
    node.getPosition(_tempPos);
    const uiTrans = node._getUITransformComp()!;
    let x = _tempPos.x;
    let y = _tempPos.y;
    const anchor = uiTrans.anchorPoint;
    const scale = node.scale;    // It is a reference of Node's scale, don't change its value in this function.

    if (widget.alignFlags & AlignFlags.HORIZONTAL) {
        let localLeft = 0;
        let localRight = 0;
        const targetWidth = targetSize.width;
        if (isRoot) {
            localLeft = visibleRect.left.x;
            localRight = visibleRect.right.x;
        } else {
            localLeft = -targetAnchor.x * targetWidth;
            localRight = localLeft + targetWidth;
        }

        // adjust borders according to offsets
        localLeft += widget.isAbsoluteLeft ? widget.left : widget.left * targetWidth;
        localRight -= widget.isAbsoluteRight ? widget.right : widget.right * targetWidth;

        if (hasTarget) {
            localLeft += inverseTranslate.x;
            localLeft *= inverseScale.x;
            localRight += inverseTranslate.x;
            localRight *= inverseScale.x;
        }

        let width = 0;
        let anchorX = anchor.x;
        let scaleX = scale.x;
        if (scaleX < 0) {
            anchorX = 1.0 - anchorX;
            scaleX = -scaleX;
        }
        if (widget.isStretchWidth) {
            width = localRight - localLeft;
            if (scaleX !== 0) {
                uiTrans.width = width / scaleX;
            }
            x = localLeft + anchorX * width;
        } else {
            width = uiTrans.width * scaleX;
            if (widget.isAlignHorizontalCenter) {
                let localHorizontalCenter = widget.isAbsoluteHorizontalCenter ? widget.horizontalCenter : widget.horizontalCenter * targetWidth;
                let targetCenter = (0.5 - targetAnchor.x) * targetSize.width;
                if (hasTarget) {
                    localHorizontalCenter *= inverseScale.x;
                    targetCenter += inverseTranslate.x;
                    targetCenter *= inverseScale.x;
                }
                x = targetCenter + (anchorX - 0.5) * width + localHorizontalCenter;
            } else if (widget.isAlignLeft) {
                x = localLeft + anchorX * width;
            } else {
                x = localRight + (anchorX - 1) * width;
            }
            if (!approx(scaleX, 0, EPSILON)) {
                width /= scaleX;
            } else {
                width = uiTrans.width;
            }
        }

        widget._lastSize.width = width;
    }

    if (widget.alignFlags & AlignFlags.VERTICAL) {
        let localTop = 0;
        let localBottom = 0;
        const targetHeight = targetSize.height;
        if (isRoot) {
            localBottom = visibleRect.bottom.y;
            localTop = visibleRect.top.y;
        } else {
            localBottom = -targetAnchor.y * targetHeight;
            localTop = localBottom + targetHeight;
        }

        // adjust borders according to offsets
        localBottom += widget.isAbsoluteBottom ? widget.bottom : widget.bottom * targetHeight;
        localTop -= widget.isAbsoluteTop ? widget.top : widget.top * targetHeight;

        if (hasTarget) {
            // transform
            localBottom += inverseTranslate.y;
            localBottom *= inverseScale.y;
            localTop += inverseTranslate.y;
            localTop *= inverseScale.y;
        }

        let height = 0;
        let anchorY = anchor.y;
        let scaleY = scale.y;
        if (scaleY < 0) {
            anchorY = 1.0 - anchorY;
            scaleY = -scaleY;
        }
        if (widget.isStretchHeight) {
            height = localTop - localBottom;
            if (scaleY !== 0) {
                uiTrans.height = height / scaleY;
            }
            y = localBottom + anchorY * height;
        } else {
            height = uiTrans.height * scaleY;
            if (widget.isAlignVerticalCenter) {
                let localVerticalCenter = widget.isAbsoluteVerticalCenter ? widget.verticalCenter : widget.verticalCenter * targetHeight;
                let targetMiddle = (0.5 - targetAnchor.y) * targetSize.height;
                if (hasTarget) {
                    localVerticalCenter *= inverseScale.y;
                    targetMiddle += inverseTranslate.y;
                    targetMiddle *= inverseScale.y;
                }
                y = targetMiddle + (anchorY - 0.5) * height + localVerticalCenter;
            } else if (widget.isAlignBottom) {
                y = localBottom + anchorY * height;
            } else {
                y = localTop + (anchorY - 1) * height;
            }
            if (!approx(scaleY, 0, EPSILON)) {
                height /= scaleY;
            } else {
                height = uiTrans.height;
            }
        }

        widget._lastSize.height = height;
    }

    node.setPosition(x, y, _tempPos.z);
    Vec3.set(widget._lastPos, x, y, _tempPos.z);
}

/**
 * @en Traverse the node subtree and collect enabled `Widget` components into `activeWidgets`.
 *     DEV-only: validates `widget.target` correctness via `_validateTargetInDEV`. Skips invalid nodes.
 *     Children are visited only if `child.active` is true. Alignment is deferred to `refreshScene`.
 * @zh 递归遍历节点子树，将启用状态的 `Widget` 收集到 `activeWidgets` 列表。
 *     仅在 DEV 模式下校验 `widget.target` 的合法性（`_validateTargetInDEV`）。对于无效节点将跳过。
 *     仅访问 `child.active` 为 true 的子节点；实际对齐动作由 `refreshScene` 统一处理。
 * @param {Node} node 遍历的根节点（实际类型可能为 `Node` 或 `BaseNode`）。
 * @returns {void}
 */
function visitNode (node: any): void {
    const widget: Widget = node.getComponent(Widget);
    if (widget && widget.enabled) {
        if (DEV) {
            widget._validateTargetInDEV();
        }
        // Notice: remove align to after visitNode, AlignMode.ONCE will use widget._hadAlignOnce flag
        // align(node, widget);
        // if ((!EDITOR || widgetManager.animationState!.animatedSinceLastFrame) && widget.alignMode === AlignMode.ONCE) {
        //     widget.enabled = false;
        // } else {
        if (!cclegacy.isValid(node, true)) {
            return;
        }
        activeWidgets.push(widget);
    }
    const children = node.children;
    for (const child of children) {
        if (child.active) {
            visitNode(child);
        }
    }
}

/**
 * @en Refresh scene alignment. Invoked on `AFTER_SCENE_LAUNCH` and `AFTER_UPDATE`.
 *     - If `_nodesOrderDirty` is true, rebuild `activeWidgets` by traversing the scene.
 *     - Iterate via `_activeWidgetsIterator` and align each widget marked `_dirty`.
 *     Sets `isAligning` while processing to guard against re-entrancy.
 * @zh 刷新场景对齐：在 `AFTER_SCENE_LAUNCH` 与 `AFTER_UPDATE` 时触发。
 *     - 若 `_nodesOrderDirty` 为 true，则遍历场景重建 `activeWidgets`。
 *     - 通过 `_activeWidgetsIterator` 迭代，对 `_dirty` 的组件执行对齐。
 *     处理期间设置 `isAligning`，避免重入。
 * @returns {void}
 */
function refreshScene (): void {
    const scene = director.getScene();
    if (scene) {
        widgetManager.isAligning = true;
        if (widgetManager._nodesOrderDirty) {
            activeWidgets.length = 0;
            visitNode(scene);
            widgetManager._nodesOrderDirty = false;
        }
        const i = 0;
        let widget: Widget | null = null;
        const iterator = widgetManager._activeWidgetsIterator;
        for (iterator.i = 0; iterator.i < activeWidgets.length; ++iterator.i) {
            widget = activeWidgets[iterator.i];
            if (widget._dirty) {
                align(widget.node, widget);
                widget._dirty = false;
            }
        }
        widgetManager.isAligning = false;
    }

    // check animation editor
    if (EDITOR) {
        widgetManager.animationState!.animatedSinceLastFrame = false;
    }
}

/**
 * @en Internal list of active `Widget` components collected during scene traversal.
 *     Rebuilt when `_nodesOrderDirty` is true; iterated by `_activeWidgetsIterator` in `refreshScene`.
 * @zh 场景遍历过程中收集的活动 `Widget` 组件列表。
 *     当 `_nodesOrderDirty` 为 true 时会重建；在 `refreshScene` 中由 `_activeWidgetsIterator` 迭代处理。
 */
const activeWidgets: Widget[] = [];

/**
 * @en Force parent-first alignment from the scene down to a specific node.
 *     Recursively climbs to the root, then aligns the node if it has an enabled `Widget`.
 *     Useful when manual realignment is required after structural changes.
 * @zh 从场景到指定节点执行“先父后子”的强制对齐。
 *     递归向上追溯到根节点后，再对当前节点进行对齐（前提是存在启用的 `Widget`）。
 *     常用于结构变更后需要手动触发重新对齐的场景。
 * @param {Node} node The node to align.
 * @returns {void}
 * @example
 * // Realign a branch after changing parent layout
 * widgetManager.updateAlignment(myNode);
 */
function updateAlignment (node: Node): void {
    const parent = node.parent;
    if (parent && Node.isNode(parent)) {
        updateAlignment(parent);
    }

    // node._widget will be null when widget is disabled
    const widget = node.getComponent(Widget);
    if (widget && parent) {
        align(node, widget);
    }
}

/**
 * @en Widget Manager — orchestrates alignment for `Widget` components across the scene.
 *     - Scans the scene after launch and after each update to align widgets marked dirty.
 *     - Subscribes to design resolution, canvas, and window resize events to mark affected widgets dirty.
 *     - Exposes helpers to recompute offsets (stay-put) and to perform parent-first alignment.
 *     Note: This is engine-private since v3.7.0; the interface may change or be removed.
 * @zh Widget 管理器 —— 负责全局 `Widget` 组件的布局/对齐调度。
 *     - 在场景启动后与每帧更新后，扫描并对齐处于脏态的组件。
 *     - 监听设计分辨率、画布与窗口尺寸变化，标记相关组件为脏以便下一帧对齐。
 *     - 提供重新计算偏移（保持视觉位置不变）与“先父后子”的强制对齐辅助方法。
 *     注意：自 v3.7.0 起属于引擎私有接口，未来可能变更或移除。
 * @deprecated Since v3.7.0, this is an engine private interface that will be removed in the future.
 */
export const widgetManager = cclegacy._widgetManager = {
    /**
     * @en Whether the manager is currently performing alignment iteration.
     * @zh 管理器当前是否处于对齐迭代过程。
     * @type {boolean}
     */
    isAligning: false,
    /**
     * @en Indicates node traversal order changed; triggers `activeWidgets` rebuild on next scan.
     * @zh 表示节点遍历顺序发生变化；在下次扫描时触发 `activeWidgets` 重建。
     * @type {boolean}
     */
    _nodesOrderDirty: false,
    /**
     * @en Forward iterator over `activeWidgets` that supports safe removal during traversal.
     * @zh 用于遍历 `activeWidgets` 的前向迭代器，支持在遍历过程中安全移除元素。
     * @type {js.array.MutableForwardIterator<Widget>}
     */
    _activeWidgetsIterator: new js.array.MutableForwardIterator(activeWidgets),
    // hack
    /**
     * @en Editor-only animation preview state. When `EDITOR` is true, holds preview flags
     *     and indicates whether widgets were animated since the last frame.
     * @zh 仅在编辑器中的动画预览状态。当 `EDITOR` 为 true 时，包含预览标志与“上一帧是否有动画”信息。
     * @type {{ previewing: boolean; time: number; animatedSinceLastFrame: boolean } | null}
     */
    animationState: EDITOR ? {
        previewing: false,
        time: 0,
        animatedSinceLastFrame: false,
    } : null,

    /**
     * @en Initialize widget manager subscriptions and scene scanning.
     *     - Subscribes to `AFTER_SCENE_LAUNCH` and `AFTER_UPDATE` to scan and align dirty widgets.
     *     - Listens to `design-resolution-changed`, `canvas-resize`, and `window-resize` to mark widgets dirty.
     *     Implementation detail: in non-editor runtime, uses a bound `thisOnResized` to unsubscribe safely.
     * @zh 初始化 Widget 管理器的事件监听与场景扫描。
     *     - 监听 `AFTER_SCENE_LAUNCH` 与 `AFTER_UPDATE`，在这些时机扫描并对齐处于脏态的组件。
     *     - 监听 `design-resolution-changed`、`canvas-resize`、`window-resize`，在分辨率/画布/窗口变化时标记组件为脏。
     *     说明：在非编辑器环境，使用绑定后的 `thisOnResized` 以便后续解除监听时引用一致。
     * @example
     * // Manager is initialized automatically on Director INIT.
     * // For custom lifecycle, you can call:
     * // widgetManager.init();
     * @returns {void}
     */
    init (): void {
        director.on(DirectorEvent.AFTER_SCENE_LAUNCH, refreshScene);
        director.on(DirectorEvent.AFTER_UPDATE, refreshScene);

        View.instance.on('design-resolution-changed', this.onResized, this);
        if (!EDITOR) {
            const thisOnResized = this.onResized.bind(this);
            View.instance.on('canvas-resize', thisOnResized);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            screenAdapter.on('window-resize', thisOnResized);
        }
    },
    /**
     * @en Register a `Widget` for ordering refresh.
     *     Marks node traversal order dirty so next scene scan rebuilds `activeWidgets`.
     * @zh 注册一个 `Widget` 以刷新排序。
     *     将节点遍历顺序标记为脏，下一次场景扫描时重建 `activeWidgets` 列表。
     * @returns {void}
     */
    add (widget: Widget): void {
        this._nodesOrderDirty = true;
    },
    /**
     * @en Unregister a `Widget` from active iteration.
     *     Removes the widget via the active iterator to avoid index invalidation during traversal.
     * @zh 从迭代中注销指定 `Widget`。
     *     通过迭代器移除，避免遍历期间索引失效问题。
     * @param {Widget} widget The widget component to remove.
     * @returns {void}
     */
    remove (widget: Widget): void {
        this._activeWidgetsIterator.remove(widget);
    },
    /**
     * @en Resize handler: marks widgets dirty under the current scene.
     *     Invoked on design/canvas/window resize; triggers a recursive refresh starting from scene root.
     * @zh 尺寸变化回调：对当前场景中的widget组件标记脏态。
     *     在设计分辨率/画布/窗口尺寸变化时调用；从场景根节点递归刷新。
     * @returns {void}
     */
    onResized (): void {
        const scene = director.getScene();
        if (scene) {
            this.refreshWidgetOnResized(scene);
        }
    },
    /**
     * @en Recursively mark widgets dirty under `node` when a resize occurs.
     *     Filters widgets by `alignMode` (only `ON_WINDOW_RESIZE` or `ALWAYS`) and enabled state.
     * @zh 在发生尺寸变化时，递归地标记 `node` 子树中的widget组件为脏。
     *     仅筛选 `alignMode` 为 `ON_WINDOW_RESIZE` 或 `ALWAYS` 且已启用的widget组件。
     * @param {Node} node Root node to start recursion from.
     * @returns {void}
     */
    refreshWidgetOnResized (node: Node): void {
        const widget = Node.isNode(node) && node.getComponent(Widget);
        if (widget && widget.enabled && (
            widget.alignMode === AlignMode.ON_WINDOW_RESIZE || widget.alignMode === AlignMode.ALWAYS
        )) {
            widget.setDirty();
        }

        const children = node.children;
        for (const child of children) {
            this.refreshWidgetOnResized(child);
        }
    },
    /**
     * @en Recompute `Widget` offsets so that the visual position stays unchanged.
     *     Computes new left/right/top/bottom offsets for the given `alignFlags` under current parent/target transform.
     *     Useful when anchor/size/scale changed and you want the node to “stay put”.
     * @zh 重新计算 `Widget` 的偏移量，使节点的视觉位置保持不变。
     *     在当前父级/目标变换下，根据 `alignFlags` 更新对应的 left/right/top/bottom。
     *     常用于锚点、尺寸或缩放变化后希望节点“原地不动”的场景。
     * @param {Widget} widget The widget component whose offsets are updated.
     * @param {AlignFlags} [e] Bitmask of edges to update (e.g. `AlignFlags.LEFT | AlignFlags.RIGHT`).
     * @returns {void}
     * @example
     * // Keep position after changing anchor/size
     * const flags = AlignFlags.LEFT | AlignFlags.RIGHT | AlignFlags.TOP | AlignFlags.BOT;
     * widgetManager.updateOffsetsToStayPut(myWidget, flags);
     */
    updateOffsetsToStayPut (widget: Widget, e?: AlignFlags): void {
        function i (t: number, c: number): number {
            return Math.abs(t - c) > 1e-10 ? c : t;
        }
        const widgetNode = widget.node;
        let widgetParent = widgetNode.parent;
        if (widgetParent) {
            const zero = _tempVec2_1;
            zero.set(0, 0);
            const one = _tempVec2_2;
            one.set(1, 1);
            if (widget.target) {
                widgetParent = widget.target;
                computeInverseTransForTarget(widgetNode, widgetParent, zero, one);
            }

            if (!e) {
                return;
            }

            const parentTrans = widgetParent._uiProps && widgetParent._getUITransformComp();
            const parentAP = parentTrans ? parentTrans.anchorPoint : _defaultAnchor;
            const trans = widgetNode._getUITransformComp()!;
            const matchSize = getReadonlyNodeSize(widgetParent);
            const myAP = trans.anchorPoint;
            const pos = widgetNode.position;
            const alignFlags = AlignFlags;
            const widgetNodeScale = widgetNode.scale;

            let temp = 0;

            if (e & alignFlags.LEFT) {
                let l = -parentAP.x * matchSize.width;
                l += zero.x;
                l *= one.x;
                temp = pos.x - myAP.x * trans.width * Math.abs(widgetNodeScale.x) - l;
                if (!widget.isAbsoluteLeft) {
                    temp /= matchSize.width;
                }

                temp /= one.x;
                widget.left = i(widget.left, temp);
            }

            if (e & alignFlags.RIGHT) {
                let r = (1 - parentAP.x) * matchSize.width;
                r += zero.x;
                temp = (r *= one.x) - (pos.x + (1 - myAP.x) * trans.width * Math.abs(widgetNodeScale.x));
                if (!widget.isAbsoluteRight) {
                    temp /= matchSize.width;
                }

                temp /= one.x;
                widget.right = i(widget.right, temp);
            }

            if (e & alignFlags.TOP) {
                let t = (1 - parentAP.y) * matchSize.height;
                t += zero.y;
                temp = (t *= one.y) - (pos.y + (1 - myAP.y) * trans.height * Math.abs(widgetNodeScale.y));
                if (!widget.isAbsoluteTop) {
                    temp /= matchSize.height;
                }

                temp /= one.y;
                widget.top = i(widget.top, temp);
            }

            if (e & alignFlags.BOT) {
                let b = -parentAP.y * matchSize.height;
                b += zero.y;
                b *= one.y;
                temp = pos.y - myAP.y * trans.height * Math.abs(widgetNodeScale.y) - b;
                if (!widget.isAbsoluteBottom) {
                    temp /= matchSize.height;
                }

                temp /= one.y;
                widget.bottom = i(widget.bottom, temp);
            }
        }
    },
    updateAlignment,
    /**
     * @en Alignment mode enum for `Widget` components.
     *     - `ALWAYS`: align every frame
     *     - `ON_WINDOW_RESIZE`: align only when window/canvas/design resolution changes
     *     - `ONCE`: align once in non-editor runtime
     * @zh `Widget` 组件的对齐模式枚举。
     *     - `ALWAYS`：每帧对齐
     *     - `ON_WINDOW_RESIZE`：仅在窗口/画布/设计分辨率变化时对齐
     *     - `ONCE`：在非编辑器环境中仅对齐一次
     */
    AlignMode,
    /**
     * @en Bitmask flags describing edges/centers for alignment and stretch.
     *     Includes composite masks `HORIZONTAL` and `VERTICAL` for convenience.
     * @zh 用于描述对齐与拉伸的边缘/中心的位标志。
     *     包含 `HORIZONTAL` 与 `VERTICAL`。
     */
    AlignFlags,
};

director.on(DirectorEvent.INIT, () => {
    widgetManager.init();
});
