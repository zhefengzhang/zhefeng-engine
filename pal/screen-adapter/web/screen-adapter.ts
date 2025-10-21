/* eslint-disable max-len */
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

import { EDITOR, TEST } from 'internal:constants';
import { ConfigOrientation, IScreenOptions, SafeAreaEdge } from 'pal/screen-adapter';
import { systemInfo } from 'pal/system-info';
import { warnID } from '../../../cocos/core/platform/debug';
import { EventTarget } from '../../../cocos/core/event/event-target';
import { Size } from '../../../cocos/core/math';
import { Orientation } from '../enum-type';
import legacyCC from '../../../predefine';
import { checkPalIntegrity, withImpl } from '../../integrity-check';
import { OS } from '../../system-info/enum-type';

/**
 * @interface ICachedStyle
 * @description Interface for caching CSS style properties of DOM elements
 * @description_zh 用于缓存 DOM 元素 CSS 样式属性的接口
 * @purpose Used to store and compare previous style values to detect changes
 * @purpose_zh 用于存储和比较之前的样式值以检测变化
 */
interface ICachedStyle {
    /** CSS width property value as string (e.g., "800px") */
    /** CSS 宽度属性值，字符串格式（例如："800px"） */
    width: string;
    /** CSS height property value as string (e.g., "600px") */
    /** CSS 高度属性值，字符串格式（例如："600px"） */
    height: string;
}

/**
 * @constant EVENT_TIMEOUT
 * @description Timeout duration for handling orientation change events
 * @description_zh 处理屏幕方向变化事件的延迟时间
 * @rationale Different timeout values for editor vs runtime to balance responsiveness and stability
 * @rationale_zh 编辑器和运行时使用不同的超时值以平衡响应性和稳定性
 */
const EVENT_TIMEOUT = EDITOR ? 5 : 200;

/**
 * @constant orientationMap
 * @description Maps configuration orientation values to internal orientation enum values
 * @description_zh 将配置的屏幕方向值映射到内部方向枚举值
 * @purpose Provides translation layer between external API and internal representation
 * @purpose_zh 在外部 API 和内部表示之间提供转换层
 */
const orientationMap: Record<ConfigOrientation, Orientation> = {
    auto: Orientation.AUTO,
    landscape: Orientation.LANDSCAPE,
    portrait: Orientation.PORTRAIT,
};

/**
 * @enum WindowType
 * @description Defines different types of game window on web platform
 * @description_zh 定义 Web 平台上不同类型的游戏窗口
 * @purpose Determines how screen adapter handles window sizing and events
 * @purpose_zh 决定屏幕适配器如何处理窗口大小调整和事件
 * @ai_context This enum is crucial for understanding how the screen adapter behaves in different web environments
 * @ai_context_zh 此枚举对于理解屏幕适配器在不同 Web 环境中的行为至关重要
 */
enum WindowType {
    /**
     * @description Unknown or uninitialized window type
     * @description_zh 未知或未初始化的窗口类型
     * @usage Fallback state when window type cannot be determined
     * @usage_zh 当无法确定窗口类型时的回退状态
     */
    Unknown,
    /**
     * @description Game runs in a sub-frame within a browser window
     * @description_zh 游戏在浏览器窗口内的子框架中运行
     * @characteristics
     * - Frame size set externally (e.g., from editor)
     * - Supports window size setting
     * - Only dispatches resize events when frame size changes
     * @characteristics_zh
     * - 框架大小由外部设置（例如，来自编辑器）
     * - 支持窗口大小设置
     * - 仅在框架大小变化时分发调整大小事件
     */
    SubFrame,
    /**
     * @description Game window size matches browser window size
     * @description_zh 游戏窗口大小与浏览器窗口大小匹配
     * @characteristics
     * - Size determined by browser window dimensions
     * - Does NOT support programmatic window size setting
     * - Dispatches resize events on browser window changes
     * @characteristics_zh
     * - 大小由浏览器窗口尺寸决定
     * - 不支持程序化窗口大小设置
     * - 在浏览器窗口变化时分发调整大小事件
     */
    BrowserWindow,
    /**
     * @description Game runs in fullscreen mode
     * @description_zh 游戏在全屏模式下运行
     * @characteristics
     * - Size equals screen dimensions
     * - Does NOT support programmatic window size setting
     * - Dispatches resize events on fullscreen state changes
     * @characteristics_zh
     * - 大小等于屏幕尺寸
     * - 不支持程序化窗口大小设置
     * - 在全屏状态变化时分发调整大小事件
     */
    Fullscreen,
}

/**
 * @interface IScreenFunctionName
 * @description Cross-browser compatibility mapping for fullscreen API function names
 * @description_zh 全屏 API 函数名称的跨浏览器兼容性映射
 * @purpose Different browsers use different prefixes for fullscreen API methods
 * @purpose_zh 不同浏览器对全屏 API 方法使用不同的前缀
 * @ai_context Essential for understanding how fullscreen functionality works across browsers
 * @ai_context_zh 对于理解全屏功能如何在不同浏览器中工作至关重要
 */
interface IScreenFunctionName {
    /** Function for requesting fullscreen mode */
    /** 请求全屏模式的函数 */
    requestFullscreen: string,
    /** Function for exiting fullscreen mode */
    /** 退出全屏模式的函数 */
    exitFullscreen: string,
    /** Function for fullscreen state changes */
    /** 全屏状态变化的事件函数 */
    fullscreenchange: string,
    /** Function for enable fullscreen */
    /** 是否启动全屏函数 */
    fullscreenEnabled: string,
    /** Function for getting current fullscreen element */
    /** 获取当前全屏元素的函数 */
    fullscreenElement: string,
    /** Function for fullscreen errors */
    /** 全屏错误的事件函数 */
    fullscreenerror: string,
}

/**
 * @class ScreenAdapter
 * @extends EventTarget
 * @description Main class responsible for managing screen adaptation on web platform
 * @description_zh 负责管理 Web 平台屏幕适配的主要类
 * @purpose Handles window sizing, orientation changes, fullscreen mode, and device pixel ratio
 * @purpose_zh 处理窗口大小调整、方向变化、全屏模式和设备像素比
 * @ai_context This is the core class that manages all screen-related functionality in Cocos Creator web games
 * @ai_context_zh 这是管理 Cocos Creator Web 游戏中所有屏幕相关功能的核心类
 *
 * Key responsibilities:
 * 主要职责：
 * - Window size management and scaling
 * - 窗口大小管理和缩放
 * - Orientation detection and handling
 * - 方向检测和处理
 * - Fullscreen mode support
 * - 全屏模式支持
 * - Device pixel ratio handling
 * - 设备像素比处理
 * - Safe area management
 * - 安全区域管理
 * - Cross-browser compatibility
 * - 跨浏览器兼容性
 */
class ScreenAdapter extends EventTarget {
    /**
     * @property isFrameRotated
     * @description Indicates if the game frame is currently rotated
     * @description_zh 指示游戏框架当前是否旋转
     * @usage Used on mobile devices when orientation doesn't match desired layout
     * @usage_zh 在移动设备上当方向与期望布局不匹配时使用
     */
    public isFrameRotated = false;

    /**
     * @property handleResizeEvent
     * @description Controls whether the adapter should respond to window resize events
     * @description_zh 控制适配器是否应响应窗口调整大小事件
     * @default true
     */
    public handleResizeEvent = true;

    /**
     * @getter supportFullScreen
     * @description Checks if the current browser supports fullscreen API
     * @description_zh 检查当前浏览器是否支持全屏 API
     * @returns {boolean} True if fullscreen is supported
     * @returns_zh {boolean} 如果支持全屏则返回 true
     * @ai_context Critical for determining fullscreen capability before attempting fullscreen operations
     * @ai_context_zh 在尝试全屏操作之前确定全屏能力的关键
     */
    public get supportFullScreen (): boolean {
        return this._supportFullScreen;
    }

    /**
     * @getter isFullScreen
     * @description Checks if the game is currently in fullscreen mode
     * @description_zh 检查游戏当前是否处于全屏模式
     * @returns {boolean} True if currently in fullscreen
     * @returns_zh {boolean} 如果当前处于全屏则返回 true
     * @ai_context Used to determine current fullscreen state for UI and behavior adjustments
     * @ai_context_zh 用于确定当前全屏状态以进行 UI 和行为调整
     */
    public get isFullScreen (): boolean {
        if (!this._supportFullScreen) {
            return false;
        }
        return !!document[this._fn.fullscreenElement];
    }

    /**
     * @getter devicePixelRatio
     * @description Gets the device pixel ratio, clamped to maximum of 2
     * @description_zh 获取设备像素比，最大限制为 2
     * @returns {number} Device pixel ratio (1.0 to 2.0)
     * @returns_zh {number} 设备像素比（1.0 到 2.0）
     */
    public get devicePixelRatio (): number {
        // TODO: remove the down sampling operation in DPR after supporting resolutionScale
        // TODO: 在支持 resolutionScale 后移除 DPR 的下采样操作
        return Math.min(window.devicePixelRatio ?? 1, 2);
    }

    /**
     * @getter windowSize
     * @description Gets the current window size in physical pixels
     * @description_zh 获取当前窗口大小（物理像素）
     * @returns {Size} Window dimensions multiplied by device pixel ratio
     * @returns_zh {Size} 窗口尺寸乘以设备像素比
     * @ai_context Primary method for getting actual rendering dimensions
     * @ai_context_zh 获取实际渲染尺寸的主要方法
     */
    public get windowSize (): Size {
        const result = this._windowSizeInCssPixels;
        const dpr = this.devicePixelRatio;
        result.width *= dpr;
        result.height *= dpr;
        return result;
    }

    /**
     * @setter windowSize
     * @description Sets the window size (only works in SubFrame mode)
     * @description_zh 设置窗口大小（仅在 SubFrame 模式下有效）
     * @param {Size} size - Desired window size in physical pixels
     * @param_zh {Size} size - 期望的窗口大小（物理像素）
     * @ai_context Only functional when game runs in a sub-frame, warns otherwise
     * @ai_context_zh 仅在游戏在子框架中运行时有效，否则会发出警告
     */
    public set windowSize (size: Size) {
        if (this._windowType !== WindowType.SubFrame) {
            warnID(9202);
            return;
        }
        this._resizeFrame(this._convertToSizeInCssPixels(size));
    }

    /**
     * @getter resolution
     * @description Gets the rendering resolution (window size * resolution scale)
     * @description_zh 获取渲染分辨率（窗口大小 * 分辨率缩放）
     * @returns {Size} Final rendering resolution
     * @returns_zh {Size} 最终渲染分辨率
     * @ai_context This is the actual resolution used for rendering, different from window size
     * @ai_context_zh 这是用于渲染的实际分辨率，与窗口大小不同
     */
    public get resolution (): Size {
        const windowSize = this.windowSize;
        const resolutionScale = this.resolutionScale;
        return new Size(windowSize.width * resolutionScale, windowSize.height * resolutionScale);
    }

    /**
     * @getter resolutionScale
     * @description Gets the current resolution scaling factor
     * @description_zh 获取当前分辨率缩放因子
     * @returns {number} Scale factor applied to window size for rendering
     * @returns_zh {number} 应用于窗口大小进行渲染的缩放因子
     */
    public get resolutionScale (): number {
        return this._resolutionScale;
    }

    /**
     * @setter resolutionScale
     * @description Sets the resolution scaling factor and triggers framebuffer update
     * @description_zh 设置分辨率缩放因子并触发帧缓冲区更新
     * @param {number} v - New resolution scale value
     * @param_zh {number} v - 新的分辨率缩放值
     * @ai_context Changing this triggers framebuffer recreation for performance optimization
     * @ai_context_zh 更改此值会触发帧缓冲区重建以进行性能优化
     */
    public set resolutionScale (v: number) {
        if (v === this._resolutionScale) {
            return;
        }
        this._resolutionScale = v;
        this._cbToUpdateFrameBuffer?.();
    }

    /**
     * @getter orientation
     * @description Gets the current orientation setting
     * @description_zh 获取当前方向设置
     * @returns {Orientation} Current orientation mode
     * @returns_zh {Orientation} 当前方向模式
     */
    public get orientation (): Orientation {
        return this._orientation;
    }

    /**
     * @setter orientation
     * @description Sets the desired orientation and updates frame accordingly
     * @description_zh 设置期望的方向并更新框架
     * @param {Orientation} value - Desired orientation mode
     * @param_zh {Orientation} value - 期望的方向模式
     * @ai_context Triggers frame update to handle orientation-specific layout changes
     * @ai_context_zh 方向的变化时触发框架更新
     */
    public set orientation (value: Orientation) {
        if (this._orientation === value) {
            return;
        }
        this._orientation = value;
        this._updateFrame();
    }

    /**
     * @method _updateFrame
     * @description Internal method to update frame state and resize frame
     * @description_zh 更新框架状态和调整框架大小的内部方法
     * @private
     * @ai_context Coordinates frame state updates with actual frame resizing
     * @ai_context_zh 协调框架状态更新与实际框架大小调整
     */
    private _updateFrame (): void {
        this._updateFrameState();
        this._resizeFrame();
    }

    /**
     * @getter safeAreaEdge
     * @description Gets safe area insets for devices
     * @description_zh 获取设备的安全区
     * @returns {SafeAreaEdge} Safe area measurements in physical pixels
     * @returns_zh {SafeAreaEdge} 物理像素中的安全区域测量值
     * @ai_context Critical for UI layout on modern mobile devices with screen cutouts
     * @ai_context_zh 对于具有屏幕缺口的现代移动设备上的 UI 布局至关重要
     */
    public get safeAreaEdge (): SafeAreaEdge {
        const dpr = this.devicePixelRatio;
        const _top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-top') || '0') * dpr;
        const _bottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') || '0') * dpr;
        const _left = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-left') || '0') * dpr;
        const _right = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-right') || '0') * dpr;

        return {
            top: _top,
            bottom: _bottom,
            left: _left,
            right: _right,
        };
    }

    /**
     * @getter isProportionalToFrame
     * @description Checks if game container maintains aspect ratio relative to frame
     * @description_zh 获取游戏容器是否相对于框架保持宽高比
     * @returns {boolean} True if proportional scaling is enabled
     * @returns_zh {boolean} 如果启用比例缩放则返回 true
     */
    public get isProportionalToFrame (): boolean {
        return this._isProportionalToFrame;
    }

    /**
     * @setter isProportionalToFrame
     * @description Sets proportional scaling mode and updates container
     * @description_zh 设置比例缩放模式并更新容器
     * @param {boolean} v - Whether to enable proportional scaling
     * @param_zh {boolean} v - 是否启用比例缩放
     * @ai_context Affects how game content scales within the available frame space
     * @ai_context_zh 影响游戏内容在可用框架空间内的缩放方式
     */
    public set isProportionalToFrame (v: boolean) {
        if (this._isProportionalToFrame === v) {
            return;
        }
        this._isProportionalToFrame = v;
        this._updateContainer();
    }

    /** @private Game frame DOM element (outer container) */
    /** @private 游戏框架 DOM 元素（外部容器） */
    private _gameFrame?: HTMLDivElement;

    /** @private Game container DOM element (inner container for scaling) */
    /** @private 游戏容器 DOM 元素（用于缩放的内部容器） */
    private _gameContainer?: HTMLDivElement;

    /** @private Game canvas DOM element (actual rendering surface) */
    /** @private 游戏画布 DOM 元素（实际渲染表面） */
    private _gameCanvas?: HTMLCanvasElement;

    /** @private Whether container should scale proportionally to frame */
    /** @private 是否按比例缩放 */
    private _isProportionalToFrame = false;

    /** @private Cached frame style for change detection */
    /** @private 框架样式缓存 */
    private _cachedFrameStyle: ICachedStyle = { width: '0px', height: '0px' };

    /** @private Cached container style for change detection */
    /** @private 容器样式缓存 */
    private _cachedContainerStyle: ICachedStyle = { width: '0px', height: '0px' };

    /** @private Callback to trigger framebuffer updates */
    /** @private 触发帧缓冲区更新的回调 */
    private _cbToUpdateFrameBuffer?: () => void;

    /** @private Whether browser supports fullscreen API */
    /** @private 浏览器是否支持全屏 API */
    private _supportFullScreen = false;

    /** @private Touch/mouse event name for fullscreen triggers */
    /** @private 触摸/鼠标事件名称 */
    private _touchEventName: string;

    /** @private Fullscreen change event callback */
    /** @private 全屏变化事件回调 */
    private _onFullscreenChange?: () => void;

    /** @private Fullscreen error event callback */
    /** @private 全屏错误事件回调 */
    private _onFullscreenError?: () => void;

    /** @private Timeout ID for orientation change handling */
    /** @private 方向变化处理的超时 ID */
    private _orientationChangeTimeoutId = -1;

    /** @private Cached frame size before entering fullscreen */
    /** @private 框架大小的缓存 */
    private _cachedFrameSize = new Size(0, 0);

    /** @private Whether frame should exactly fit screen */
    /** @private 框架是否应完全适合屏幕 */
    private _exactFitScreen = false;

    /** @private Whether running in headless mode (no display) */
    /** @private 是否Headless模式（无显示） */
    private _isHeadlessMode = false;

    /** @private Cross-browser fullscreen function names */
    /** @private 跨浏览器全屏函数 */
    private _fn = {} as IScreenFunctionName;

    /**
     * @private _fnGroup
     * @description Cross-browser compatibility matrix for fullscreen API
     * @description_zh 全屏 API 的跨浏览器兼容性数组
     * @ai_context Each sub-array represents a different browser's fullscreen API naming convention
     * @ai_context_zh 每个子数组代表不同浏览器的全屏 API 命名约定
     */
    private _fnGroup = [
        [
            'requestFullscreen',
            'exitFullscreen',
            'fullscreenchange',
            'fullscreenEnabled',
            'fullscreenElement',
            'fullscreenerror',
        ],
        [
            'requestFullScreen',
            'exitFullScreen',
            'fullScreenchange',
            'fullScreenEnabled',
            'fullScreenElement',
            'fullscreenerror',
        ],
        [
            'webkitRequestFullScreen',
            'webkitCancelFullScreen',
            'webkitfullscreenchange',
            'webkitIsFullScreen',
            'webkitCurrentFullScreenElement',
            'webkitfullscreenerror',
        ],
        [
            'mozRequestFullScreen',
            'mozCancelFullScreen',
            'mozfullscreenchange',
            'mozFullScreen',
            'mozFullScreenElement',
            'mozfullscreenerror',
        ],
        [
            'msRequestFullscreen',
            'msExitFullscreen',
            'MSFullscreenChange',
            'msFullscreenEnabled',
            'msFullscreenElement',
            'msfullscreenerror',
        ],
    ];

    /**
     * @getter _windowSizeInCssPixels
     * @description Gets window size in CSS pixels (before device pixel ratio scaling)
     * @description_zh 获取 CSS 像素中的窗口大小（设备像素比缩放之前）
     * @returns {Size} Window size in CSS pixels
     * @returns_zh {Size} CSS 像素中的窗口大小
     * @private
     * @ai_context Handles different window types and rotation states to determine actual size
     * @ai_context_zh 处理不同的窗口类型和旋转状态以确定实际大小
     */
    private get _windowSizeInCssPixels (): Size {
        if (TEST) {
            return new Size(window.innerWidth, window.innerHeight);
        }
        if (this.isProportionalToFrame) {
            if (!this._gameContainer) {
                warnID(9201);
                return new Size(0, 0);
            }
            return new Size(this._gameContainer.clientWidth, this._gameContainer.clientHeight);
        }
        let fullscreenTarget;
        let width: number;
        let height: number;
        switch (this._windowType) {
        case WindowType.SubFrame:
            if (!this._gameFrame) {
                warnID(9201);
                return new Size(0, 0);
            }
            return new Size(this._gameFrame.clientWidth, this._gameFrame.clientHeight);
        case WindowType.Fullscreen:
            fullscreenTarget = this._getFullscreenTarget()!;
            width = this.isFrameRotated ? fullscreenTarget.clientHeight : fullscreenTarget.clientWidth;
            height = this.isFrameRotated ? fullscreenTarget.clientWidth : fullscreenTarget.clientHeight;
            return new Size(width, height);
        case WindowType.BrowserWindow:
            width = this.isFrameRotated ? window.innerHeight : window.innerWidth;
            height = this.isFrameRotated ? window.innerWidth : window.innerHeight;
            return new Size(width, height);
        case WindowType.Unknown:
        default:
            return new Size(1, 1);
        }
    }

    /**
     * @getter _windowType
     * @description Determines current window type based on state
     * @description_zh 根据状态确定当前窗口类型
     * @returns {WindowType} Current window type
     * @returns_zh {WindowType} 当前窗口类型
     * @private
     * @ai_context Logic for determining how to handle window sizing and events
     * @ai_context_zh 确定如何处理窗口大小调整和事件的逻辑
     */
    private get _windowType (): WindowType {
        if (this._isHeadlessMode) {
            return WindowType.Unknown;
        }
        if (this.isFullScreen) {
            return WindowType.Fullscreen;
        }
        if (!this._gameFrame) {
            warnID(9201);
            return WindowType.Unknown;
        }
        if (this._exactFitScreen) {
            // Note: It doesn't work well to determine whether the frame exact fits the screen.
            // Need to specify the attribute from Editor.
            return WindowType.BrowserWindow;
        }
        return WindowType.SubFrame;
    }

    /** @private Current resolution scaling factor */
    /** @private 分辨率缩放因子 */
    private _resolutionScale = 1;

    /** @private User-set orientation */
    /** @private 方向 */
    private _orientation = Orientation.AUTO;

    /** @private Device's actual orientation state */
    /** @private 设备的实际方向 */
    private _orientationDevice = Orientation.AUTO;

    constructor () {
        super();
        // TODO: need to access frame from 'pal/launcher' module
        // TODO: 需要从 'pal/launcher' 模块访问框架
        this._gameFrame = document.getElementById('GameDiv') as HTMLDivElement;
        this._gameContainer = document.getElementById('Cocos3dGameContainer') as HTMLDivElement;
        this._gameCanvas = document.getElementById('GameCanvas') as HTMLCanvasElement;

        // Compatibility with old preview or build template in Editor.
        // 与编辑器中旧预览或构建模板的兼容性。
        if (!TEST && !EDITOR) {
            if (!this._gameFrame) {
                this._gameFrame = document.createElement<'div'>('div');
                this._gameFrame.setAttribute('id', 'GameDiv');
                this._gameCanvas?.parentNode?.insertBefore(this._gameFrame, this._gameCanvas);
                this._gameFrame.appendChild(this._gameCanvas);
            }
            if (!this._gameContainer) {
                this._gameContainer = document.createElement<'div'>('div');
                this._gameContainer.setAttribute('id', 'Cocos3dGameContainer');
                this._gameCanvas?.parentNode?.insertBefore(this._gameContainer, this._gameCanvas);
                this._gameContainer.appendChild(this._gameCanvas);
            }
        }

        // Detect and map cross-browser fullscreen API functions
        // 检测并映射跨浏览器全屏 API 函数
        let fnList: Array<string>;
        const fnGroup = this._fnGroup;
        for (let i = 0; i < fnGroup.length; i++) {
            fnList = fnGroup[i];
            // detect event support
            // 检测事件支持
            if (typeof document[fnList[1]] !== 'undefined') {
                for (let i = 0; i < fnList.length; i++) {
                    this._fn[fnGroup[0][i]] = fnList[i];
                }
                break;
            }
        }

        this._supportFullScreen = (this._fn.requestFullscreen !== undefined);
        this._touchEventName = ('ontouchstart' in window) ? 'touchend' : 'mousedown';
        this._registerEvent();
    }

    /**
     * @method init
     * @description Initializes screen adapter with configuration options
     * @description_zh 使用配置选项初始化屏幕适配器
     * @param {IScreenOptions} options - Screen configuration options
     * @param_zh {IScreenOptions} options - 屏幕配置选项
     * @param {() => void} cbToRebuildFrameBuffer - Callback for framebuffer updates
     * @param_zh {() => void} cbToRebuildFrameBuffer - 帧缓冲区更新的回调
     * @ai_context Main initialization method that sets up screen behavior based on configuration
     * @ai_context_zh 根据配置设置屏幕行为的主要初始化方法
     */
    public init (options: IScreenOptions, cbToRebuildFrameBuffer: () => void): void {
        this._cbToUpdateFrameBuffer = cbToRebuildFrameBuffer;
        this.orientation = orientationMap[options.configOrientation];
        this._exactFitScreen = options.exactFitScreen;
        this._isHeadlessMode = options.isHeadlessMode;
        this._resizeFrame();
    }

    /**
     * @method requestFullScreen
     * @description Requests fullscreen mode with fallback for user gesture requirement
     * @description_zh 请求全屏模式，错误时等待用户交互
     * @returns {Promise<void>} Promise that resolves when fullscreen is achieved
     * @returns_zh {Promise<void>} 当实现全屏时解析的 Promise
     */
    public requestFullScreen (): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isFullScreen) {
                resolve();
                return;
            }
            this._cachedFrameSize = this.windowSize;
            this._doRequestFullScreen().then(() => {
                resolve();
            }).catch(() => {
                const fullscreenTarget = this._getFullscreenTarget();
                if (!fullscreenTarget) {
                    reject(new Error('Cannot access fullscreen target'));
                    return;
                }
                // Fallback: wait for user gesture
                // 回退：等待用户手势
                fullscreenTarget.addEventListener(this._touchEventName, () => {
                    this._doRequestFullScreen().then(() => {
                        resolve();
                    }).catch(reject);
                }, { once: true, capture: true });
            });
        });
    }

    /**
     * @method exitFullScreen
     * @description Exits fullscreen mode and restores previous window size
     * @description_zh 退出全屏模式并恢复之前的窗口大小
     * @returns {Promise<void>} Promise that resolves when fullscreen is exited
     * @returns_zh {Promise<void>} 当退出全屏时解析的 Promise
     */
    public exitFullScreen (): Promise<void> {
        return new Promise((resolve, reject) => {
            const requestPromise = document[this._fn.exitFullscreen]();
            if (window.Promise && requestPromise instanceof Promise) {
                requestPromise.then(() => {
                    this.windowSize = this._cachedFrameSize;
                    resolve();
                }).catch(reject);
                return;
            }
            this.windowSize = this._cachedFrameSize;
            resolve();
        });
    }

    /**
     * @method _registerEvent
     * @description Registers all necessary event listeners for screen management
     * @description_zh 为屏幕管理注册所有必要的事件监听器
     * @private
     */
    private _registerEvent (): void {
        // Fullscreen error handling
        // 全屏错误处理
        document.addEventListener(this._fn.fullscreenerror, (): void => {
            this._onFullscreenError?.();
        });

        // Window resize handling
        // 窗口调整大小处理
        window.addEventListener('resize', (): void => {
            // if (!this.handleResizeEvent) {
            //     return;
            // }
            this._updateFrame();
        });

        /**
         * @function notifyOrientationChange
         * @description Notifies orientation change if different from current
         * @description_zh 如果与当前不同则通知方向变化
         * @param {Orientation} orientation - New orientation value
         * @param_zh {Orientation} orientation - 新的方向值
         */
        const notifyOrientationChange = (orientation): void => {
            if (orientation === this._orientationDevice) {
                return;
            }
            this._orientationDevice = orientation;
            this._updateFrame();
            this.emit('orientation-change', orientation);
        };

        /**
         * @function getOrientation
         * @description Gets orientation from window.orientation property
         * @description_zh 从 window.orientation 属性获取方向
         * @returns {Orientation} Detected orientation
         * @returns_zh {Orientation} 检测到的方向
         */
        const getOrientation = (): Orientation => {
            let tmpOrientation = Orientation.PORTRAIT;
            switch (window.orientation) {
            case 0:
                tmpOrientation = Orientation.PORTRAIT;
                break;
            case 90:
                // Handle landscape orientation, top side facing to the right
                // 处理横向方向，顶部朝向右侧
                tmpOrientation = Orientation.LANDSCAPE_RIGHT;
                break;
            case -90:
                // Handle landscape orientation, top side facing to the left
                // 处理横向方向，顶部朝向左侧
                tmpOrientation = Orientation.LANDSCAPE_LEFT;
                break;
            case 180:
                tmpOrientation = Orientation.PORTRAIT_UPSIDE_DOWN;
                break;
            default:
                tmpOrientation = this._orientationDevice;
                break;
            }
            return tmpOrientation;
        };

        /*After receive orientation-change event, window.innerWidth & innerHeight may not change immediately,
        so we delay EVENT_TIMEOUT to handle orientation-change.*/
        let handleOrientationChange;

        /**
         * @function orientationChangeCallback
         * @description Debounced orientation change handler
         * @description_zh 防抖的方向变化处理程序
         */
        const orientationChangeCallback = (): void => {
            if (this._orientationChangeTimeoutId !== -1) {
                clearTimeout(this._orientationChangeTimeoutId);
            }
            this._orientationChangeTimeoutId = setTimeout((): void => {
                handleOrientationChange();
            }, EVENT_TIMEOUT);
        };

        // Modern browsers: use MediaQuery API for orientation detection
        if (typeof window.matchMedia === 'function') {
            /**
             * @function updateDPRChangeListener
             * @description Sets up device pixel ratio change detection
             * @description_zh 设置设备像素比变化检测
             */
            const updateDPRChangeListener = (): void => {
                const dpr = this.devicePixelRatio;
                // NOTE: some browsers especially on iPhone doesn't support MediaQueryList
                // 注意：某些浏览器，特别是 iPhone 上的浏览器不支持 MediaQueryList
                const mediaQueryResolution = window.matchMedia(`(resolution: ${dpr}dppx)`);
                if (mediaQueryResolution.addEventListener) {
                    mediaQueryResolution.addEventListener('change', (): void => {
                        this.emit('window-resize', this.windowSize.width, this.windowSize.height);
                        updateDPRChangeListener();
                    }, { once: true });
                } else if (mediaQueryResolution.addListener) {
                    mediaQueryResolution.addListener((): void => {
                        this.emit('window-resize', this.windowSize.width, this.windowSize.height);
                    });
                }
            };
            updateDPRChangeListener();

            const mediaQueryPortrait = window.matchMedia('(orientation: portrait)');
            const mediaQueryLandscape = window.matchMedia('(orientation: landscape)');
            // eslint-disable-next-line no-restricted-globals
            const hasScreeOrientation = screen.orientation;

            /**
             * @function handleOrientationChange
             * @description Modern orientation change handler using MediaQuery
             * @description_zh 使用 MediaQuery 的现代方向变化处理程序
             */
            handleOrientationChange = (): void => {
                let tmpOrientation: Orientation = this._orientationDevice;
                if (mediaQueryPortrait.matches) {
                    tmpOrientation = Orientation.PORTRAIT;
                    if (hasScreeOrientation) {
                        // eslint-disable-next-line no-restricted-globals
                        const orientationType = screen.orientation.type;
                        if (orientationType === 'portrait-primary') {
                            tmpOrientation = Orientation.PORTRAIT;
                        } else {
                            tmpOrientation = Orientation.PORTRAIT_UPSIDE_DOWN;
                        }
                    }
                } else if (mediaQueryLandscape.matches) {
                    tmpOrientation = Orientation.LANDSCAPE;
                    if (hasScreeOrientation) {
                        // eslint-disable-next-line no-restricted-globals
                        const orientationType = screen.orientation.type;
                        if (orientationType === 'landscape-primary') {
                            tmpOrientation = Orientation.LANDSCAPE_LEFT;
                        } else {
                            tmpOrientation = Orientation.LANDSCAPE_RIGHT;
                        }
                    }
                }
                notifyOrientationChange(tmpOrientation);
            };

            // Register MediaQuery listeners
            // 注册 MediaQuery 监听器
            if (mediaQueryPortrait.addEventListener) {
                mediaQueryPortrait.addEventListener('change', orientationChangeCallback);
                mediaQueryLandscape.addEventListener('change', orientationChangeCallback);
            } else if (mediaQueryPortrait.addListener) {
                mediaQueryPortrait.addListener(orientationChangeCallback);
                mediaQueryLandscape.addListener(orientationChangeCallback);
            }
        } else {
            // Fallback for older browsers: use orientationchange event
            // 旧浏览器的回退：使用 orientationchange 事件
            handleOrientationChange = (): void => {
                const tmpOrientation = getOrientation();
                notifyOrientationChange(tmpOrientation);
            };
            window.addEventListener('orientationchange', orientationChangeCallback);
        }

        // Fullscreen change event handling
        // 全屏变化事件处理
        document.addEventListener(this._fn.fullscreenchange, () => {
            this._onFullscreenChange?.();
            this.emit('fullscreen-change', this.windowSize.width, this.windowSize.height);
        });
    }

    /**
     * @method _convertToSizeInCssPixels
     * @description Converts physical pixel size to CSS pixel size
     * @description_zh 将物理像素大小转换为 CSS 像素大小
     * @param {Size} size - Size in physical pixels
     * @param_zh {Size} size - 物理像素中的大小
     * @returns {Size} Size in CSS pixels
     * @returns_zh {Size} CSS 像素中的大小
     * @private
     * @ai_context Handles device pixel ratio conversion for proper CSS sizing
     * @ai_context_zh 处理设备像素比转换以进行正确的 CSS 大小调整
     */
    private _convertToSizeInCssPixels (size: Size): Size {
        const clonedSize = size.clone();
        const dpr = this.devicePixelRatio;
        clonedSize.width /= dpr;
        clonedSize.height /= dpr;
        return clonedSize;
    }

    /**
     * @method _resizeFrame
     * @description Resizes the game frame based on window type and orientation
     * @description_zh 根据窗口类型和方向调整游戏框架大小
     * @param {Size} [sizeInCssPixels] - Optional size for SubFrame mode
     * @param_zh {Size} [sizeInCssPixels] - SubFrame 模式的可选大小
     * @private
     */
    private _resizeFrame (sizeInCssPixels?: Size): void {
        if (!this._gameFrame) {
            return;
        }
        // Center align the canvas
        // 居中对齐画布
        this._gameFrame.style.display = 'flex';
        this._gameFrame.style['justify-content'] = 'center';
        this._gameFrame.style['align-items'] = 'center';

        if (this._windowType === WindowType.SubFrame) {
            if (!sizeInCssPixels) {
                this._updateContainer();
                return;
            }
            this._gameFrame.style.width = `${sizeInCssPixels.width}px`;
            this._gameFrame.style.height = `${sizeInCssPixels.height}px`;
        } else {
            const winWidth = window.innerWidth;
            let winHeight = window.innerHeight;

            //On certain android devices, window.innerHeight may not account for the height of the virtual keyboard, so dynamic calculation is necessary.
            //在某些 Android 设备上，window.innerHeight 可能不会考虑虚拟键盘的高度，因此需要动态计算。
            const inputHeight = document.body.scrollHeight - winHeight;
            if (systemInfo.os === OS.ANDROID && winHeight < inputHeight) {
                winHeight += inputHeight;
            }

            if (this.isFrameRotated) {
                // Apply 90-degree rotation for mobile landscape mode
                // 为移动横向模式应用 90 度旋转
                this._gameFrame.style['-webkit-transform'] = 'rotate(90deg)';
                this._gameFrame.style.transform = 'rotate(90deg)';
                this._gameFrame.style['-webkit-transform-origin'] = '0px 0px 0px';
                this._gameFrame.style.transformOrigin = '0px 0px 0px';
                this._gameFrame.style.margin = `0 0 0 ${winWidth}px`;
                this._gameFrame.style.width = `${winHeight}px`;
                this._gameFrame.style.height = `${winWidth}px`;
            } else {
                // Normal orientation
                // 正常方向
                this._gameFrame.style['-webkit-transform'] = 'rotate(0deg)';
                this._gameFrame.style.transform = 'rotate(0deg)';
                // TODO
                // this._gameFrame.style['-webkit-transform-origin'] = '0px 0px 0px';
                // this._gameFrame.style.transformOrigin = '0px 0px 0px';
                this._gameFrame.style.margin = '0px auto';
                this._gameFrame.style.width = `${winWidth}px`;
                this._gameFrame.style.height = `${winHeight}px`;
            }
        }

        this._updateContainer();
    }

    /**
     * @method _getFullscreenTarget
     * @description Gets the appropriate DOM element for fullscreen operations
     * @description_zh 获取全屏操作的适当 DOM 元素
     * @returns {HTMLElement | undefined} Target element for fullscreen
     * @returns_zh {HTMLElement | undefined} 全屏的目标元素
     * @private
     */
    private _getFullscreenTarget (): HTMLElement | undefined {
        const windowType = this._windowType;
        if (windowType === WindowType.Fullscreen) {
            return document[this._fn.fullscreenElement] as HTMLElement;
        }
        if (windowType === WindowType.SubFrame) {
            return this._gameFrame;
        }
        // On web mobile, the transform of game frame doesn't work when it's on fullscreen.
        // So we need to make the body fullscreen.
        // 在移动 Web 上，游戏框架的变换在全屏时不起作用。
        // 所以我们需要让 body 全屏。
        return document.body;
    }

    /**
     * @method _doRequestFullScreen
     * @description Internal method to execute fullscreen request
     * @description_zh 执行全屏请求的内部方法
     * @returns {Promise<void>} Promise that resolves when fullscreen is achieved
     * @returns_zh {Promise<void>} 当实现全屏时解析的 Promise
     * @private
     */
    private _doRequestFullScreen (): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this._supportFullScreen) {
                reject(new Error('fullscreen is not supported'));
                return;
            }
            const fullscreenTarget = this._getFullscreenTarget();
            if (!fullscreenTarget) {
                reject(new Error('Cannot access fullscreen target'));
                return;
            }
            this._onFullscreenChange = undefined;
            this._onFullscreenError = undefined;
            const requestPromise = fullscreenTarget[this._fn.requestFullscreen]() as Promise<void> | undefined;
            if (window.Promise && requestPromise instanceof Promise) {
                requestPromise.then(resolve).catch(reject);
            } else {
                // Fallback for browsers without Promise-based fullscreen API
                // 对于没有基于 Promise 的全屏 API 的浏览器的回退
                this._onFullscreenChange = resolve;
                this._onFullscreenError = reject;
            }
        });
    }

    /**
     * @method _updateFrameState
     * @description Updates frame rotation state based on orientation and device type
     * @description_zh 根据方向和设备类型更新框架旋转状态
     * @private
     * @ai_context Determines when frame rotation is needed on mobile devices
     * @ai_context_zh 确定在移动设备上何时需要框架旋转
     */
    private _updateFrameState (): void {
        const orientation = this.orientation;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isBrowserLandscape = width > height;
        this.isFrameRotated = systemInfo.isMobile
            && ((isBrowserLandscape && orientation === Orientation.PORTRAIT)
             || (!isBrowserLandscape && orientation === Orientation.LANDSCAPE));
    }

    /**
     * @method _updateContainer
     * @description Updates game container size and scaling based on proportional mode
     * @description_zh 根据比例模式更新游戏容器大小和缩放
     * @private
     * @ai_context Handles container scaling logic for maintaining aspect ratios or filling frame
     * @ai_context_zh 处理容器缩放逻辑以保持宽高比或填充框架
     */
    private _updateContainer (): void {
        if (!this._gameContainer) {
            warnID(9201);
            return;
        }

        if (this.isProportionalToFrame) {
            if (!this._gameFrame) {
                warnID(9201);
                return;
            }
            // TODO: access designedResolution from Launcher module.
            // TODO: 从 Launcher 模块访问 designedResolution。
            const designedResolution = legacyCC.view.getDesignResolutionSize() as Size;
            const frame = this._gameFrame;
            const frameW = frame.clientWidth;
            const frameH = frame.clientHeight;
            const designW = designedResolution.width;
            const designH = designedResolution.height;
            const scaleX = frameW / designW;
            const scaleY = frameH / designH;
            const containerStyle = this._gameContainer.style;
            let containerW: number;
            let containerH: number;

            // Maintain aspect ratio by using smaller scale factor
            // 通过使用较小的缩放因子来保持宽高比
            if (scaleX < scaleY) {
                containerW = frameW;
                containerH = designH * scaleX;
            } else {
                containerW = designW * scaleY;
                containerH = frameH;
            }
            // Set window size on game container
            // 在游戏容器上设置窗口大小
            containerStyle.width = `${containerW}px`;
            containerStyle.height = `${containerH}px`;
        } else {
            const containerStyle = this._gameContainer.style;
            // game container exact fit game frame.
            // 游戏容器完全适合游戏框架。
            containerStyle.width = '100%';
            containerStyle.height = '100%';
        }

        // Cache Test - detect style changes and emit resize event
        // 缓存测试 - 检测样式变化并发出调整大小事件
        if (this._gameFrame
            && (this._cachedFrameStyle.width !== this._gameFrame.style.width
            || this._cachedFrameStyle.height !== this._gameFrame.style.height
            || this._cachedContainerStyle.width !== this._gameContainer.style.width
            || this._cachedContainerStyle.height !== this._gameContainer.style.height)) {
            this.emit('window-resize', this.windowSize.width, this.windowSize.height);

            // Update Cache
            // 更新缓存
            this._cachedFrameStyle.width = this._gameFrame.style.width;
            this._cachedFrameStyle.height = this._gameFrame.style.height;
            this._cachedContainerStyle.width = this._gameContainer.style.width;
            this._cachedContainerStyle.height = this._gameContainer.style.height;
        }
    }
}

/**
 * @constant screenAdapter
 * @description Singleton instance of ScreenAdapter for web platform
 * @description_zh Web 平台 ScreenAdapter 的单例实例
 */
export const screenAdapter = new ScreenAdapter();

checkPalIntegrity<typeof import('pal/screen-adapter')>(withImpl<typeof import('./screen-adapter')>());
