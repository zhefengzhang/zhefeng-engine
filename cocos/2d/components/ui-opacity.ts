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

import { ccclass, disallowMultiple, editable, executeInEditMode, executionOrder, help, menu, serializable, tooltip } from 'cc.decorator';
import { EDITOR_NOT_IN_PREVIEW, JSB } from 'internal:constants';
import { Component } from '../../scene-graph/component';
import { clamp } from '../../core';

/**
 * @en
 * UI Opacity Component - Controls transparency for UI elements and their children.
 * 
 * This component provides a unified way to control opacity across UI hierarchies:
 * - Affects all child nodes recursively through the rendering pipeline
 * - Uses normalized opacity values (0-1) internally for rendering calculations
 * - Integrates with the node's _uiProps.localOpacity for efficient batch processing
 * - Automatically synchronizes opacity changes with the rendering system
 * - Execution order 110 ensures proper initialization before other UI components
 * 
 * Technical Details:
 * - Input range: 0-255 (8-bit integer for editor compatibility)
 * - Internal range: 0.0-1.0 (normalized float for GPU calculations)
 * - Affects rendering through node._uiProps.localOpacity property
 * - Does not modify existing color.alpha values on render components
 * 
 * Use Cases:
 * - Fade in/out animations for UI panels
 * - Dynamic transparency control for interactive elements
 * - Batch opacity changes for complex UI hierarchies
 * - Alternative to modifying individual component colors
 *
 * @zh
 * UI 透明度组件 - 控制 UI 元素及其子节点的透明度。
 * 
 * 该组件提供了统一的方式来控制 UI 层次结构的透明度：
 * - 通过渲染管线递归影响所有子节点
 * - 内部使用归一化透明度值 (0-1) 进行渲染计算
 * - 与节点的 _uiProps.localOpacity 集成以实现高效批处理
 * - 自动将透明度变化与渲染系统同步
 * - 执行顺序 110 确保在其他 UI 组件之前正确初始化
 * 
 * 技术细节：
 * - 输入范围：0-255（8位整数，兼容编辑器）
 * - 内部范围：0.0-1.0（归一化浮点数，用于GPU计算）
 * - 通过 node._uiProps.localOpacity 属性影响渲染
 * - 不修改渲染组件上现有的 color.alpha 值
 * 
 * 使用场景：
 * - UI 面板的淡入淡出动画
 * - 交互元素的动态透明度控制
 * - 复杂 UI 层次结构的批量透明度变化
 * - 替代修改单个组件颜色的方案
 */
@ccclass('cc.UIOpacity')
@help('i18n:cc.UIOpacity')
@executionOrder(110)
@menu('UI/UIOpacity')
@executeInEditMode
@disallowMultiple
export class UIOpacity extends Component {
    constructor () {
        super();
    }

    /**
     * @en
     * Opacity value that controls the transparency of this UI element and its children.
     * 
     * Value Range & Behavior:
     * - Input: 0-255 (integer, where 0 = fully transparent, 255 = fully opaque)
     * - Automatically clamped to valid range using clamp(value, 0, 255)
     * - Converted to normalized 0.0-1.0 range for internal rendering calculations
     * - Changes trigger immediate synchronization with node._uiProps.localOpacity
     * 
     * Technical Implementation:
     * - Setter performs value validation and normalization (value / 255)
     * - Calls _syncLocalOpacity() to update the rendering system
     * - In editor mode, triggers node change events with 200ms delay
     * - Early return optimization when setting the same value
     * 
     * Rendering Impact:
     * - Affects all child UI elements through the rendering pipeline
     * - Does not modify existing color.alpha values on render components
     * - Multiplied with parent opacity values for hierarchical transparency
     * - Processed during UI batch rendering for optimal performance
     *
     * @zh
     * 控制此 UI 元素及其子元素透明度的不透明度值。
     * 
     * 取值范围和行为：
     * - 输入：0-255（整数，其中 0 = 完全透明，255 = 完全不透明）
     * - 使用 clamp(value, 0, 255) 自动限制到有效范围
     * - 转换为归一化的 0.0-1.0 范围用于内部渲染计算
     * - 更改会立即触发与 node._uiProps.localOpacity 的同步
     * 
     * 技术实现：
     * - setter 执行值验证和归一化（value / 255）
     * - 调用 _syncLocalOpacity() 更新渲染系统
     * - 在编辑器模式下，延迟 200ms 触发节点变更事件
     * - 设置相同值时的早期返回优化
     * 
     * 渲染影响：
     * - 通过渲染管线影响所有子 UI 元素
     * - 不修改渲染组件上现有的 color.alpha 值
     * - 与父级透明度值相乘实现层次透明度
     * - 在 UI 批量渲染期间处理以获得最佳性能
     */
    @editable
    @tooltip('i18n:UIOpacity.opacity')
    get opacity (): number {
        return this._opacity;
    }

    set opacity (value) {
        if (this._opacity === value) {
            return;
        }
        value = clamp(value, 0, 255);
        this._opacity = value;
        this._syncLocalOpacity(value / 255);

        if (EDITOR_NOT_IN_PREVIEW) {
            setTimeout(() => {
                EditorExtends.Node.emit('change', this.node.uuid, this.node);
            }, 200);
        }
    }

    @serializable
    protected _opacity = 255;

    /**
     * @en
     * Component lifecycle method called when the component is enabled.
     * Synchronizes the current opacity value with the rendering system.
     * 
     * Technical Details:
     * - Converts stored _opacity (0-255) to normalized value (0.0-1.0)
     * - Calls _syncLocalOpacity() to update node._uiProps.localOpacity
     * - Ensures proper opacity state when component becomes active
     * - Part of the component activation sequence
     *
     * @zh
     * 组件启用时调用的生命周期方法。
     * 将当前透明度值与渲染系统同步。
     * 
     * 技术细节：
     * - 将存储的 _opacity (0-255) 转换为归一化值 (0.0-1.0)
     * - 调用 _syncLocalOpacity() 更新 node._uiProps.localOpacity
     * - 确保组件激活时的正确透明度状态
     * - 组件激活序列的一部分
     */
    public onEnable (): void {
        this._syncLocalOpacity(this._opacity / 255);
    }

    /**
     * @en
     * Component lifecycle method called when the component is disabled.
     * Resets the opacity to fully opaque (1.0) to restore normal rendering.
     * 
     * Technical Details:
     * - Sets localOpacity to 1.0 (fully opaque) regardless of stored _opacity value
     * - Ensures child nodes are not affected by disabled opacity component
     * - Restores normal rendering behavior when component is inactive
     * - Part of the component deactivation sequence
     *
     * @zh
     * 组件禁用时调用的生命周期方法。
     * 将透明度重置为完全不透明 (1.0) 以恢复正常渲染。
     * 
     * 技术细节：
     * - 无论存储的 _opacity 值如何，都将 localOpacity 设置为 1.0（完全不透明）
     * - 确保子节点不受禁用的透明度组件影响
     * - 组件非激活时恢复正常渲染行为
     * - 组件停用序列的一部分
     */
    public onDisable (): void {
        this._syncLocalOpacity(1);
    }

    /**
     * @en
     * Internal method to synchronize opacity value with the node's UI properties.
     * Updates the node's localOpacity which affects rendering calculations.
     * 
     * Technical Details:
     * - Directly modifies node._uiProps.localOpacity property
     * - localOpacity is used by the rendering system for UI batch processing
     * - Value is multiplied with parent opacity values in the rendering pipeline
     * - Triggers rendering updates for this node and its children
     * - Core method for opacity propagation through the UI hierarchy
     * 
     * @param localOpacity Normalized opacity value (0.0-1.0) to apply
     *
     * @zh
     * 将透明度值与节点的 UI 属性同步的内部方法。
     * 更新节点的 localOpacity，这会影响渲染计算。
     * 
     * 技术细节：
     * - 直接修改 node._uiProps.localOpacity 属性
     * - localOpacity 被渲染系统用于 UI 批处理
     * - 在渲染管线中与父级透明度值相乘
     * - 触发此节点及其子节点的渲染更新
     * - 透明度在 UI 层次结构中传播的核心方法
     * 
     * @param localOpacity 要应用的归一化透明度值 (0.0-1.0)
     */
    private _syncLocalOpacity (localOpacity: number): void {
        this.node._uiProps.localOpacity = localOpacity;
    }
}
