/*
 Copyright (c) 2013-2016 Chukong Technologies Inc.
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

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

import { ccclass, help, disallowMultiple, executeInEditMode,
    executionOrder, menu, tooltip, type, serializable } from 'cc.decorator';
import { EDITOR_NOT_IN_PREVIEW } from 'internal:constants';
import { Camera, CameraEvent } from '../../misc/camera-component';
import { Widget } from '../../ui/widget';
import { Vec3, screen, Enum, cclegacy, visibleRect } from '../../core';
import { view } from '../../ui/view';
import { RenderRoot2D } from './render-root-2d';

const _worldPos = new Vec3();

enum CanvasRenderMode {
    OVERLAY = 0,
    INTERSPERSE= 1,
}

/**
 * @en
 * Canvas is the root container for all UI elements in the 2D rendering system.
 * It manages the UI rendering pipeline by providing:
 * - Screen space alignment and coordinate transformation for all child UI nodes
 * - Camera management for UI rendering with automatic viewport synchronization
 * - Screen adaptation policies for different device resolutions and aspect ratios
 * - Render mode control to determine UI rendering order relative to 3D scene cameras
 * 
 * The Canvas automatically maintains a coordinate system where UI elements are positioned
 * in screen space with a depth range from -999 to 1000. It ensures consistent UI layout
 * across different screen sizes through its alignment and scaling mechanisms.
 * 
 * Note: Canvas size automatically adapts to screen changes, so anchorPoint is fixed at (0.5, 0.5)
 * to prevent coordinate drift during screen adaptation.
 *
 * @zh
 * Canvas 是 2D 渲染系统中所有 UI 元素的根容器。
 * 它通过以下功能管理 UI 渲染管线：
 * - 为所有子 UI 节点提供屏幕空间对齐和坐标变换
 * - 管理 UI 渲染相机并自动同步视口
 * - 提供屏幕适配策略以支持不同设备分辨率和宽高比
 * - 控制渲染模式以确定 UI 相对于 3D 场景相机的渲染顺序
 * 
 * Canvas 自动维护一个坐标系统，UI 元素在屏幕空间中定位，深度范围为 -999 到 1000。
 * 通过对齐和缩放机制确保 UI 布局在不同屏幕尺寸下的一致性。
 * 
 * 注意：Canvas 尺寸会自动适配屏幕变化，因此 anchorPoint 固定为 (0.5, 0.5)，
 * 以防止屏幕适配时出现坐标偏移。
 */
@ccclass('cc.Canvas')
@help('i18n:cc.Canvas')
@executionOrder(100)
@menu('UI/Canvas')
@executeInEditMode
@disallowMultiple
export class Canvas extends RenderRoot2D {
    /**
     * @en
     * Controls how the Canvas UI rendering integrates with the 3D scene rendering pipeline.
     * 
     * - OVERLAY (0): UI renders after all 3D scene cameras complete their rendering.
     *   This ensures UI elements always appear on top of the 3D scene content.
     *   The Canvas camera priority is automatically set with a high-priority flag (bit 30).
     * 
     * - INTERSPERSE (1): UI rendering can be interleaved with 3D scene cameras based on camera priority.
     *   This allows for complex layering where UI elements can appear behind or in front of 3D objects.
     *   The Canvas camera priority follows the standard priority system without special flags.
     * 
     * The render mode affects the Canvas camera's priority calculation in _getViewPriority().
     * 
     * NOTE: For proper rendering on mobile devices, ensure at least one camera in the scene
     * (including the Canvas camera) has ClearFlag set to SOLID_COLOR to prevent screen flickering.
     *
     * @zh
     * 控制 Canvas UI 渲染如何与 3D 场景渲染管线集成。
     * 
     * - OVERLAY (0): UI 在所有 3D 场景相机完成渲染后进行渲染。
     *   这确保 UI 元素始终显示在 3D 场景内容之上。
     *   Canvas 相机优先级会自动设置高优先级标志（第 30 位）。
     * 
     * - INTERSPERSE (1): UI 渲染可以根据相机优先级与 3D 场景相机交错进行。
     *   这允许复杂的分层，UI 元素可以出现在 3D 对象的后面或前面。
     *   Canvas 相机优先级遵循标准优先级系统，不使用特殊标志。
     * 
     * 渲染模式影响 Canvas 相机在 _getViewPriority() 中的优先级计算。
     * 
     * 注意：为了在移动设备上正确渲染，请确保场景中至少有一个相机
     * （包括 Canvas 相机）的 ClearFlag 设置为 SOLID_COLOR，以防止屏幕闪烁。
     * @deprecated since v3.0, please use [[Camera.priority]] to control overlapping between cameras.
     */
    get renderMode (): number {
        return this._renderMode;
    }
    set renderMode (val) {
        this._renderMode = val;

        if (this._cameraComponent) {
            this._cameraComponent.priority = this._getViewPriority();
        }
    }

    /**
     * @en
     * The camera component responsible for rendering this Canvas and its UI elements.
     * 
     * When assigned, the Canvas automatically manages this camera's properties:
     * - Position: Synchronized with Canvas world position, offset by 1000 units on Z-axis
     * - Orthographic height: Automatically calculated based on screen size and scale
     * - Priority: Set according to renderMode (OVERLAY adds high-priority flag)
     * - Viewport: Aligned with Canvas bounds when alignCanvasWithScreen is enabled
     * 
     * The camera is automatically created and configured during Canvas initialization.
     * Manual assignment allows for custom camera setups while maintaining automatic synchronization.
     * 
     * Event listeners are automatically managed for TARGET_TEXTURE_CHANGE to handle
     * render target modifications and viewport updates.
     *
     * @zh
     * 负责渲染此 Canvas 及其 UI 元素的相机组件。
     * 
     * 当分配后，Canvas 会自动管理此相机的属性：
     * - 位置：与 Canvas 世界位置同步，在 Z 轴上偏移 1000 单位
     * - 正交高度：根据屏幕尺寸和缩放自动计算
     * - 优先级：根据 renderMode 设置（OVERLAY 添加高优先级标志）
     * - 视口：当启用 alignCanvasWithScreen 时与 Canvas 边界对齐
     * 
     * 相机在 Canvas 初始化期间自动创建和配置。
     * 手动分配允许自定义相机设置，同时保持自动同步。
     * 
     * 自动管理 TARGET_TEXTURE_CHANGE 事件监听器以处理
     * 渲染目标修改和视口更新。
     */
    @type(Camera)
    @tooltip('i18n:canvas.camera')
    get cameraComponent (): Camera | null {
        return this._cameraComponent;
    }

    set cameraComponent (value) {
        if (this._cameraComponent === value) { return; }

        this._cameraComponent = value;

        this._onResizeCamera();
    }

    /**
     * @en
     * Controls whether the Canvas camera automatically synchronizes with screen dimensions and scaling.
     * 
     * When enabled (true):
     * - Camera orthographic height is automatically calculated based on screen size and view scale
     * - Camera position is synchronized with Canvas world position (offset by 1000 on Z-axis)
     * - Viewport automatically adapts to screen resolution changes
     * - Ensures consistent UI scaling across different device screen sizes
     * 
     * When disabled (false):
     * - Camera properties remain unchanged during screen resize events
     * - Manual camera configuration is preserved
     * - Useful for custom camera setups that don't require automatic screen adaptation
     * 
     * This property triggers _onResizeCamera() when changed to immediately apply the new alignment behavior.
     * Screen resize events (canvas-resize, design-resolution-changed) respect this setting.
     *
     * @zh
     * 控制 Canvas 相机是否自动与屏幕尺寸和缩放同步。
     * 
     * 启用时 (true)：
     * - 相机正交高度根据屏幕尺寸和视图缩放自动计算
     * - 相机位置与 Canvas 世界位置同步（Z 轴偏移 1000）
     * - 视口自动适配屏幕分辨率变化
     * - 确保 UI 在不同设备屏幕尺寸下的一致缩放
     * 
     * 禁用时 (false)：
     * - 屏幕调整事件期间相机属性保持不变
     * - 保留手动相机配置
     * - 适用于不需要自动屏幕适配的自定义相机设置
     * 
     * 此属性变更时会触发 _onResizeCamera() 以立即应用新的对齐行为。
     * 屏幕调整事件（canvas-resize、design-resolution-changed）会遵循此设置。
     */
    @tooltip('i18n:canvas.align')
    get alignCanvasWithScreen (): boolean {
        return this._alignCanvasWithScreen;
    }

    set alignCanvasWithScreen (value) {
        this._alignCanvasWithScreen = value;

        this._onResizeCamera();
    }

    @type(Camera)
    protected _cameraComponent: Camera | null = null;
    @serializable
    protected _alignCanvasWithScreen = true;

    protected declare _thisOnCameraResized: () => void;
    // fit canvas node to design resolution
    protected declare fitDesignResolution_EDITOR: (() => void) | undefined;

    private _pos = new Vec3();
    private _renderMode = CanvasRenderMode.OVERLAY;

    constructor () {
        super();
        this._thisOnCameraResized = this._onResizeCamera.bind(this);

        if (EDITOR_NOT_IN_PREVIEW) {
            this.fitDesignResolution_EDITOR = (): void => {
                // TODO: support paddings of locked widget
                this.node.getPosition(this._pos);
                const nodeSize = view.getDesignResolutionSize();
                const trans = this.node._getUITransformComp()!;

                let scaleX = this.node.scale.x;
                let anchorX = trans.anchorX;
                if (scaleX < 0) {
                    anchorX = 1.0 - anchorX;
                    scaleX = -scaleX;
                }
                nodeSize.width = scaleX === 0 ? nodeSize.width : nodeSize.width / scaleX;

                let scaleY = this.node.scale.y;
                let anchorY = trans.anchorY;
                if (scaleY < 0) {
                    anchorY = 1.0 - anchorY;
                    scaleY = -scaleY;
                }
                nodeSize.height = scaleY === 0 ? nodeSize.height : nodeSize.height / scaleY;

                Vec3.set(_worldPos, nodeSize.width * anchorX, nodeSize.height * anchorY, 0);

                if (!this._pos.equals(_worldPos)) {
                    this.node.setPosition(_worldPos);
                }
                if (trans.width !== nodeSize.width) {
                    trans.width = nodeSize.width;
                }
                if (trans.height !== nodeSize.height) {
                    trans.height = nodeSize.height;
                }
            };
        }
    }

    public __preload (): void {
        // Stretch to matched size during the scene initialization
        const widget = this.getComponent('cc.Widget') as unknown as Widget;
        if (widget) {
            widget.updateAlignment();
        } else if (EDITOR_NOT_IN_PREVIEW) {
            this.fitDesignResolution_EDITOR!();
        }

        if (!EDITOR_NOT_IN_PREVIEW) {
            if (this._cameraComponent) {
                this._cameraComponent._createCamera();
                // Register camera target texture change listener for render target adaptation
                this._cameraComponent.node.on(CameraEvent.TARGET_TEXTURE_CHANGE, this._thisOnCameraResized);
            }
        }

        this._onResizeCamera();

        if (EDITOR_NOT_IN_PREVIEW) {
            // In Editor can not edit these attrs.
            // (Position in Node, contentSize in uiTransform)
            // (anchor in uiTransform, but it can edit, this is different from cocos creator)
            this._objFlags |= cclegacy.Object.Flags.IsPositionLocked | cclegacy.Object.Flags.IsSizeLocked | cclegacy.Object.Flags.IsAnchorLocked;
        } else {
            // In Editor dont need resized camera when scene window resize
            view.on('canvas-resize', this._thisOnCameraResized, this);
            view.on('design-resolution-changed', this._thisOnCameraResized, this);
        }
    }

    public onEnable (): void {
        super.onEnable();
        if (!EDITOR_NOT_IN_PREVIEW && this._cameraComponent) {
            this._cameraComponent.node.on(CameraEvent.TARGET_TEXTURE_CHANGE, this._thisOnCameraResized);
        }
    }

    public onDisable (): void {
        super.onDisable();
        // Clean up camera target texture change listener to prevent memory leaks
        if (this._cameraComponent) {
            this._cameraComponent.node.off(CameraEvent.TARGET_TEXTURE_CHANGE, this._thisOnCameraResized);
        }
    }

    public onDestroy (): void {
        super.onDestroy();
        // Clean up view event listeners for editor/preview mode
        view.off('canvas-resize', this._thisOnCameraResized, this);
        view.off('design-resolution-changed', this._thisOnCameraResized, this);
    }

    /**
     * @en
     * Synchronizes the Canvas camera with screen dimensions and Canvas position.
     * 
     * This method is automatically called when:
     * - alignCanvasWithScreen property changes
     * - cameraComponent property changes
     * - Screen resize events occur (canvas-resize, design-resolution-changed)
     * - Camera target texture changes (TARGET_TEXTURE_CHANGE event)
     * 
     * When alignCanvasWithScreen is enabled, it performs:
     * - Calculates camera orthographic height based on screen size and view scale
     * - For render-to-texture: uses visibleRect.height / 2
     * - For screen rendering: uses windowSize.height / viewScale / 2
     * - Synchronizes camera world position with Canvas position (Z offset: 1000)
     * 
     * This ensures consistent UI rendering across different screen resolutions and device orientations.
     *
     * @zh
     * 将 Canvas 相机与屏幕尺寸和 Canvas 位置同步。
     * 
     * 此方法在以下情况下自动调用：
     * - alignCanvasWithScreen 属性变更时
     * - cameraComponent 属性变更时
     * - 屏幕调整事件发生时（canvas-resize、design-resolution-changed）
     * - 相机目标纹理变更时（TARGET_TEXTURE_CHANGE 事件）
     * 
     * 当启用 alignCanvasWithScreen 时，执行：
     * - 根据屏幕尺寸和视图缩放计算相机正交高度
     * - 渲染到纹理：使用 visibleRect.height / 2
     * - 屏幕渲染：使用 windowSize.height / viewScale / 2
     * - 将相机世界位置与 Canvas 位置同步（Z 偏移：1000）
     * 
     * 这确保了 UI 在不同屏幕分辨率和设备方向下的一致渲染。
     */
    protected _onResizeCamera (): void {
        if (this._cameraComponent && this._alignCanvasWithScreen) {
            if (this._cameraComponent.targetTexture) {
                this._cameraComponent.orthoHeight = visibleRect.height / 2;
            } else {
                const size = screen.windowSize;
                this._cameraComponent.orthoHeight = size.height / view.getScaleY() / 2;
            }

            this.node.getWorldPosition(_worldPos);
            this._cameraComponent.node.setWorldPosition(_worldPos.x, _worldPos.y, 1000);
        }
    }

    /**
     * @en
     * Calculates the effective camera priority based on the Canvas render mode.
     * 
     * This method implements the priority logic for Canvas camera rendering:
     * - OVERLAY mode (0): Sets bit 30 to ensure UI renders after all 3D scene cameras
     * - INTERSPERSE mode (1): Clears bit 30 to allow priority-based interleaving with scene cameras
     * 
     * The bit manipulation (priority | 1 << 30) or (priority & ~(1 << 30)) ensures:
     * - OVERLAY: High-priority flag guarantees UI appears on top
     * - INTERSPERSE: Standard priority allows flexible layering with 3D content
     * 
     * Returns 0 if no camera component is assigned.
     *
     * @zh
     * 根据 Canvas 渲染模式计算有效的相机优先级。
     * 
     * 此方法实现 Canvas 相机渲染的优先级逻辑：
     * - OVERLAY 模式 (0)：设置第 30 位以确保 UI 在所有 3D 场景相机之后渲染
     * - INTERSPERSE 模式 (1)：清除第 30 位以允许与场景相机基于优先级交错
     * 
     * 位操作 (priority | 1 << 30) 或 (priority & ~(1 << 30)) 确保：
     * - OVERLAY：高优先级标志保证 UI 显示在顶层
     * - INTERSPERSE：标准优先级允许与 3D 内容灵活分层
     * 
     * 如果未分配相机组件则返回 0。
     */
    private _getViewPriority (): number {
        if (this._cameraComponent) {
            let priority = this.cameraComponent?.priority as number;
            priority = this._renderMode === CanvasRenderMode.OVERLAY ? priority | 1 << 30 : priority & ~(1 << 30);
            return priority;
        }

        return 0;
    }
}

cclegacy.Canvas = Canvas;
