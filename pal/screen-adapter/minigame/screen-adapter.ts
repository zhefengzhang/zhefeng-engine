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
 * @fileoverview Minigame Screen Adapter Implementation
 * @fileoverview 小游戏屏幕适配器实现
 * @ai_context This file implements screen adaptation for various minigame platforms including WeChat, Alipay, ByteDance, etc.
 * @ai_context_zh 此文件实现了各种小游戏平台的屏幕适配，包括微信、支付宝、字节跳动等
 */

import { ALIPAY, BYTEDANCE, TAOBAO_MINIGAME, VIVO, WECHAT } from 'internal:constants';
import { minigame } from 'pal/minigame';
import { IScreenOptions, SafeAreaEdge } from 'pal/screen-adapter';
import { systemInfo } from 'pal/system-info';
import { getError, warnID } from '../../../cocos/core/platform/debug';
import { EventTarget } from '../../../cocos/core/event/event-target';
import { Size } from '../../../cocos/core/math';
import { OS } from '../../system-info/enum-type';
import { Orientation } from '../enum-type';
import { checkPalIntegrity, withImpl } from '../../integrity-check';

/**
 * @description Alipay minigame API declaration
 * @description 支付宝小游戏API声明
 * @ai_context Global declaration for Alipay minigame specific APIs
 * @ai_context_zh 支付宝小游戏特定API的全局声明
 */
declare const my: any;

/**
 * @description HACK: Platform-specific landscape rotation flag for CocosPlay and Alipay iOS
 * @description 平台特定的横屏旋转标志，用于CocosPlay和支付宝iOS端
 * @ai_context This flag determines if the window size needs rotation during screenAdapter initialization in landscape mode
 * @ai_context_zh 此标志决定在横屏模式下初始化screenAdapter时是否需要旋转窗口尺寸
 */
let rotateLandscape = false;

try {
    if (ALIPAY) {
        if (systemInfo.os === OS.IOS && !minigame.isDevTool) {
            // TODO: use pal/fs
            // issue: https://github.com/cocos/cocos-engine/issues/14647
            /**
             * @description Read screen orientation from game.json configuration file
             * @description 从game.json配置文件读取屏幕方向
             * @ai_context Uses Alipay file system API to read game configuration and determine orientation
             * @ai_context_zh 使用支付宝文件系统API读取游戏配置并确定方向
             */
            const fs = my.getFileSystemManager();
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const screenOrientation = JSON.parse(fs.readFileSync({
                filePath: 'game.json',
                encoding: 'utf8',
            }).data).screenOrientation;
            rotateLandscape = (screenOrientation === 'landscape');
        }
    }
} catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
}

/**
 * @class ScreenAdapter
 * @description Minigame platform screen adapter implementation
 * @description 小游戏平台屏幕适配器实现
 * @extends EventTarget
 * @ai_context Handles screen adaptation for various minigame platforms with platform-specific logic
 * @ai_context_zh 处理各种小游戏平台的屏幕适配，包含平台特定逻辑
 */
class ScreenAdapter extends EventTarget {
    /**
     * @description Indicates if the game frame is currently rotated
     * @description_zh 指示游戏框架当前是否旋转
     * @ai_context Frame rotation state for orientation handling
     * @ai_context_zh 用于方向处理的帧旋转状态
     */
    public isFrameRotated = false;

    /**
     * @description Controls whether to handle resize events
     * @description 控制是否处理调整大小事件
     * @ai_context Flag to enable/disable window resize event handling
     * @ai_context_zh 启用/禁用窗口调整大小事件处理的标志
     */
    public handleResizeEvent = true;

    /**
     * @description Check if full screen mode is supported
     * @description 检查是否支持全屏模式
     * @returns {boolean} Always false for minigame platforms
     * @returns {boolean} 小游戏平台始终返回false
     * @ai_context Minigame platforms do not support full screen mode
     * @ai_context_zh 小游戏平台不支持全屏模式
     */
    public get supportFullScreen (): boolean {
        return false;
    }

    /**
     * @description Check if currently in full screen mode
     * @description 检查当前是否处于全屏模式
     * @returns {boolean} Always false for minigame platforms
     * @returns {boolean} 小游戏平台始终返回false
     * @ai_context Minigame platforms are never in full screen mode
     * @ai_context_zh 小游戏平台永远不会处于全屏模式
     */
    public get isFullScreen (): boolean {
        return false;
    }

    /**
     * @description Get device pixel ratio
     * @description 获取设备像素比
     * @returns {number} Device pixel ratio value
     * @returns {number} 设备像素比
     * @ai_context Platform-specific pixel ratio retrieval with WeChat special handling
     * @ai_context_zh 平台特定的像素比获取，微信有特殊处理
     */
    public get devicePixelRatio (): number {
        if (WECHAT) {
            const sysInfo = minigame.getWindowInfo();
            return sysInfo.pixelRatio;
        }
        const sysInfo = minigame.getSystemInfoSync();
        return sysInfo.pixelRatio;
    }

    /**
     * @description Get window size in physical pixels
     * @description 获取物理像素的窗口大小
     * @returns {Size} Window size object with width and height
     * @returns {Size} 包含宽度和高度的窗口大小对象
     * @ai_context Complex platform-specific window size calculation with DPR multiplication
     * @ai_context_zh 复杂的平台特定窗口大小计算，包含DPR乘法
     */
    public get windowSize (): Size {
        let sysInfo;
        if (WECHAT) {
            sysInfo = minigame.getWindowInfo();
        } else {
            sysInfo = minigame.getSystemInfoSync();
        }

        const dpr = this.devicePixelRatio;
        let screenWidth = sysInfo.windowWidth;
        let screenHeight = sysInfo.windowHeight;

        /**
         * @description Platform-specific size handling
         * @description 平台特定的尺寸处理
         */
        if (BYTEDANCE) {
            // ByteDance uses screen dimensions instead of window dimensions
            // 字节跳动使用屏幕尺寸而不是窗口尺寸
            screenWidth = sysInfo.screenWidth;
            screenHeight = sysInfo.screenHeight;
        } else if (ALIPAY && rotateLandscape && screenWidth < screenHeight) {
            // Alipay iOS landscape rotation handling
            // 支付宝iOS横屏旋转处理
            const temp = screenWidth;
            screenWidth = screenHeight;
            screenHeight = temp;
        } else if (TAOBAO_MINIGAME) {
            // Taobao minigame specific window info retrieval
            // 淘宝小游戏特定的窗口信息获取
            const windowInfo = my.getWindowInfoSync();
            if (windowInfo) {
                screenWidth = windowInfo.windowWidth;
                screenHeight = windowInfo.windowHeight;
            }
        }
        return new Size(screenWidth * dpr, screenHeight * dpr);
    }

    /**
     * @description Set window size (not supported in minigame)
     * @description 设置窗口大小（小游戏中不支持）
     * @param {Size} size - Target window size
     * @param {Size} size - 目标窗口大小
     * @ai_context Window size setting is not allowed in minigame platforms, shows warning
     * @ai_context_zh 小游戏平台不允许设置窗口大小，显示警告
     */
    public set windowSize (size: Size) {
        warnID(1221);
    }

    /**
     * @description Get current resolution
     * @description 获取分辨率
     * @returns {Size} Resolution size calculated from window size and scale
     * @returns {Size} 从窗口大小和缩放计算的分辨率大小
     * @ai_context Resolution is window size multiplied by resolution scale factor
     * @ai_context_zh 分辨率是窗口大小乘以分辨率缩放因子
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
     * @ai_context Scale factor for resolution calculation
     * @ai_context_zh 分辨率计算的缩放因子
     */
    public get resolutionScale (): number {
        return this._resolutionScale;
    }

    /**
     * @description Set resolution scale factor
     * @description 设置分辨率缩放因子
     * @param {number} value - New resolution scale value
     * @param {number} value - 新的分辨率缩放值
     * @ai_context Updates resolution scale and triggers frame buffer update if changed
     * @ai_context_zh 更新分辨率缩放并在更改时触发帧缓冲区更新
     */
    public set resolutionScale (value: number) {
        if (value === this._resolutionScale) {
            return;
        }
        this._resolutionScale = value;
        this._cbToUpdateFrameBuffer?.();
    }

    /**
     * @description Get current screen orientation
     * @description 获取当前屏幕方向
     * @returns {Orientation} Current orientation value
     * @returns {Orientation} 当前方向值
     * @ai_context Retrieves orientation from minigame platform API
     * @ai_context_zh 从小游戏平台API获取方向
     */
    public get orientation (): Orientation {
        return minigame.orientation;
    }

    /**
     * @description Set screen orientation (not supported in minigame)
     * @description 设置屏幕方向（小游戏中不支持）
     * @param {Orientation} value - Target orientation
     * @param {Orientation} value - 目标方向
     * @ai_context Orientation setting is not allowed in minigame platforms, shows warning
     * @ai_context_zh 小游戏平台不允许设置方向，显示警告
     */
    public set orientation (value: Orientation) {
        warnID(1221);
    }

    /**
     * @description Get safe area edge insets
     * @description 获取安全区
     * @returns {SafeAreaEdge} Safe area edge measurements
     * @returns {SafeAreaEdge} 安全区域边缘测量值
     * @ai_context Calculates safe area considering platform-specific DPR handling (VIVO uses physical pixels)
     * @ai_context_zh 计算安全区域，考虑平台特定的DPR处理（VIVO使用物理像素）
     */
    public get safeAreaEdge (): SafeAreaEdge {
        const minigameSafeArea = minigame.getSafeArea();
        const windowSize = this.windowSize;
        // NOTE: safe area info on vivo platform is in physical pixel.
        // No need to multiply with DPR.
        // 注意：vivo平台的安全区域信息以物理像素为单位，无需乘以DPR
        const dpr = VIVO ? 1 : this.devicePixelRatio;
        const topEdge = minigameSafeArea.top * dpr;
        const bottomEdge = windowSize.height - minigameSafeArea.bottom * dpr;
        const leftEdge = minigameSafeArea.left * dpr;
        const rightEdge = windowSize.width - minigameSafeArea.right * dpr;
        return {
            top: topEdge,
            bottom: bottomEdge,
            left: leftEdge,
            right: rightEdge,
        };
    }

    /**
     * @description Check if proportional to frame
     * @description 检查是否与帧成比例
     * @returns {boolean} Proportional state
     * @returns {boolean} 比例状态
     * @ai_context Frame proportionality flag for layout calculations
     * @ai_context_zh 用于布局计算的帧比例标志
     */
    public get isProportionalToFrame (): boolean {
        return this._isProportionalToFrame;
    }

    /**
     * @description Set proportional to frame (no-op in minigame)
     * @description 设置与帧成比例（小游戏中无操作）
     * @param {boolean} v - Proportional value
     * @param {boolean} v - 比例值
     * @ai_context Setter exists for interface compatibility but performs no operation
     * @ai_context_zh 设置器存在是为了接口兼容性，但不执行任何操作
     */
    public set isProportionalToFrame (v: boolean) { }

    /**
     * @description Callback function to update frame buffer
     * @description 更新帧缓冲区的回调函数
     * @ai_context Optional callback triggered when frame buffer needs updating
     * @ai_context_zh 当帧缓冲区需要更新时触发的可选回调
     */
    private _cbToUpdateFrameBuffer?: () => void;

    /** @private Current resolution scaling factor */
    /** @private 分辨率缩放因子 */
    private _resolutionScale = 1;

    /** @private Whether container should scale proportionally to frame */
    /** @private 是否按比例缩放 */
    private _isProportionalToFrame = false;

    constructor () {
        super();
        // Register window resize event listener if available
        // 如果可用，注册窗口调整大小事件监听器
        minigame.onWindowResize?.(() => {
            this.emit('window-resize', this.windowSize.width, this.windowSize.height);
        });
    }

    /**
     * @description Initialize screen adapter with options
     * @description 初始化屏幕适配器
     * @param {IScreenOptions} options - Screen configuration options
     * @param {IScreenOptions} options - 屏幕配置选项
     * @param {() => void} cbToRebuildFrameBuffer - Callback to rebuild frame buffer
     * @param {() => void} cbToRebuildFrameBuffer - 重建帧缓冲区的回调
     * @ai_context Initializes adapter with configuration and sets up frame buffer callback
     * @ai_context_zh 使用配置初始化适配器并设置帧缓冲区回调
     */
    public init (options: IScreenOptions, cbToRebuildFrameBuffer: () => void): void {
        this._cbToUpdateFrameBuffer = cbToRebuildFrameBuffer;
        this._cbToUpdateFrameBuffer();
    }

    /**
     * @description Request full screen mode (not supported)
     * @description 请求全屏模式（不支持）
     * @returns {Promise<void>} Rejected promise with error
     * @returns {Promise<void>} 带有错误的被拒绝的Promise
     */
    public requestFullScreen (): Promise<void> {
        return Promise.reject(new Error(getError(9008)));
    }

    /**
     * @description Exit full screen mode (not supported)
     * @description 退出全屏模式（不支持）
     * @returns {Promise<void>} Rejected promise with error
     * @returns {Promise<void>} 带有错误的被拒绝的Promise
     */
    public exitFullScreen (): Promise<void> {
        return Promise.reject(new Error(getError(9009)));
    }
}

/**
 * @description Exported screen adapter instance
 * @description 导出的屏幕适配器实例
 * @ai_context Singleton instance of ScreenAdapter for minigame platforms
 * @ai_context_zh 小游戏平台的ScreenAdapter单例实例
 */
export const screenAdapter = new ScreenAdapter();

/**
 * @description PAL integrity check for screen adapter implementation
 * @description 屏幕适配器实现的PAL完整性检查
 * @ai_context Ensures the implementation matches the expected interface
 * @ai_context_zh 确保实现与预期接口匹配
 */
checkPalIntegrity<typeof import('pal/screen-adapter')>(withImpl<typeof import('./screen-adapter')>());
