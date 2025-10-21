/*
 Copyright (c) 2022-2023 Xiamen Yaji Software Co., Ltd.

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

/**
 * @fileoverview Native Platform Screen Adapter Implementation
 * @fileoverview 原生平台屏幕适配器实现
 * @ai_context This file implements screen adaptation for native platforms using JSB (JavaScript Binding) APIs
 * @ai_context_zh 此文件使用JSB（JavaScript绑定）API实现原生平台的屏幕适配
 */

import { EDITOR } from 'internal:constants';
import { EventTarget } from '../../../cocos/core/event/event-target';
import { Size } from '../../../cocos/core/math';
import { checkPalIntegrity, withImpl } from '../../integrity-check';
import { Orientation } from '../enum-type';
import { warn, warnID } from '../../../cocos/core/platform/debug';

/**
 * @interface SafeAreaEdge
 * @description Safe area edge insets for different screen edges
 * @description 不同屏幕边缘的安全区域
 * @ai_context Defines the safe area measurements for top, bottom, left, and right edges in pixels
 * @ai_context_zh 定义顶部、底部、左侧和右侧边缘的数值（像素单位）
 */
export interface SafeAreaEdge {
    /**
     * @description Top edge safe area inset in pixels
     * @description 顶部值（像素）
     * @ai_context Distance from top of screen to safe content area
     * @ai_context_zh 从屏幕顶部到安全内容区域的距离
     */
    top: number;
    /**
     * @description Bottom edge safe area inset in pixels
     * @description 底部值（像素）
     * @ai_context Distance from bottom of screen to safe content area
     * @ai_context_zh 从屏幕底部到安全内容区域的距离
     */
    bottom: number;
    /**
     * @description Left edge safe area inset in pixels
     * @description 左侧值（像素）
     * @ai_context Distance from left of screen to safe content area
     * @ai_context_zh 从屏幕左侧到安全内容区域的距离
     */
    left: number;
    /**
     * @description Right edge safe area inset in pixels
     * @description 右侧值（像素）
     * @ai_context Distance from right of screen to safe content area
     * @ai_context_zh 从屏幕右侧到安全内容区域的距离
     */
    right: number;
}

/**
 * @type ConfigOrientation
 * @description Configuration orientation options for screen adapter
 * @description 屏幕适配器的配置方向选项
 * @ai_context Defines the possible orientation configurations: auto-detect, landscape, or portrait
 * @ai_context_zh 定义可能的方向配置：自动检测、横屏或竖屏
 */
export type ConfigOrientation = 'auto' | 'landscape' | 'portrait';

/**
 * @interface IScreenOptions
 * @description Screen adapter initialization options
 * @description 屏幕适配器初始化选项
 * @ai_context Configuration object for initializing the screen adapter with orientation, fit, and rendering mode settings
 * @ai_context_zh 用于初始化屏幕适配器的配置对象，包含方向、适配和渲染模式设置
 */
export interface IScreenOptions {
    /**
     * @description Orientation options from editor builder
     * @description 来自编辑器构建器的方向选项
     * @ai_context Orientation configuration set in the editor build settings
     * @ai_context_zh 在编辑器构建设置中设置的方向配置
     */
    configOrientation: ConfigOrientation;
    /**
     * @description Determine whether the game frame exact fits the screen
     * @description 确定游戏帧是否完全适配屏幕
     * @ai_context Controls if the game frame should exactly match screen dimensions (Web platform only)
     * @ai_context_zh 控制游戏帧是否应该完全匹配屏幕尺寸（仅Web平台）
     */
    exactFitScreen: boolean,
    /**
     * @description Determine whether use headless renderer
     * @description 确定是否使用Headless
     * @ai_context Enables headless rendering mode which disables some screen operations for server-side rendering
     * @ai_context_zh 启用Headless模式，为服务器端渲染禁用某些屏幕操作
     */
    isHeadlessMode: boolean;
}

/**
 * @description Orientation mapping from native layer values to engine orientation enum
 * @description 从原生层值到引擎方向枚举的映射
 * @ai_context Maps native device orientation degrees to engine Orientation enum values
 * @ai_context_zh 将原生设备方向度数映射到引擎方向枚举值
 */
const orientationMap: Record<string, Orientation> = {
    0: Orientation.PORTRAIT,           // 竖屏正向 Portrait upright
    '-90': Orientation.LANDSCAPE_LEFT, // 横屏左转 Landscape rotated left
    90: Orientation.LANDSCAPE_RIGHT,   // 横屏右转 Landscape rotated right
    180: Orientation.PORTRAIT_UPSIDE_DOWN, // 竖屏倒置 Portrait upside down
};

/**
 * @class ScreenAdapter
 * @description Native platform screen adapter implementation
 * @description 原生平台屏幕适配器实现
 * @extends EventTarget
 * @ai_context Handles screen adaptation for native platforms using JSB APIs with device-specific optimizations
 * @ai_context_zh 使用JSB API处理原生平台的屏幕适配，包含设备特定优化
 */
class ScreenAdapter extends EventTarget {
    /**
     * @description Indicates if the frame is rotated
     * @description 框架是否已旋转
     * @ai_context Frame rotation state for orientation handling in native platforms
     * @ai_context_zh 原生平台中用于方向处理的帧旋转状态
     */
    public isFrameRotated = false;

    /**
     * @description Controls whether to handle resize events
     * @description 控制是否处理调整大小事件
     * @ai_context Flag to enable/disable window resize event handling in native environment
     * @ai_context_zh 在原生环境中启用/禁用窗口调整大小事件处理的标志
     */
    public handleResizeEvent = true;

    /**
     * @description Check if full screen mode is supported
     * @description 是否支持全屏模式
     * @returns {boolean} Always false for native platforms
     * @returns {boolean} 原生平台始终返回false
     * @ai_context Native platforms do not support programmatic full screen mode
     * @ai_context_zh 原生平台不支持程序化全屏模式
     */
    public get supportFullScreen (): boolean {
        return false;
    }

    /**
     * @description Check if currently in full screen mode
     * @description 当前是否处于全屏模式
     * @returns {boolean} Always false for native platforms
     * @returns {boolean} 原生平台始终返回false
     * @ai_context Native platforms are never in programmatic full screen mode
     * @ai_context_zh 原生平台永远不会处于程序化全屏模式
     */
    public get isFullScreen (): boolean {
        return false;
    }

    /**
     * @description Get device pixel ratio from native layer
     * @description 获取设备像素比
     * @returns {number} Device pixel ratio value, defaults to 1 if unavailable
     * @returns {number} 设备像素比值，如果不可用则默认为1
     * @ai_context Retrieves pixel ratio from JSB device API with fallback to 1.0
     * @ai_context_zh 从JSB设备API获取像素比，回退到1.0
     */
    public get devicePixelRatio (): number {
        return jsb.device.getDevicePixelRatio() || 1;
    }

    /**
     * @description Get window size in physical pixels
     * @description 获取物理像素的窗口大小
     * @returns {Size} Window size object with width and height in physical pixels
     * @returns {Size} 包含物理像素宽度和高度的窗口大小对象
     */
    public get windowSize (): Size {
        const dpr = this.devicePixelRatio;
        // NOTE: fix precision issue on Metal render end.
        // 注意：修复Metal渲染端的精度问题
        const width = jsb.window.innerWidth as number;
        const height = jsb.window.innerHeight as number;
        // NOTE: fix precision issue on Metal render end.
        // 注意：修复Metal渲染端的精度问题
        const roundWidth = Math.round(width);
        const roundHeight = Math.round(height);
        return new Size(roundWidth * dpr, roundHeight * dpr);
    }

    /**
     * @description Set window size (not supported in native)
     * @description 设置窗口大小（原生平台不支持）
     * @param {Size} size - Target window size
     * @param {Size} size - 目标窗口大小
     * @ai_context Window size setting is not supported in native platforms, shows warning
     * @ai_context_zh 原生平台不支持设置窗口大小，显示警告
     */
    public set windowSize (size: Size) {
        warn('Setting window size is not supported yet.');
    }

    /**
     * @description Get current resolution
     * @description 获取当前分辨率
     * @returns {Size} Resolution size calculated from window size and scale
     * @returns {Size} 从窗口大小和缩放计算的分辨率大小
     */
    public get resolution (): Size {
        const windowSize = this.windowSize;
        const resolutionScale = this.resolutionScale;
        return new Size(windowSize.width * resolutionScale, windowSize.height * resolutionScale);
    }

    /**
     * @description Get resolution scale factor
     * @description 获取分辨率缩放因子
     * @returns {number} Current resolution scale value
     * @returns {number} 当前分辨率缩放值
     */
    public get resolutionScale (): number {
        return this._resolutionScale;
    }

    /**
     * @description Set resolution scale factor
     * @description 设置分辨率缩放因子
     * @param {number} v - New resolution scale value
     * @param {number} v - 新的分辨率缩放值
     * @ai_context Updates resolution scale and triggers frame buffer update if changed
     * @ai_context_zh 更新分辨率缩放并在更改时触发帧缓冲区更新
     */
    public set resolutionScale (v: number) {
        if (v === this._resolutionScale) {
            return;
        }
        this._resolutionScale = v;
        this._cbToUpdateFrameBuffer?.();
    }

    /**
     * @description Get current screen orientation from native device
     * @description 从原生设备获取当前屏幕方向
     * @returns {Orientation} Current orientation value mapped from native degrees
     * @returns {Orientation} 从原生度数映射的当前方向值
     * @ai_context Retrieves orientation from JSB device API and maps to engine enum
     * @ai_context_zh 从JSB设备API获取方向并映射到引擎枚举
     */
    public get orientation (): Orientation {
        return orientationMap[jsb.device.getDeviceOrientation()];
    }

    /**
     * @description Set screen orientation (not supported in native)
     * @description 设置屏幕方向（原生平台不支持）
     * @param {Orientation} value - Target orientation
     * @param {Orientation} value - 目标方向
     * @ai_context Orientation setting is not allowed in native platforms, shows warning
     * @ai_context_zh 原生平台不允许设置方向，显示警告
     */
    public set orientation (value: Orientation) {
        warnID(1221);
    }

    /**
     * @description Get safe area edge insets from native device
     * @description 获取设备的安全区
     * @returns {SafeAreaEdge} Safe area edge measurements in physical pixels
     * @returns {SafeAreaEdge} 物理像素的安全区域边缘测量值
     * @ai_context Calculates safe area from JSB device API with DPR scaling, using XYZW vector mapping
     * @ai_context_zh 从JSB设备API计算安全区域，使用DPR缩放和XYZW向量映射
     */
    public get safeAreaEdge (): SafeAreaEdge {
        const nativeSafeArea = jsb.device.getSafeAreaEdge();
        const dpr = this.devicePixelRatio;
        // Native safe area uses XYZW vector: X=top, Y=left, Z=bottom, W=right
        // 原生安全区域使用XYZW向量：X=顶部，Y=左侧，Z=底部，W=右侧
        const topEdge = nativeSafeArea.x * dpr;
        const bottomEdge = nativeSafeArea.z * dpr;
        const leftEdge = nativeSafeArea.y * dpr;
        const rightEdge = nativeSafeArea.w * dpr;
        return {
            top: topEdge,
            bottom: bottomEdge,
            left: leftEdge,
            right: rightEdge,
        };
    }

    /**
     * @description Checks if game container maintains aspect ratio relative to frame
     * @description_zh 获取游戏容器是否相对于框架保持宽高比
     * @returns {boolean} True if proportional scaling is enabled
     * @returns_zh {boolean} 如果启用比例缩放则返回 true
     */
    public get isProportionalToFrame (): boolean {
        return this._isProportionalToFrame;
    }

    /**
     * @description Set proportional to frame (no-op in native)
     * @description 设置与帧成比例（原生平台中无操作）
     * @param {boolean} v - Proportional value
     * @param {boolean} v - 比例值
     * @ai_context Setter exists for interface compatibility but performs no operation in native
     * @ai_context_zh 设置器存在是为了接口兼容性，但在原生平台中不执行任何操作
     */
    public set isProportionalToFrame (v: boolean) { }

    /** @private Callback to trigger framebuffer updates */
    /** @private 更新帧缓冲区的回调函数 */
    private _cbToUpdateFrameBuffer?: () => void;

    /** @private Current resolution scaling factor */
    /** @private 分辨率缩放因子 */
    private _resolutionScale = 1;

    /** @private Whether container should scale proportionally to frame */
    /** @private 是否按比例缩放 */
    private _isProportionalToFrame = false;

    constructor () {
        super();
        this._registerEvent();
    }

    /**
     * @description Initialize screen adapter with options
     * @description 使用选项初始化屏幕适配器
     * @param {IScreenOptions} options - Screen configuration options
     * @param {IScreenOptions} options - 屏幕配置选项
     * @param {() => void} cbToRebuildFrameBuffer - Callback to rebuild frame buffer
     * @param {() => void} cbToRebuildFrameBuffer - 重建帧缓冲区的回调
     * @ai_context Initializes adapter with configuration and sets up frame buffer callback, skips in editor mode
     * @ai_context_zh 使用配置初始化适配器并设置帧缓冲区回调，在编辑器模式下跳过
     */
    public init (options: IScreenOptions, cbToRebuildFrameBuffer: () => void): void {
        this._cbToUpdateFrameBuffer = cbToRebuildFrameBuffer;
        if (!EDITOR) {
            this._cbToUpdateFrameBuffer();
        }
    }

    /**
     * @description Request full screen mode (not supported in native)
     * @description 请求全屏模式（原生平台不支持）
     * @returns {Promise<void>} Rejected promise with error message
     * @returns {Promise<void>} 带有错误消息的被拒绝的Promise
     */
    public requestFullScreen (): Promise<void> {
        return Promise.reject(new Error('request fullscreen has not been supported yet on this platform.'));
    }

    /**
     * @description Exit full screen mode (not supported in native)
     * @description 退出全屏模式（原生平台不支持）
     * @returns {Promise<void>} Rejected promise with error message
     * @returns {Promise<void>} 带有错误消息的被拒绝的Promise
     */
    public exitFullScreen (): Promise<void> {
        return Promise.reject(new Error('exit fullscreen has not been supported yet on this platform.'));
    }

    /**
     * @description Register native platform events via JSB
     * @description 通过JSB注册原生平台事件
     * @ai_context Sets up JSB event handlers for window resize and orientation change events
     * @ai_context_zh 为窗口调整大小和方向更改事件设置JSB事件处理程序
     */
    private _registerEvent (): void {
        /**
         * @description Handle window resize events from native layer
         * @description 处理来自原生层的窗口调整大小事件
         */
        jsb.onResize = (event: jsb.WindowEvent): void => {
            if (event.width === 0 || event.height === 0) return;
            // TODO: remove this function calling
            // TODO: 移除此函数调用
            window.resize(event.width / this.devicePixelRatio, event.height / this.devicePixelRatio);
            this.emit('window-resize', event.width, event.height, event.windowId);
        };

        jsb.onOrientationChanged = (event): void => {
            this.emit('orientation-change', this.orientation);
        };
    }
}

/**
 * @description Exported screen adapter instance for native platforms
 * @description 原生平台导出的屏幕适配器实例
 * @ai_context Singleton instance of ScreenAdapter for native platforms using JSB APIs
 * @ai_context_zh 使用JSB API的原生平台ScreenAdapter单例实例
 */
export const screenAdapter = new ScreenAdapter();

/**
 * @description PAL integrity check for native screen adapter implementation
 * @description 原生屏幕适配器实现的PAL完整性检查
 * @ai_context Ensures the native implementation matches the expected PAL interface
 * @ai_context_zh 确保原生实现与预期的PAL接口匹配
 */
checkPalIntegrity<typeof import('pal/screen-adapter')>(withImpl<typeof import('./screen-adapter')>());
