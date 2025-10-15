/*
 Copyright (c) 2025 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

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

import { JSB } from 'internal:constants';
import { ccclass, disallowMultiple, displayOrder, executeInEditMode, menu, serializable, type } from 'cc.decorator';
import { Component } from '../../scene-graph/component';
import { CCBoolean, cclegacy, IVec2Like, v2, Vec2 } from '../../core';
import { NodeEventType, TransformBit } from '../../scene-graph';
import { TRANSFORM_ON, Node } from '../../scene-graph/node';

/**
 * @en Temporary Vec2 instance used for internal calculations to avoid frequent memory allocations.
 * @zh 用于内部计算的临时Vec2实例，避免频繁的内存分配。
 * @internal
 */
const tempVec2 = v2();

/**
 * @en Enumeration defining different types of skew transformations.
 * @zh 定义不同类型斜切变换的枚举。
 * @enum {number}
 */
enum SkewType {
    /** @en No skew transformation applied. @zh 不应用斜切变换。 */
    NONE = 0,
    /** @en Standard skew transformation using shear matrix. @zh 使用剪切矩阵的标准斜切变换。 */
    STANDARD,
    /** @en Rotational skew transformation for special effects. @zh 用于特殊效果的旋转式斜切变换。 */
    ROTATIONAL,
}
/**
 * @en UISkew component provides skew transformation functionality for UI nodes.
 * This component allows you to apply shear transformations to nodes, creating
 * slanted or skewed visual effects. It supports both standard matrix-based skewing
 * and rotational skewing modes.
 *
 * @zh UISkew组件为UI节点提供斜切变换功能。
 * 该组件允许对节点应用剪切变换，创建倾斜或扭曲的视觉效果。
 * 支持基于矩阵的标准斜切和旋转式斜切两种模式。
 *
 * @example
 * ```typescript
 * // Add skew component to a node
 * const skewComp = node.addComponent(UISkew);
 * skewComp.setSkew(15, 0); // Skew 15 degrees on X axis
 * skewComp.rotational = true; // Enable rotational mode
 * ```
 */
@ccclass('cc.UISkew')
@menu('UI/UISkew')
@disallowMultiple
@executeInEditMode
export class UISkew extends Component {
    /**
     * @en Internal skew values stored as Vec2 (x, y) in degrees.
     * @zh 内部存储的斜切值，以Vec2格式存储(x, y)，单位为度。
     * @private
     */
    @serializable
    private _skew: Vec2 = v2();

    /**
     * @en Flag indicating whether to use rotational skew mode instead of standard shear matrix.
     * @zh 标识是否使用旋转式斜切模式而非标准剪切矩阵。
     * @private
     */
    @serializable
    private _rotational = false;

    /**
     * @en Internal flag tracking the actual enabled state of skew functionality.
     * This is used instead of Component.enabled because during onDisable callback,
     * this.enabled may still return true, causing timing issues.
     * @zh 跟踪斜切功能实际启用状态的内部标志。
     * 使用此标志而非Component.enabled是因为在onDisable回调期间，
     * this.enabled可能仍返回true，导致时序问题。
     * @private
     */
    private _skewEnabled = false;

    /**
     * @en Constructor initializes the UISkew component.
     * @zh 构造函数初始化UISkew组件。
     */
    constructor () {
        super();
    }

    /**
     * @en Checks if the skew functionality is currently enabled.
     * This method is used internally by the engine to determine if skew
     * transformations should be applied during rendering.
     * @zh 检查斜切功能当前是否启用。
     * 引擎内部使用此方法来确定渲染时是否应应用斜切变换。
     * @returns {boolean} True if skew is enabled, false otherwise.
     * @engineInternal
     * @mangle
     */
    isSkewEnabled (): boolean {
        return this._skewEnabled;
    }

    /**
     * @en Gets or sets the rotational skew mode.
     * When true, uses rotational transformation instead of standard shear matrix.
     * Rotational mode provides different visual effects and may be more suitable
     * for certain animation scenarios.
     * @zh 获取或设置旋转式斜切模式。
     * 为true时，使用旋转变换而非标准剪切矩阵。
     * 旋转模式提供不同的视觉效果，可能更适合某些动画场景。
     * @default false
     */
    @displayOrder(0)
    @type(CCBoolean)
    get rotational (): boolean {
        return this._rotational;
    }

    set rotational (value: boolean) {
        this._rotational = value;
        if (this._skewEnabled) {
            this._updateNodeTransformFlags();
        }
    }

    /**
     * @en Component preload lifecycle method.
     * Registers this component with the node's UI properties and initializes
     * native skew values in JSB environment.
     * @zh 组件预加载生命周期方法。
     * 将此组件注册到节点的UI属性中，并在JSB环境中初始化原生斜切值。
     * @protected
     * @override
     */
    protected override __preload (): void {
        this.node._uiProps._uiSkewComp = this;
        if (JSB) {
            (this.node as any)._setSkew(this._skew);
        }
    }

    /**
     * @en Component enable lifecycle method.
     * Activates skew functionality, increments global skew component counter,
     * synchronizes with native implementation, and updates transform flags.
     * @zh 组件启用生命周期方法。
     * 激活斜切功能，增加全局斜切组件计数器，与原生实现同步，并更新变换标志。
     * @protected
     * @override
     */
    protected override onEnable (): void {
        this._skewEnabled = true;
        Node._incSkewCompCount();
        this._syncNative(true);
        this._updateNodeTransformFlags();
    }

    /**
     * @en Component disable lifecycle method.
     * Deactivates skew functionality, decrements global skew component counter,
     * synchronizes with native implementation, and updates transform flags.
     * @zh 组件禁用生命周期方法。
     * 停用斜切功能，减少全局斜切组件计数器，与原生实现同步，并更新变换标志。
     * @protected
     * @override
     */
    protected override onDisable (): void {
        this._skewEnabled = false;
        Node._decSkewCompCount();
        this._syncNative(false);
        this._updateNodeTransformFlags();
    }

    /**
     * @en Component destroy lifecycle method.
     * Cleans up skew functionality, synchronizes with native implementation,
     * removes component reference from node, and updates transform flags.
     * @zh 组件销毁生命周期方法。
     * 清理斜切功能，与原生实现同步，从节点移除组件引用，并更新变换标志。
     * @protected
     * @override
     */
    protected override onDestroy (): void {
        this._skewEnabled = false;
        this._syncNative(false);
        this.node._uiProps._uiSkewComp = null;
        this._updateNodeTransformFlags();
    }

    /**
     * @en Synchronizes the skew state with the native JSB implementation.
     * This method updates the native node's skew type based on the current
     * enabled state and rotational mode. Only operates in JSB environment.
     * @zh 与原生JSB实现同步斜切状态。
     * 此方法根据当前启用状态和旋转模式更新原生节点的斜切类型。
     * 仅在JSB环境中操作。
     * @param enabled Whether skew functionality should be enabled in native code.
     * @private
     */
    private _syncNative (enabled: boolean): void {
        if (JSB) {
            const node = this.node as any;
            if (enabled) {
                node._skewType = this._rotational ? SkewType.ROTATIONAL : SkewType.STANDARD;
            } else {
                node._skewType = SkewType.NONE;
            }
        }
    }

    /**
     * @en Gets the skew angle on X axis in degrees.
     * Positive values skew the node to the right, negative values to the left.
     * @zh 获取X轴斜切角度（度）。
     * 正值向右倾斜节点，负值向左倾斜。
     * @returns {number} The X axis skew angle in degrees.
     */
    get x (): number {
        return this._skew.x;
    }

    /**
     * @en Sets the skew angle on X axis in degrees.
     * This will immediately update the node's transform if the component is enabled.
     * In JSB environment, also synchronizes with native implementation.
     * @zh 设置X轴斜切角度（度）。
     * 如果组件已启用，将立即更新节点变换。
     * 在JSB环境中，同时与原生实现同步。
     * @param v The X axis skew angle in degrees.
     */
    set x (v: number) {
        this._skew.x = v;
        if (JSB) {
            (this.node as any)._setSkewX(v);
        }

        if (this._skewEnabled) {
            this._updateNodeTransformFlags();
        }
    }

    /**
     * @en Gets the skew angle on Y axis in degrees.
     * Positive values skew the node upward, negative values downward.
     * @zh 获取Y轴斜切角度（度）。
     * 正值向上倾斜节点，负值向下倾斜。
     * @returns {number} The Y axis skew angle in degrees.
     */
    get y (): number {
        return this._skew.y;
    }

    /**
     * @en Sets the skew angle on Y axis in degrees.
     * This will immediately update the node's transform if the component is enabled.
     * In JSB environment, also synchronizes with native implementation.
     * @zh 设置Y轴斜切角度（度）。
     * 如果组件已启用，将立即更新节点变换。
     * 在JSB环境中，同时与原生实现同步。
     * @param v The Y axis skew angle in degrees.
     */
    set y (v: number) {
        this._skew.y = v;
        if (JSB) {
            (this.node as any)._setSkewY(v);
        }

        if (this._skewEnabled) {
            this._updateNodeTransformFlags();
        }
    }

    /**
     * @en Gets the complete skew transformation as a readonly Vec2.
     * Returns the current skew angles for both X and Y axes in degrees.
     * The returned object is readonly to prevent direct modification.
     * @zh 获取完整的斜切变换作为只读Vec2。
     * 返回X和Y轴的当前斜切角度（度）。
     * 返回的对象是只读的，防止直接修改。
     * @returns {Readonly<Vec2>} The skew values as a readonly Vec2 (x, y) in degrees.
     */
    @displayOrder(1)
    @type(Vec2)
    get skew (): Readonly<Vec2> {
        return this._skew;
    }

    /**
     * @en Sets the complete skew transformation using a Vec2.
     * This is a convenience setter that delegates to the setSkew method.
     * @zh 使用Vec2设置完整的斜切变换。
     * 这是一个便利的设置器，委托给setSkew方法。
     * @param value The skew values as Vec2 (x, y) in degrees.
     */
    set skew (value: Readonly<Vec2>) {
        this.setSkew(value);
    }

    /**
     * @en Sets the skew transformation using a Vec2-like object.
     * This method efficiently updates both X and Y skew values simultaneously.
     * If the new values are identical to current values, no update occurs.
     * @zh 使用类Vec2对象设置斜切变换。
     * 此方法高效地同时更新X和Y斜切值。
     * 如果新值与当前值相同，则不进行更新。
     * @param value The skew values as Vec2-like object (x, y) in degrees.
     */
    setSkew (value: Readonly<IVec2Like>): void;
    /**
     * @en Sets the skew transformation using separate X and Y values.
     * This overload provides a convenient way to set skew values directly
     * without creating a Vec2 object.
     * @zh 使用分离的X和Y值设置斜切变换。
     * 此重载提供了直接设置斜切值的便利方式，无需创建Vec2对象。
     * @param x The skew angle on X axis in degrees.
     * @param y The skew angle on Y axis in degrees.
     */
    setSkew (x: number, y: number): void;
    setSkew (xOrVec2: number | Readonly<IVec2Like>, y?: number): void {
        const v = this._skew;
        if (typeof xOrVec2 === 'number') {
            tempVec2.set(xOrVec2, y);
        } else {
            Vec2.copy(tempVec2, xOrVec2);
        }
        if (Vec2.equals(v, tempVec2)) return;

        v.set(tempVec2);
        if (JSB) {
            (this.node as any)._setSkew(v);
        }

        if (this._skewEnabled) {
            this._updateNodeTransformFlags();
        }
    }

    /**
     * @en Copies the current skew values to an output Vec2 and returns it.
     * This method is useful when you need a mutable copy of the skew values
     * for calculations or modifications without affecting the original.
     * @zh 将当前斜切值复制到输出Vec2并返回。
     * 当需要斜切值的可变副本进行计算或修改而不影响原始值时，此方法很有用。
     * @param out Optional output Vec2 to store the result. If not provided, a new Vec2 will be created.
     * @returns {Vec2} A Vec2 containing the copied skew values (x, y) in degrees.
     */
    getSkew (out?: Vec2): Vec2 {
        if (!out) out = new Vec2();
        return out.set(this._skew);
    }

    /**
     * @en Updates the node's transform flags and notifies about skew changes.
     * This method invalidates child nodes' transforms and emits transform
     * change events if the node has transform listeners registered.
     * Called whenever skew values change to ensure proper rendering updates.
     * @zh 更新节点的变换标志并通知斜切变化。
     * 此方法使子节点的变换失效，如果节点注册了变换监听器则发出变换
     * 变化事件。每当斜切值变化时调用，以确保正确的渲染更新。
     * @private
     */
    private _updateNodeTransformFlags (): void {
        const node = this.node;
        node.invalidateChildren(TransformBit.SKEW);
        if ((node as any)._eventMask & TRANSFORM_ON) {
            node.emit(NodeEventType.TRANSFORM_CHANGED, TransformBit.SKEW);
        }
    }
}

cclegacy.UISkew = UISkew;
