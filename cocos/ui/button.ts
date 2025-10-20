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

import { ccclass, help, executionOrder, menu, requireComponent, tooltip, displayOrder, type, rangeMin,
    rangeMax, serializable, executeInEditMode } from 'cc.decorator';
import { DEBUG, EDITOR, EDITOR_NOT_IN_PREVIEW, USE_XR } from 'internal:constants';
import { SpriteFrame } from '../2d/assets';
import { Component, EventHandler as ComponentEventHandler } from '../scene-graph';
import { UITransform, UIRenderer } from '../2d/framework';
import { EventMouse, EventTouch } from '../input/types';
import { Color, v3, Vec3 } from '../core/math';
import { ccenum } from '../core/value-types/enum';
import { lerp } from '../core/math/utils';
import { Node } from '../scene-graph/node';
import { Sprite, SpriteEventType } from '../2d/components/sprite';
import { legacyCC } from '../core/global-exports';
import { TransformBit } from '../scene-graph/node-enum';
import { NodeEventType } from '../scene-graph/node-event';
import { XrUIPressEventType } from '../xr/event/xr-event-handle';
import { warn } from '../core';

// Temporary color object used for color interpolation during transitions
// This avoids creating new Color objects during animation frames for better performance
const _tempColor = new Color();

/**
 * @en Enumeration defining the visual transition types available for button state changes.
 * These transitions provide visual feedback when the button state changes between normal, hover, pressed, and disabled states.
 *
 * @zh 定义按钮状态变化时可用的视觉过渡类型枚举。
 * 这些过渡在按钮在正常、悬停、按下和禁用状态之间切换时提供视觉反馈。
 */
enum Transition {
    /**
     * @en No visual transition effect. Button appearance remains static regardless of state changes.
     * Use this when you want instant state changes without animation.
     *
     * @zh 无视觉过渡效果。无论状态如何变化，按钮外观保持静态。
     * 当您希望状态立即改变而不需要动画时使用此选项。
     */
    NONE = 0,

    /**
     * @en Color-based transition. Button changes color smoothly between different states.
     * Requires target node to have a UIRenderer component (like Sprite) to modify color property.
     *
     * @zh 基于颜色的过渡。按钮在不同状态之间平滑地改变颜色。
     * 需要目标节点具有UIRenderer组件（如Sprite）来修改颜色属性。
     */
    COLOR = 1,

    /**
     * @en Sprite-based transition. Button switches between different sprite frames for each state.
     * Requires target node to have a Sprite component to change spriteFrame property.
     *
     * @zh 基于精灵的过渡。按钮为每个状态切换不同的精灵帧。
     * 需要目标节点具有Sprite组件来更改spriteFrame属性。
     */
    SPRITE = 2,

    /**
     * @en Scale-based transition. Button changes size smoothly between different states.
     * Modifies the transform scale of the target node, typically making pressed state smaller.
     *
     * @zh 基于缩放的过渡。按钮在不同状态之间平滑地改变大小。
     * 修改目标节点的变换缩放，通常使按下状态变小。
     */
    SCALE = 3,
}

ccenum(Transition);

/**
 * @en Internal enumeration representing the current interaction state of the button.
 * These states determine which visual properties (color, sprite, scale) should be applied.
 *
 * @zh 表示按钮当前交互状态的内部枚举。
 * 这些状态决定应该应用哪些视觉属性（颜色、精灵、缩放）。
 */
enum State {
    /** @en Default state when button is not being interacted with. @zh 按钮未被交互时的默认状态。 */
    NORMAL,
    /** @en State when mouse cursor is over the button (desktop only). @zh 鼠标光标悬停在按钮上时的状态（仅桌面端）。 */
    HOVER,
    /** @en State when button is being pressed/touched. @zh 按钮被按下/触摸时的状态。 */
    PRESSED,
    /** @en State when button is disabled and cannot be interacted with. @zh 按钮被禁用且无法交互时的状态。 */
    DISABLED,
}

/**
 * @en Event types emitted by the Button component.
 * IMPORTANT: All button events are dispatched from the owner Node, not the Button component itself.
 * Use node.on() to listen for these events, not button.on().
 *
 * @zh Button组件发出的事件类型。
 * 重要：所有按钮事件都从所有者Node分发，而不是Button组件本身。
 * 使用node.on()来监听这些事件，而不是button.on()。
 */
export enum ButtonEventType {
    /**
     * @en Fired when the button is successfully clicked/tapped.
     * This event is triggered after a complete press-and-release interaction.
     *
     * @event click
     * @param {Event.EventCustom} event - The custom event object containing event details
     * @param {Button} button - Reference to the Button component that triggered the event
     *
     * @zh 按钮成功点击/轻触时触发。
     * 此事件在完整的按下-释放交互后触发。
     */
    CLICK = 'click',
}

/**
 * @en
 * Interactive Button UI component that responds to user input with visual feedback and events.
 *
 * ## Core Features:
 * - Supports touch/mouse interaction across all platforms
 * - Provides 4 visual transition types for state changes
 * - Configurable target node for applying visual effects
 * - Event system integration with customizable click handlers
 *
 * ## Transition Types:
 *   - Button.Transition.NONE   → No visual feedback (instant state changes)
 *   - Button.Transition.COLOR  → Smooth color interpolation between states
 *   - Button.Transition.SPRITE → Sprite frame switching for each state
 *   - Button.Transition.SCALE  → Size scaling animation for press feedback
 *
 * ## Event Binding:
 * IMPORTANT: Events must be bound to the button's node, not the component itself.
 *
 * ### Universal Events (All Platforms):
 *  - NodeEventType.TOUCH_START  → Initial press/touch contact
 *  - NodeEventType.TOUCH_MOVE   → Drag movement while pressed
 *  - NodeEventType.TOUCH_END    → Release after successful press
 *  - NodeEventType.TOUCH_CANCEL → Press cancelled (finger/cursor moved outside)
 *
 * ### Desktop-Only Events:
 *   - NodeEventType.MOUSE_DOWN   → Mouse button pressed down
 *   - NodeEventType.MOUSE_MOVE   → Mouse movement while pressed
 *   - NodeEventType.MOUSE_ENTER  → Mouse cursor enters button area
 *   - NodeEventType.MOUSE_LEAVE  → Mouse cursor exits button area
 *   - NodeEventType.MOUSE_UP     → Mouse button released
 *
 * ## Usage Notes:
 * - Access clicked node via `event.target` in event callbacks
 * - Button requires UITransform component for proper hit testing
 * - Target node can be different from button node for advanced layouts
 *
 * @zh
 * 响应用户输入并提供视觉反馈和事件的交互式按钮UI组件。
 *
 * ## 核心功能：
 * - 支持跨平台的触摸/鼠标交互
 * - 为状态变化提供4种视觉过渡类型
 * - 可配置的目标节点用于应用视觉效果
 * - 事件系统集成，支持自定义点击处理器
 *
 * ## 过渡类型：
 *   - Button.Transition.NONE   → 无视觉反馈（即时状态变化）
 *   - Button.Transition.COLOR  → 状态间的平滑颜色插值
 *   - Button.Transition.SPRITE → 每个状态的精灵帧切换
 *   - Button.Transition.SCALE  → 按压反馈的大小缩放动画
 *
 * ## 事件绑定：
 * 重要：事件必须绑定到按钮的节点，而不是组件本身。
 *
 * ### 通用事件（所有平台）：
 *   - NodeEventType.TOUCH_START  → 初始按下/触摸接触
 *   - NodeEventType.TOUCH_MOVE   → 按下时的拖拽移动
 *   - NodeEventType.TOUCH_END    → 成功按下后的释放
 *   - NodeEventType.TOUCH_CANCEL → 按下取消（手指/光标移出范围）
 *
 * ## 使用说明：
 * - 通过事件回调中的`event.target`访问被点击的节点
 * - 按钮需要UITransform组件进行正确的命中测试
 * - 目标节点可以与按钮节点不同，用于高级布局
 *
 * @example
 * ```ts
 * import { log, Node } from 'cc';
 *
 * // Basic touch event handling
 * button.node.on(Node.EventType.TOUCH_START, (event) => {
 *     log('Button press started');
 * });
 *
 * // Click event with button component access
 * button.node.on(Node.EventType.CLICK, (button) => {
 *     log('Button clicked:', button.node.name);
 *     // Note: Touch event details are not available in click events
 * });
 *
 * // Configure visual transitions
 * button.transition = Button.Transition.COLOR;
 * button.normalColor = Color.WHITE;
 * button.pressedColor = Color.GRAY;
 * ```
 */
@ccclass('cc.Button')
@help('i18n:cc.Button')
@executionOrder(110)
@menu('UI/Button')
@requireComponent(UITransform)
@executeInEditMode
export class Button extends Component {
    /**
     * @en
     * The target node that receives visual transition effects when button state changes.
     * If not explicitly set, defaults to the button's own node.
     *
     * ## Transition Effects by Type:
     * - **NONE**: No visual changes applied to target
     * - **COLOR**: Modifies target's UIRenderer.color property (requires Sprite/Label/etc.)
     * - **SPRITE**: Changes target's Sprite.spriteFrame property (requires Sprite component)
     * - **SCALE**: Animates target's transform.scale property (works on any Node)
     *
     * ## Use Cases:
     * - Set to child node for complex button layouts
     * - Use background node when button itself shouldn't change
     * - Apply effects to multiple nodes by changing target dynamically
     *
     * @zh
     * 当按钮状态改变时接收视觉过渡效果的目标节点。
     * 如果未明确设置，默认为按钮自己的节点。
     *
     * ## 按类型的过渡效果：
     * - **NONE**: 不对目标应用视觉变化
     * - **COLOR**: 修改目标的UIRenderer.color属性（需要Sprite/Label等）
     * - **SPRITE**: 更改目标的Sprite.spriteFrame属性（需要Sprite组件）
     * - **SCALE**: 动画化目标的transform.scale属性（适用于任何Node）
     *
     * ## 使用场景：
     * - 设置为子节点以实现复杂按钮布局
     * - 当按钮本身不应改变时使用背景节点
     * - 通过动态更改目标将效果应用于多个节点
     */
    @type(Node)
    @displayOrder(0)
    @tooltip('i18n:button.target')
    get target (): Node {
        return this._target || this.node;
    }

    set target (value) {
        if (this._target === value) {
            return;
        }
        if (this._target) {
            // need to remove the old target event listeners
            this._unregisterTargetEvent(this._target);
        }
        this._target = value;
        this._applyTarget();
    }

    /**
     * @en
     * Controls whether the button can respond to user interactions.
     *
     * - **true**: Button is interactive and will respond to touch/mouse events and trigger transitions
     * - **false**: Button is disabled, ignores all input events, and displays in disabled state
     *
     * When set to false, the button automatically transitions to the disabled visual state
     * and stops processing any touch or mouse events until re-enabled.
     *
     * @zh
     * 控制按钮是否能响应用户交互。
     *
     * - **true**: 按钮可交互，将响应触摸/鼠标事件并触发过渡
     * - **false**: 按钮被禁用，忽略所有输入事件，并显示为禁用状态
     *
     * 当设置为false时，按钮自动过渡到禁用视觉状态，
     * 并停止处理任何触摸或鼠标事件，直到重新启用。
     */
    @displayOrder(1)
    @tooltip('i18n:button.interactable')
    get interactable (): boolean {
        return this._interactable;
    }

    set interactable (value) {
        // if (EDITOR) {
        //     if (value) {
        //         this._previousNormalSprite = this.normalSprite;
        //     } else {
        //         this.normalSprite = this._previousNormalSprite;
        //     }
        // }
        if (this._interactable === value) {
            return;
        }

        this._interactable = value;
        this._updateState();

        if (!this._interactable) {
            this._resetState();
        }
    }

    /**
     * @deprecated since v3.7.0, this is an engine private interface that will be removed in the future.
     */
    set _resizeToTarget (value: boolean) {
        if (value) {
            this._resizeNodeToTargetNode();
        }
    }

    /**
     * @en
     * Defines the visual transition animation type used when button state changes.
     *
     * Changing this property will:
     * 1. Reset current transition to normal state
     * 2. Apply the new transition type immediately
     * 3. Update visual appearance based on current button state
     *
     * ## Requirements by Type:
     * - **COLOR**: Target node must have UIRenderer component (Sprite, Label, etc.)
     * - **SPRITE**: Target node must have Sprite component
     * - **SCALE**: Works with any Node (no special requirements)
     * - **NONE**: No requirements, disables all visual feedback
     *
     * @zh
     * 定义按钮状态改变时使用的视觉过渡动画类型。
     *
     * 更改此属性将：
     * 1. 将当前过渡重置为正常状态
     * 2. 立即应用新的过渡类型
     * 3. 根据当前按钮状态更新视觉外观
     *
     * ## 各类型要求：
     * - **COLOR**: 目标节点必须有UIRenderer组件（Sprite、Label等）
     * - **SPRITE**: 目标节点必须有Sprite组件
     * - **SCALE**: 适用于任何Node（无特殊要求）
     * - **NONE**: 无要求，禁用所有视觉反馈
     */
    @type(Transition)
    @displayOrder(2)
    @tooltip('i18n:button.transition')
    get transition (): Transition {
        return this._transition;
    }

    set transition (value: Transition) {
        if (this._transition === value) {
            return;
        }

        // Reset to normal data when change transition.
        if (this._transition === Transition.COLOR) {
            this._updateColorTransition(State.NORMAL);
        } else if (this._transition === Transition.SPRITE) {
            this._updateSpriteTransition(State.NORMAL);
        }
        this._transition = value;
        this._updateState();
    }

    // Color transition properties - only effective when transition type is COLOR

    /**
     * @en
     * Color displayed when button is in normal/idle state.
     * This is the default color shown when no user interaction is occurring.
     * Only takes effect when transition type is set to COLOR.
     *
     * @note Requires target node to have a UIRenderer component (Sprite, Label, etc.)
     *
     * @zh
     * 按钮处于正常/空闲状态时显示的颜色。
     * 这是没有用户交互时显示的默认颜色。
     * 仅在过渡类型设置为COLOR时生效。
     *
     * @note 需要目标节点具有UIRenderer组件（Sprite、Label等）
     */
    @displayOrder(3)
    @tooltip('i18n:button.normal_color')
    // @constget
    get normalColor (): Readonly<Color> {
        return this._normalColor;
    }

    set normalColor (value) {
        if (this._normalColor === value) {
            return;
        }

        this._normalColor.set(value);
        this._updateState(); // Immediately apply if currently in normal state
    }

    /**
     * @en
     * Color displayed when button is being pressed/touched.
     * Provides visual feedback during active user interaction.
     * Only takes effect when transition type is set to COLOR.
     *
     * @note Color transition is smoothly animated over the duration specified by the duration property
     *
     * @zh
     * 按钮被按下/触摸时显示的颜色。
     * 在活跃用户交互期间提供视觉反馈。
     * 仅在过渡类型设置为COLOR时生效。
     *
     * @note 颜色过渡在duration属性指定的时间内平滑动画
     */
    @displayOrder(3)
    @tooltip('i18n:button.pressed_color')
    // @constget
    get pressedColor (): Readonly<Color> {
        return this._pressedColor;
    }

    set pressedColor (value) {
        if (this._pressedColor === value) {
            return;
        }

        this._pressedColor.set(value);
        // Note: No immediate update needed as this only affects pressed state
    }

    /**
     * @en
     * Color displayed when mouse cursor hovers over the button (desktop platforms only).
     * Provides subtle visual feedback for mouse-based interaction.
     * Only takes effect when transition type is set to COLOR.
     *
     * @note This state is not triggered on touch-only devices (mobile/tablet)
     *
     * @zh
     * 鼠标光标悬停在按钮上时显示的颜色（仅桌面平台）。
     * 为基于鼠标的交互提供微妙的视觉反馈。
     * 仅在过渡类型设置为COLOR时生效。
     *
     * @note 此状态在纯触摸设备（手机/平板）上不会触发
     */
    @displayOrder(3)
    @tooltip('i18n:button.hover_color')
    // @constget
    get hoverColor (): Readonly<Color> {
        return this._hoverColor;
    }

    set hoverColor (value) {
        if (this._hoverColor === value) {
            return;
        }

        this._hoverColor.set(value);
        // Note: No immediate update needed as this only affects hover state
    }

    /**
     * @en
     * Color displayed when button is disabled (interactable = false).
     * Typically a grayed-out color to indicate the button cannot be used.
     * Only takes effect when transition type is set to COLOR.
     *
     * @note This color is applied immediately when button becomes disabled
     *
     * @zh
     * 按钮被禁用时显示的颜色（interactable = false）。
     * 通常是灰色，表示按钮无法使用。
     * 仅在过渡类型设置为COLOR时生效。
     *
     * @note 当按钮被禁用时，此颜色会立即应用
     */
    @displayOrder(3)
    @tooltip('i18n:button.disabled_color')
    // @constget
    get disabledColor (): Readonly<Color> {
        return this._disabledColor;
    }

    set disabledColor (value) {
        if (this._disabledColor === value) {
            return;
        }

        this._disabledColor.set(value);
        this._updateState(); // Immediately apply if currently disabled
    }

    /**
     * @en
     * Duration (in seconds) for transition animations between button states.
     * Controls how long it takes to animate from one visual state to another.
     *
     * ## Applies to:
     * - **COLOR**: Time to interpolate between colors
     * - **SCALE**: Time to animate scale changes
     * - **SPRITE**: Instant change (duration ignored for sprite transitions)
     *
     * ## Recommended Values:
     * - **0.1-0.2s**: Quick, responsive feel for mobile games
     * - **0.2-0.3s**: Standard desktop application feel
     * - **0.0s**: Instant transitions (no animation)
     *
     * @zh
     * 按钮状态间过渡动画的持续时间（秒）。
     * 控制从一个视觉状态动画到另一个状态需要多长时间。
     *
     * ## 适用于：
     * - **COLOR**: 颜色插值时间
     * - **SCALE**: 缩放变化动画时间
     * - **SPRITE**: 即时变化（精灵过渡忽略持续时间）
     *
     * ## 推荐值：
     * - **0.1-0.2秒**: 移动游戏的快速响应感
     * - **0.2-0.3秒**: 标准桌面应用感觉
     * - **0.0秒**: 即时过渡（无动画）
     */
    @rangeMin(0)
    @rangeMax(10)
    @displayOrder(4)
    @tooltip('i18n:button.duration')
    get duration (): number {
        return this._duration;
    }

    set duration (value) {
        if (this._duration === value) {
            return;
        }

        this._duration = value;
    }

    /**
     * @en
     * Scale multiplier applied to the button when pressed (only for SCALE transition).
     * The final scale equals: original_scale × zoomScale
     *
     * ## Common Values:
     * - **0.9-0.95**: Subtle press-in effect (recommended for most UI)
     * - **1.1-1.2**: Pop-out effect (good for game buttons)
     * - **1.0**: No scale change
     * - **0.8**: Strong press-in effect
     *
     * ## Notes:
     * - Only affects pressed state, other states use original scale
     * - Works on any Node, no component requirements
     * - Animation duration controlled by duration property
     * - Setting zoomScale < 1 may cause touchCancel if touch moves outside scaled area
     * - For values < 1, consider using a separate background node as target
     *
     * @zh
     * 按下时应用于按钮的缩放倍数（仅用于SCALE过渡）。
     * 最终缩放等于：原始缩放 × zoomScale
     *
     * ## 常用值：
     * - **0.9-0.95**: 微妙的按下效果（推荐用于大多数UI）
     * - **1.1-1.2**: 弹出效果（适合游戏按钮）
     * - **1.0**: 无缩放变化
     * - **0.8**: 强烈的按下效果
     *
     * ## 注意：
     * - 仅影响按下状态，其他状态使用原始缩放
     * - 适用于任何Node，无组件要求
     * - 动画持续时间由duration属性控制
     * - 设置 zoomScale < 1 可能导致触摸移出缩放区域时触发 touchCancel
     * - 对于 < 1 的值，考虑使用单独的背景节点作为目标
     */
    @displayOrder(3)
    @tooltip('i18n:button.zoom_scale')
    get zoomScale (): number {
        return this._zoomScale;
    }

    set zoomScale (value) {
        if (this._zoomScale === value) {
            return;
        }

        this._zoomScale = value;
    }

    // Sprite transition properties - only effective when transition type is SPRITE

    /**
     * @en
     * SpriteFrame displayed when button is in normal/idle state.
     * This is the default sprite shown when no user interaction is occurring.
     * Only takes effect when transition type is set to SPRITE.
     *
     * @note Requires target node to have a Sprite component
     * @note Setting this will immediately update the sprite if currently in normal state
     *
     * @zh
     * 按钮处于正常/空闲状态时显示的SpriteFrame。
     * 这是没有用户交互时显示的默认精灵。
     * 仅在过渡类型设置为SPRITE时生效。
     *
     * @note 需要目标节点具有Sprite组件
     * @note 设置此项将在当前处于正常状态时立即更新精灵
     */
    @type(SpriteFrame)
    @displayOrder(3)
    @tooltip('i18n:button.normal_sprite')
    get normalSprite (): SpriteFrame | null {
        return this._normalSprite;
    }

    set normalSprite (value: SpriteFrame | null) {
        if (this._normalSprite === value) {
            return;
        }

        this._normalSprite = value;
        // Immediately apply to sprite component if it exists
        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            sprite.spriteFrame = value;
        }

        this._updateState(); // Update state to apply changes
    }

    /**
     * @en
     * SpriteFrame displayed when button is being pressed/touched.
     * Provides visual feedback during active user interaction.
     * Only takes effect when transition type is set to SPRITE.
     *
     * @note Sprite transitions are instant (no animation duration)
     * @note If null, will fall back to normalSprite
     *
     * @zh
     * 按钮被按下/触摸时显示的SpriteFrame。
     * 在活跃用户交互期间提供视觉反馈。
     * 仅在过渡类型设置为SPRITE时生效。
     *
     * @note 精灵过渡是即时的（无动画持续时间）
     * @note 如果为null，将回退到normalSprite
     */
    @type(SpriteFrame)
    @displayOrder(3)
    @tooltip('i18n:button.pressed_sprite')
    get pressedSprite (): SpriteFrame | null {
        return this._pressedSprite;
    }

    set pressedSprite (value: SpriteFrame | null) {
        if (this._pressedSprite === value) {
            return;
        }

        this._pressedSprite = value;
        this._updateState(); // Update if currently in pressed state
    }

    /**
     * @en
     * SpriteFrame displayed when mouse cursor hovers over the button (desktop platforms only).
     * Provides subtle visual feedback for mouse-based interaction.
     * Only takes effect when transition type is set to SPRITE.
     *
     * @note This state is not triggered on touch-only devices (mobile/tablet)
     * @note If null, will fall back to normalSprite
     *
     * @zh
     * 鼠标光标悬停在按钮上时显示的SpriteFrame（仅桌面平台）。
     * 为基于鼠标的交互提供微妙的视觉反馈。
     * 仅在过渡类型设置为SPRITE时生效。
     *
     * @note 此状态在纯触摸设备（手机/平板）上不会触发
     * @note 如果为null，将回退到normalSprite
     */
    @type(SpriteFrame)
    @displayOrder(3)
    @tooltip('i18n:button.hover_sprite')
    get hoverSprite (): SpriteFrame | null {
        return this._hoverSprite;
    }

    set hoverSprite (value: SpriteFrame | null) {
        if (this._hoverSprite === value) {
            return;
        }

        this._hoverSprite = value;
        this._updateState(); // Update if currently in hover state
    }

    /**
     * @en
     * SpriteFrame displayed when button is disabled (interactable = false).
     * Typically a grayed-out or visually distinct sprite to indicate the button cannot be used.
     * Only takes effect when transition type is set to SPRITE.
     *
     * @note This sprite is applied immediately when button becomes disabled
     * @note If null, will fall back to normalSprite
     *
     * @zh
     * 按钮被禁用时显示的SpriteFrame（interactable = false）。
     * 通常是灰色或视觉上不同的精灵，表示按钮无法使用。
     * 仅在过渡类型设置为SPRITE时生效。
     *
     * @note 当按钮被禁用时，此精灵会立即应用
     * @note 如果为null，将回退到normalSprite
     */
    @type(SpriteFrame)
    @displayOrder(3)
    @tooltip('i18n:button.disabled_sprite')
    get disabledSprite (): SpriteFrame | null {
        return this._disabledSprite;
    }

    set disabledSprite (value: SpriteFrame | null) {
        if (this._disabledSprite === value) {
            return;
        }

        this._disabledSprite = value;
        this._updateState(); // Update if currently disabled
    }

    /**
     * @en
     * Static reference to the Transition enum for easy access.
     * Provides all available visual transition types for button state changes.
     *
     * @example
     * ```typescript
     * button.transition = Button.Transition.COLOR;
     * button.transition = Button.Transition.SCALE;
     * ```
     *
     * @zh
     * 过渡枚举的静态引用，便于访问。
     * 提供按钮状态变化的所有可用视觉过渡类型。
     */
    public static Transition = Transition;

    /**
     * @en
     * Static reference to ButtonEventType enum for event handling.
     *
     * **Important**: All button events are dispatched by the owner Node, not the Button component itself.
     * Use `node.on(Button.EventType.CLICK, callback)` to listen for events.
     *
     * @example
     * ```typescript
     * // Correct way to listen for button events
     * buttonNode.on(Button.EventType.CLICK, this.onButtonClick, this);
     *
     * // Incorrect - this won't work
     * buttonComponent.on(Button.EventType.CLICK, callback);
     * ```
     *
     * @zh
     * ButtonEventType枚举的静态引用，用于事件处理。
     *
     * **重要**: 所有按钮事件都由所属Node派发，而不是Button组件本身。
     * 使用 `node.on(Button.EventType.CLICK, callback)` 来监听事件。
     */
    public static EventType = ButtonEventType;

    /**
     * @en
     * Array of event handlers that will be triggered when the button is clicked.
     * This provides a visual way to configure click handlers in the editor.
     *
     * ## Usage:
     * - **Editor**: Drag target nodes and select methods in the inspector
     * - **Code**: Add handlers programmatically using ComponentEventHandler
     *
     * ## Event Flow:
     * 1. User clicks button (touch/mouse up within button bounds)
     * 2. Button validates interaction (must be interactable)
     * 3. All handlers in clickEvents array are executed
     * 4. Button.EventType.CLICK event is dispatched on the node
     *
     * @note These handlers execute before the node event dispatch
     * @note Handlers are called even if the button is disabled via code after click starts
     *
     * @zh
     * 按钮被点击时将触发的事件处理器数组。
     * 这提供了在编辑器中配置点击处理器的可视化方式。
     *
     * ## 用法：
     * - **编辑器**: 在检查器中拖拽目标节点并选择方法
     * - **代码**: 使用ComponentEventHandler以编程方式添加处理器
     *
     * ## 事件流程：
     * 1. 用户点击按钮（在按钮边界内触摸/鼠标抬起）
     * 2. 按钮验证交互（必须可交互）
     * 3. 执行clickEvents数组中的所有处理器
     * 4. 在节点上派发Button.EventType.CLICK事件
     *
     * @note 这些处理器在节点事件派发之前执行
     * @note 即使按钮在点击开始后通过代码禁用，处理器仍会被调用
     */
    @type([ComponentEventHandler])
    @serializable
    @displayOrder(20)
    @tooltip('i18n:button.click_events')
    public clickEvents: ComponentEventHandler[] = [];
    @serializable
    protected _interactable = true;
    @serializable
    protected _transition = Transition.NONE;
    @serializable
    protected _normalColor: Color = Color.WHITE.clone();
    @serializable
    protected _hoverColor: Color = new Color(211, 211, 211, 255);
    @serializable
    protected _pressedColor: Color = Color.WHITE.clone();
    @serializable
    protected _disabledColor: Color = new Color(124, 124, 124, 255);
    @serializable
    protected _normalSprite: SpriteFrame | null = null;
    @serializable
    protected _hoverSprite: SpriteFrame | null = null;
    @serializable
    protected _pressedSprite: SpriteFrame | null = null;
    @serializable
    protected _disabledSprite: SpriteFrame | null = null;
    @serializable
    protected _duration = 0.1;
    @serializable
    protected _zoomScale = 1.2;
    @serializable
    protected _target: Node | null = null;
    private _pressed = false;
    private _hovered = false;
    private _fromColor: Color = new Color();
    private _toColor: Color = new Color();
    private _time = 0;
    private _transitionFinished = true;
    private _fromScale: Vec3 = v3();
    private _toScale: Vec3 = v3();
    private _originalScale: Vec3 | null = null;
    private _sprite: Sprite | null = null;
    private _targetScale: Vec3 = v3();

    /**
     * @en
     * Button component constructor.
     * Initializes the button with default values and calls parent Component constructor.
     *
     * @zh
     * 按钮组件构造函数。
     * 使用默认值初始化按钮并调用父Component构造函数。
     */
    constructor () {
        super();
    }

    /**
     * @en
     * Pre-initialization method called before the component is enabled.
     * Sets up the target node and applies initial configuration.
     *
     * ## Initialization Steps:
     * 1. Sets target to self if not specified
     * 2. Applies target configuration and event bindings
     * 3. Resets button to normal state
     *
     * @zh
     * 在组件启用前调用的预初始化方法。
     * 设置目标节点并应用初始配置。
     *
     * ## 初始化步骤：
     * 1. 如果未指定目标，则设置为自身
     * 2. 应用目标配置和事件绑定
     * 3. 重置按钮到正常状态
     */
    public __preload (): void {
        if (!this.target) {
            this.target = this.node;
        }

        this._applyTarget();
        this._resetState();
    }

    /**
     * @en
     * Called when the component is enabled.
     * Registers event listeners and handles editor-specific sprite frame synchronization.
     *
     * ## Runtime vs Editor Behavior:
     * - **Runtime**: Registers touch/mouse input events for interaction
     * - **Editor**: Listens for sprite frame changes to maintain visual consistency
     *
     * @zh
     * 组件启用时调用。
     * 注册事件监听器并处理编辑器特定的精灵帧同步。
     *
     * ## 运行时与编辑器行为：
     * - **运行时**: 注册触摸/鼠标输入事件以进行交互
     * - **编辑器**: 监听精灵帧变化以保持视觉一致性
     */
    public onEnable (): void {
        // Register appropriate event listeners based on environment
        if (!EDITOR_NOT_IN_PREVIEW) {
            this._registerNodeEvent();
        } else {
            // In editor: sync sprite frames when they change
            this.node.on(SpriteEventType.SPRITE_FRAME_CHANGED, (comp: Sprite) => {
                if (this._transition === Transition.SPRITE) {
                    this._setCurrentStateSpriteFrame(comp.spriteFrame);
                } else {
                    // Avoid serialization data loss when not in sprite transition mode
                    this._normalSprite = null;
                    this._hoverSprite = null;
                    this._pressedSprite = null;
                    this._disabledSprite = null;
                }
            }, this);
        }
    }

    /**
     * @en
     * Called when the component is disabled.
     * Resets button state and unregisters all event listeners to prevent memory leaks.
     *
     * ## Cleanup Actions:
     * - Resets visual state to normal
     * - Clears pressed/hovered flags
     * - Unregisters input event listeners
     *
     * @zh
     * 组件禁用时调用。
     * 重置按钮状态并注销所有事件监听器以防止内存泄漏。
     *
     * ## 清理操作：
     * - 重置视觉状态为正常
     * - 清除按下/悬停标志
     * - 注销输入事件监听器
     */
    public onDisable (): void {
        this._resetState();

        if (!EDITOR_NOT_IN_PREVIEW) {
            this._unregisterNodeEvent();
        } else {
            this.node.off(SpriteEventType.SPRITE_FRAME_CHANGED);
        }
    }

    /**
     * @en
     * Called when the component is destroyed.
     * Performs final cleanup of target-related event listeners.
     *
     * @note Only cleans up if target node is still valid
     *
     * @zh
     * 组件销毁时调用。
     * 执行目标相关事件监听器的最终清理。
     *
     * @note 仅在目标节点仍然有效时进行清理
     */
    public onDestroy (): void {
        if (this.target.isValid) {
            this._unregisterTargetEvent(this.target);
        }
    }

    /**
     * @en
     * Frame update method that handles smooth transition animations.
     * Only processes COLOR and SCALE transitions as SPRITE transitions are instant.
     *
     * ## Animation Process:
     * 1. Calculates interpolation ratio based on elapsed time and duration
     * 2. Applies smooth interpolation between start and end values
     * 3. Updates target node's visual properties
     * 4. Marks transition as finished when complete
     *
     * @param dt - Delta time since last frame (in seconds)
     *
     * @zh
     * 帧更新方法，处理平滑过渡动画。
     * 仅处理COLOR和SCALE过渡，因为SPRITE过渡是即时的。
     *
     * ## 动画过程：
     * 1. 根据经过时间和持续时间计算插值比率
     * 2. 在开始和结束值之间应用平滑插值
     * 3. 更新目标节点的视觉属性
     * 4. 完成时标记过渡为已完成
     *
     * @param dt - 自上一帧以来的增量时间（秒）
     */
    public update (dt: number): void {
        const target = this.target;
        if (this._transitionFinished || !target) {
            return;
        }

        // Only COLOR and SCALE transitions need frame-by-frame updates
        if (this._transition !== Transition.COLOR && this._transition !== Transition.SCALE) {
            return;
        }

        this._time += dt;
        let ratio = 1.0;
        if (this._duration > 0) {
            ratio = this._time / this._duration;
        }

        // Clamp ratio to [0, 1] range
        if (ratio >= 1) {
            ratio = 1;
        }

        // Apply interpolated values based on transition type
        if (this._transition === Transition.COLOR) {
            const renderComp = target._uiProps.uiComp as UIRenderer;
            Color.lerp(_tempColor, this._fromColor, this._toColor, ratio);
            if (renderComp) {
                renderComp.color = _tempColor;
            }
        } else if (this.transition === Transition.SCALE) {
            target.getScale(this._targetScale);
            this._targetScale.x = lerp(this._fromScale.x, this._toScale.x, ratio);
            this._targetScale.y = lerp(this._fromScale.y, this._toScale.y, ratio);
            target.setScale(this._targetScale);
        }

        // Mark transition as complete when ratio reaches 1
        if (ratio === 1) {
            this._transitionFinished = true;
        }
    }

    protected _resizeNodeToTargetNode (): void {
        if (!this.target) {
            return;
        }
        const targetTrans = this.target._getUITransformComp();
        if (EDITOR && targetTrans) {
            this.node._getUITransformComp()!.setContentSize(targetTrans.contentSize);
        }
    }

    /**
     * @en
     * Resets the button to its normal state, clearing all interaction flags and visual effects.
     * This method is called during initialization, disable, and when transitioning back to normal.
     *
     * ## Reset Operations:
     * 1. Clears pressed and hovered state flags
     * 2. Restores normal visual appearance based on transition type
     * 3. Stops any ongoing transition animations
     *
     * ## Visual Restoration by Transition Type:
     * - **COLOR**: Restores normal color (only if interactable)
     * - **SCALE**: Restores original scale
     * - **SPRITE**: Handled elsewhere via state update
     * - **NONE**: No visual changes needed
     *
     * @zh
     * 将按钮重置为正常状态，清除所有交互标志和视觉效果。
     * 此方法在初始化、禁用和过渡回正常状态时调用。
     *
     * ## 重置操作：
     * 1. 清除按下和悬停状态标志
     * 2. 根据过渡类型恢复正常视觉外观
     * 3. 停止任何正在进行的过渡动画
     *
     * ## 按过渡类型的视觉恢复：
     * - **COLOR**: 恢复正常颜色（仅在可交互时）
     * - **SCALE**: 恢复原始缩放
     * - **SPRITE**: 通过状态更新在其他地方处理
     * - **NONE**: 不需要视觉变化
     */
    protected _resetState (): void {
        this._pressed = false;
        this._hovered = false;

        // Restore button visual state to normal
        const target = this.target;
        if (!target) {
            return;
        }

        const transition = this._transition;
        if (transition === Transition.COLOR && this._interactable) {
            const renderComp = target.getComponent(UIRenderer);
            if (renderComp) {
                renderComp.color = this._normalColor;
            }
        } else if (transition === Transition.SCALE && this._originalScale) {
            target.setScale(this._originalScale);
        }

        // Stop any ongoing transition animation
        this._transitionFinished = true;
    }

    protected _registerNodeEvent (): void {
        const self = this;
        const node = self.node;
        node.on(NodeEventType.TOUCH_START, self._onTouchBegan, self);
        node.on(NodeEventType.TOUCH_MOVE, self._onTouchMove, self);
        node.on(NodeEventType.TOUCH_END, self._onTouchEnded, self);
        node.on(NodeEventType.TOUCH_CANCEL, self._onTouchCancel, self);

        node.on(NodeEventType.MOUSE_ENTER, self._onMouseMoveIn, self);
        node.on(NodeEventType.MOUSE_LEAVE, self._onMouseMoveOut, self);

        if (USE_XR) {
            node.on(XrUIPressEventType.XRUI_HOVER_ENTERED, self._xrHoverEnter, self);
            node.on(XrUIPressEventType.XRUI_HOVER_EXITED, self._xrHoverExit, self);
            node.on(XrUIPressEventType.XRUI_CLICK, self._xrClick, self);
            node.on(XrUIPressEventType.XRUI_UNCLICK, self._xrUnClick, self);
        }
    }

    protected _registerTargetEvent (target): void {
        if (EDITOR_NOT_IN_PREVIEW) {
            target.on(SpriteEventType.SPRITE_FRAME_CHANGED, this._onTargetSpriteFrameChanged, this);
            target.on(NodeEventType.COLOR_CHANGED, this._onTargetColorChanged, this);
        }
        target.on(NodeEventType.TRANSFORM_CHANGED, this._onTargetTransformChanged, this);
    }

    protected _unregisterNodeEvent (): void {
        const self = this;
        const node = self.node;

        node.off(NodeEventType.TOUCH_START, self._onTouchBegan, self);
        node.off(NodeEventType.TOUCH_MOVE, self._onTouchMove, self);
        node.off(NodeEventType.TOUCH_END, self._onTouchEnded, self);
        node.off(NodeEventType.TOUCH_CANCEL, self._onTouchCancel, self);

        node.off(NodeEventType.MOUSE_ENTER, self._onMouseMoveIn, self);
        node.off(NodeEventType.MOUSE_LEAVE, self._onMouseMoveOut, self);

        if (USE_XR) {
            node.off(XrUIPressEventType.XRUI_HOVER_ENTERED, self._xrHoverEnter, self);
            node.off(XrUIPressEventType.XRUI_HOVER_EXITED, self._xrHoverExit, self);
            node.off(XrUIPressEventType.XRUI_CLICK, self._xrClick, self);
            node.off(XrUIPressEventType.XRUI_UNCLICK, self._xrUnClick, self);
        }
    }

    protected _unregisterTargetEvent (target): void {
        if (EDITOR_NOT_IN_PREVIEW) {
            target.off(SpriteEventType.SPRITE_FRAME_CHANGED);
            target.off(NodeEventType.COLOR_CHANGED);
        }
        target.off(NodeEventType.TRANSFORM_CHANGED);
    }

    protected _getTargetSprite (target: Node | null): Sprite | null {
        let sprite: Sprite | null = null;
        if (target) {
            sprite = target.getComponent(Sprite);
        }
        return sprite;
    }

    protected _applyTarget (): void {
        if (this.target) {
            this._sprite = this._getTargetSprite(this.target);
            if (!this._originalScale) {
                this._originalScale = new Vec3();
            }
            Vec3.copy(this._originalScale, this.target.scale);
            this._registerTargetEvent(this.target);
        }
    }

    private _onTargetSpriteFrameChanged (comp: Sprite): void {
        if (this._transition === Transition.SPRITE) {
            this._setCurrentStateSpriteFrame(comp.spriteFrame);
        }
    }

    private _setCurrentStateSpriteFrame (spriteFrame: SpriteFrame | null): void {
        if (!spriteFrame) {
            return;
        }
        switch (this._getButtonState()) {
        case State.NORMAL:
            this._normalSprite = spriteFrame;
            break;
        case State.HOVER:
            this._hoverSprite = spriteFrame;
            break;
        case State.PRESSED:
            this._pressedSprite = spriteFrame;
            break;
        case State.DISABLED:
            this._disabledSprite = spriteFrame;
            break;
        default:
            break;
        }
    }

    private _onTargetColorChanged (color: Color): void {
        if (this._transition === Transition.COLOR) {
            this._setCurrentStateColor(color);
        }
    }

    private _setCurrentStateColor (color: Color): void {
        switch (this._getButtonState()) {
        case State.NORMAL:
            this._normalColor = color;
            break;
        case State.HOVER:
            this._hoverColor = color;
            break;
        case State.PRESSED:
            this._pressedColor = color;
            break;
        case State.DISABLED:
            this._disabledColor = color;
            break;
        default:
            break;
        }
    }

    private _onTargetTransformChanged (transformBit: TransformBit): void {
        // update originalScale
        if ((transformBit & TransformBit.SCALE) && this._originalScale
            && this._transition === Transition.SCALE && this._transitionFinished) {
            Vec3.copy(this._originalScale, this.target.scale);
        }
    }

    protected _onTouchBegan (event?: EventTouch): void {
        if (!this._interactable || !this.enabledInHierarchy) { return; }

        this._pressed = true;
        this._updateState();
        if (event) {
            event.propagationStopped = true;
        }
    }

    protected _onTouchMove (event?: EventTouch): void {
        if (!this._interactable || !this.enabledInHierarchy || !this._pressed) { return; }
        // mobile phone will not emit _onMouseMoveOut,
        // so we have to do hit test when touch moving
        if (!event) {
            return;
        }

        const touch = (event).touch;
        if (!touch) {
            return;
        }

        const hit = this.node._getUITransformComp()!.hitTest(touch.getLocation(), event.windowId);

        if (this._transition === Transition.SCALE && this.target && this._originalScale) {
            if (hit) {
                Vec3.copy(this._fromScale, this._originalScale);
                Vec3.multiplyScalar(this._toScale, this._originalScale, this._zoomScale);
                this._transitionFinished = false;
            } else {
                this._time = 0;
                this._transitionFinished = true;
                this.target.setScale(this._originalScale);
            }
        } else {
            let state: State;
            if (hit) {
                state = State.PRESSED;
            } else {
                state = State.NORMAL;
            }
            this._applyTransition(state);
        }

        if (event) {
            event.propagationStopped = true;
        }
    }

    protected _onTouchEnded (event?: EventTouch): void {
        if (!this._interactable || !this.enabledInHierarchy) {
            return;
        }

        if (this._pressed) {
            ComponentEventHandler.emitEvents(this.clickEvents, event);
            this.node.emit(ButtonEventType.CLICK, this);
        }
        this._pressed = false;
        this._updateState();

        if (event) {
            event.propagationStopped = true;
        }
    }

    protected _onTouchCancel (event?: EventTouch): void {
        if (!this._interactable || !this.enabledInHierarchy) { return; }

        this._pressed = false;
        this._updateState();
    }

    protected _onMouseMoveIn (event?: EventMouse): void {
        if (this._pressed || !this.interactable || !this.enabledInHierarchy) { return; }
        if (this._transition === Transition.SPRITE && !this._hoverSprite) { return; }

        if (!this._hovered) {
            this._hovered = true;
            this._updateState();
        }
    }

    protected _onMouseMoveOut (event?: EventMouse): void {
        if (this._hovered) {
            this._hovered = false;
            this._updateState();
        }
    }

    protected _updateState (): void {
        const state = this._getButtonState();
        this._applyTransition(state);
    }

    protected _getButtonState (): State {
        let state = State.NORMAL;
        if (!this._interactable) {
            state = State.DISABLED;
        } else if (this._pressed) {
            state = State.PRESSED;
        } else if (this._hovered) {
            state = State.HOVER;
        }
        return state;
    }

    protected _updateColorTransition (state: State): void {
        const color = this._getColorByState(state);

        const renderComp = this.target?.getComponent(UIRenderer);
        if (!renderComp) {
            return;
        }

        if (EDITOR_NOT_IN_PREVIEW || state === State.DISABLED) {
            renderComp.color = color;
            this._transitionFinished = true;
        } else {
            this._fromColor = renderComp.color.clone();
            this._toColor = color;
            this._time = 0;
            this._transitionFinished = false;
        }
    }

    protected _updateSpriteTransition (state: State): void {
        const sprite = this._getSpriteFrameByState(state);
        if (this._sprite && sprite) {
            this._sprite.spriteFrame = sprite;
        }
    }

    protected _updateScaleTransition (state: State): void {
        if (!this._interactable) {
            return;
        }

        if (state === State.PRESSED) {
            this._zoomUp();
        } else {
            this._zoomBack();
        }
    }

    protected _zoomUp (): void {
        // skip before __preload()
        if (!this._originalScale) {
            return;
        }
        Vec3.copy(this._fromScale, this._originalScale);
        Vec3.multiplyScalar(this._toScale, this._originalScale, this._zoomScale);
        this._time = 0;
        this._transitionFinished = false;
    }

    protected _zoomBack (): void {
        if (!this.target || !this._originalScale) {
            return;
        }
        Vec3.copy(this._fromScale, this.target.scale);
        Vec3.copy(this._toScale, this._originalScale);
        this._time = 0;
        this._transitionFinished = false;
    }

    protected _applyTransition (state: State): void {
        const transition = this._transition;
        if (transition === Transition.COLOR) {
            this._updateColorTransition(state);
        } else if (transition === Transition.SPRITE) {
            this._updateSpriteTransition(state);
        } else if (transition === Transition.SCALE) {
            this._updateScaleTransition(state);
        }
    }

    private _getSpriteFrameByState (state: State): SpriteFrame | null {
        switch (state) {
        case State.NORMAL:
            return this._normalSprite;
        case State.DISABLED:
            return this._disabledSprite;
        case State.HOVER:
            return this.hoverSprite;
        case State.PRESSED:
            return this._pressedSprite;
        default:
            // Should not arrive here.
            if (DEBUG) {
                warn('Button._getColorByState(): wrong state.');
            }
            return null;
        }
    }

    private _getColorByState (state: State): Color {
        switch (state) {
        case State.NORMAL:
            return this._normalColor;
        case State.DISABLED:
            return this._disabledColor;
        case State.HOVER:
            return this._hoverColor;
        case State.PRESSED:
            return this._pressedColor;
        default:
            // Should not arrive here.
            if (DEBUG) {
                warn('Button._getColorByState(): wrong state.');
            }
            return new Color();
        }
    }

    private _xrHoverEnter (): void {
        if (!USE_XR) return;
        this._onMouseMoveIn();
        this._updateState();
    }

    private _xrHoverExit (): void {
        if (!USE_XR) return;
        this._onMouseMoveOut();
        if (this._pressed) {
            this._pressed = false;
            this._updateState();
        }
    }

    private _xrClick (): void {
        if (!USE_XR) return;
        if (!this._interactable || !this.enabledInHierarchy) { return; }
        this._pressed = true;
        this._updateState();
    }

    private _xrUnClick (): void {
        if (!USE_XR) return;
        if (!this._interactable || !this.enabledInHierarchy) {
            return;
        }

        if (this._pressed) {
            ComponentEventHandler.emitEvents(this.clickEvents, this);
            this.node.emit(ButtonEventType.CLICK, this);
        }
        this._pressed = false;
        this._updateState();
    }
}

legacyCC.Button = Button;
