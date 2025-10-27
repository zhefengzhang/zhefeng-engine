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

import { ccclass, help, executeInEditMode, executionOrder, menu, requireComponent, tooltip, displayOrder, type, serializable } from 'cc.decorator';
import { EDITOR_NOT_IN_PREVIEW, JSB, MINIGAME, RUNTIME_BASED, USE_XR } from 'internal:constants';
import { UITransform } from '../../2d/framework';
import { SpriteFrame } from '../../2d/assets/sprite-frame';
import { Component } from '../../scene-graph/component';
import { EventHandler as ComponentEventHandler } from '../../scene-graph/component-event-handler';
import { Size } from '../../core/math';
import { EventTouch } from '../../input/types';
import { Node } from '../../scene-graph/node';
import { Label, VerticalTextAlignment } from '../../2d/components/label';
import { Sprite, SpriteEventType } from '../../2d/components/sprite';
import { EditBoxImpl } from './edit-box-impl';
import { EditBoxImplBase } from './edit-box-impl-base';
import { InputFlag, InputMode, KeyboardReturnType } from './types';
import { legacyCC } from '../../core/global-exports';
import { NodeEventType } from '../../scene-graph/node-event';
import { XrKeyboardEventType, XrUIPressEventType } from '../../xr/event/xr-event-handle';
import { director, DirectorEvent } from '../../game/director';

const LEFT_PADDING = 2;

function capitalize (str: string): string {
    return str.replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());
}

function capitalizeFirstLetter (str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

enum EditBoxEventType {
    EDITING_DID_BEGAN = 'editing-did-began',
    EDITING_DID_ENDED = 'editing-did-ended',
    TEXT_CHANGED = 'text-changed',
    EDITING_RETURN = 'editing-return',
    XR_EDITING_DID_BEGAN = 'xr-editing-did-began',
    XR_EDITING_DID_ENDED = 'xr-editing-did-ended',
}
/**
 * @en
 * `EditBox` is a component for inputing text, you can use it to gather small amounts of text from users.
 *
 * @zh
 * `EditBox` 组件，用于获取用户的输入文本。
 */

@ccclass('cc.EditBox')
@help('i18n:cc.EditBox')
@executionOrder(110)
@menu('UI/EditBox')
@requireComponent(UITransform)
@executeInEditMode
export class EditBox extends Component {
    /**
     * @en
     * The current text content of the EditBox.
     * - Setter clamps input to `maxLength` when `maxLength >= 0`.
     * - Setting the value triggers internal UI sync (`_updateString`) and toggles label visibility.
     * - When empty, the placeholder label is shown; otherwise, the text label is shown.
     * @returns Current input text.
     * @example
     * // Clamp to max length
     * const edit = node.getComponent(EditBox)!;
     * edit.maxLength = 5;
     * edit.string = '123456'; // becomes '12345'
     *
     * @zh
     * EditBox 的当前输入文本。
     * - 在 `maxLength >= 0` 时，setter 会将输入裁剪到 `maxLength`。
     * - 赋值会触发内部 UI 同步（`_updateString`）并控制文本/占位符的显隐。
     * - 当文本为空时显示占位符标签，否则显示文本标签。
     * @returns 当前输入文本。
     */
    @displayOrder(1)
    @tooltip('i18n:editbox.string')
    get string (): string {
        return this._string;
    }

    set string (value) {
        if (this._maxLength >= 0 && value.length >= this._maxLength) {
            value = value.slice(0, this._maxLength);
        }

        if (this._string === value) {
            return;
        }

        this._string = value;
        this._updateString(value);
    }

    /**
     * @en
     * The placeholder text shown when `string` is empty.
     * - Returns the current placeholder label text; returns an empty string if label is not created.
     * - Setting the value updates the placeholder Label's `string` if present.
     * @returns Current placeholder text.
     * @example
     * const edit = node.getComponent(EditBox)!;
     * edit.placeholder = 'Enter your name';
     *
     * @zh
     * 输入框占位符的文本内容。
     * - getter 返回当前占位符 Label 的文本；如果尚未创建则返回空字符串。
     * - setter 赋值会更新占位符 Label 的 `string`（若存在）。
     * @returns 当前占位符文本。
     */
    @displayOrder(2)
    @tooltip('i18n:editbox.placeholder')
    get placeholder (): string {
        if (!this._placeholderLabel) {
            return '';
        }
        return this._placeholderLabel.string;
    }

    set placeholder (value) {
        if (this._placeholderLabel) {
            this._placeholderLabel.string = value;
        }
    }

    /**
     * @en
     * The `Label` used to render the current input text.
     * - When assigned, internal label node is (re)configured and UI state is refreshed.
     * - Text wrapping is controlled by `inputMode` (`ANY` enables multiline with wrapping).
     * @returns The Label instance or `null` when not yet created.
     * @example
     * const edit = node.getComponent(EditBox)!;
     * edit.textLabel!.color = new Color(255, 255, 255);
     *
     * @zh
     * 渲染当前输入文本的 `Label` 组件。
     * - 赋值会使内部文本节点被（重新）配置，并刷新 UI 状态。
     * - 文本换行由 `inputMode` 控制（`ANY` 为多行并启用换行）。
     * @returns 该 Label 实例，未创建则为 `null`。
     */
    @type(Label)
    @displayOrder(3)
    @tooltip('i18n:editbox.text_lable')
    get textLabel (): Label | null {
        return this._textLabel;
    }

    set textLabel (oldValue) {
        if (this._textLabel !== oldValue) {
            this._textLabel = oldValue;
            if (this._textLabel) {
                this._updateTextLabel();
                this._updateLabels();
            }
        }
    }

    /**
     * @en
     * The `Label` used to render the placeholder text.
     * - Recreated/configured when assigned; UI state is refreshed accordingly.
     * - Text wrapping is controlled by `inputMode` (`ANY` enables multiline wrapping).
     * @returns The placeholder `Label` instance or `null` when not yet created.
     * @example
     * const edit = node.getComponent(EditBox)!;
     * edit.placeholderLabel!.color = new Color(120, 120, 120); // dim style
     *
     * @zh
     * 渲染占位符文本的 `Label` 组件。
     * - 赋值会（重新）创建/配置该节点，并刷新相关 UI 状态。
     * - 文本换行由 `inputMode` 控制（`ANY` 为多行并启用换行）。
     * @returns 占位符 `Label` 实例，未创建则为 `null`。
     */
    @type(Label)
    @displayOrder(4)
    @tooltip('i18n:editbox.placeholder_label')
    get placeholderLabel (): Label | null {
        return this._placeholderLabel;
    }

    set placeholderLabel (oldValue) {
        if (this._placeholderLabel !== oldValue) {
            this._placeholderLabel = oldValue;
            if (this._placeholderLabel) {
                this._updatePlaceholderLabel();
                this._updateLabels();
            }
        }
    }

    /**
     * @en
     * The background `SpriteFrame` used by the EditBox.
     * - Setting the value ensures a `Sprite` is present on the node and updates its `spriteFrame`.
     * - Background `Sprite` is configured as `SLICED` and sized to match the `UITransform`.
     * @returns Current background `SpriteFrame` or `null`.
     * @example
     * const edit = node.getComponent(EditBox)!;
     * edit.backgroundImage = sf;
     *
     * @zh
     * 输入框的背景图片。
     * - 赋值会确保节点上存在 `Sprite` 并更新其 `spriteFrame`。
     * - 背景 `Sprite` 配置为 `SLICED` 并自动匹配 `UITransform` 尺寸。
     * @returns 当前背景 `SpriteFrame` 或 `null`。
     */
    @type(SpriteFrame)
    @displayOrder(5)
    @tooltip('i18n:editbox.backgroundImage')
    get backgroundImage (): SpriteFrame | null {
        return this._backgroundImage;
    }

    set backgroundImage (value: SpriteFrame | null) {
        if (this._backgroundImage === value) {
            return;
        }

        this._backgroundImage = value;
        this._ensureBackgroundSprite();
        this._background!.spriteFrame = value;
    }

    /**
     * @en
     * Input display/formatting flags for the EditBox.
     * - Updating flags triggers `string` restyle (`_updateString`) to apply changes.
     * - Includes password mode, capitalization, etc.
     * @returns The current `InputFlag`.
     * @example
     * edit.inputFlag = InputFlag.PASSWORD;
     *
     * @zh
     * 指定输入标志位，可以指定输入方式为密码或者单词首字母大写。
     * - 更新该标志会触发 `string` 的重新样式化（`_updateString`）。
     * - 包含密码模式、单词首字母大写等。
     * @returns 当前 `InputFlag`。
     */
    @type(InputFlag)
    @displayOrder(6)
    @tooltip('i18n:editbox.input_flag')
    get inputFlag (): InputFlag {
        return this._inputFlag;
    }

    set inputFlag (value) {
        if (this._inputFlag === value) {
            return;
        }

        this._inputFlag = value;
        this._updateString(this._string);
    }

    /**
     * @en
     * Input mode for the EditBox.
     * - `ANY` enables multiline input; others are single-line.
     * - Setter reconfigures `textLabel` and `placeholderLabel` wrapping/alignment.
     * @returns Current `InputMode`.
     * @example
     * edit.inputMode = InputMode.ANY; // multiline
     *
     * @zh
     * EditBox 的输入模式。
     * - `ANY` 为多行输入，其它为单行输入。
     * - setter 会重新配置 `textLabel` 与 `placeholderLabel` 的换行/对齐。
     * @returns 当前 `InputMode`。
     */
    @type(InputMode)
    @displayOrder(7)
    @tooltip('i18n:editbox.input_mode')
    get inputMode (): InputMode {
        return this._inputMode;
    }

    set inputMode (oldValue) {
        if (this._inputMode !== oldValue) {
            this._inputMode = oldValue;
            this._updateTextLabel();
            this._updatePlaceholderLabel();
        }
    }

    /**
     * @en
     * The return key type on virtual keyboards (mobile only).
     * - No effect on Web/Desktop platforms.
     * @returns Current `KeyboardReturnType`.
     * @example
     * edit.returnType = KeyboardReturnType.SEARCH;
     *
     * @zh
     * 移动设备虚拟键盘的回车键样式。
     * - 对 Web/Desktop 平台无效。
     * @returns 当前 `KeyboardReturnType`。
     */
    @type(KeyboardReturnType)
    @displayOrder(8)
    @tooltip('i18n:editbox.returnType')
    get returnType (): KeyboardReturnType {
        return this._returnType;
    }

    set returnType (value: KeyboardReturnType) {
        this._returnType = value;
    }

    /**
     * @en
     * Maximum number of characters permitted.
     * - `< 0`: no limit.
     * - `0`: disallow any input.
     * - `> 0`: clamp `string` on set.
     * @returns Current max length.
     * @example
     * edit.maxLength = 5; edit.string = 'abcdef'; // 'abcde'
     *
     * @zh
     * 允许输入的最大字符数。
     * - `< 0`：不限制输入。
     * - `0`：禁止任何输入。
     * - `> 0`：为 `string` 赋值时进行裁剪。
     * @returns 当前最大长度。
     */
    @displayOrder(9)
    @tooltip('i18n:editbox.max_length')
    get maxLength (): number {
        return this._maxLength;
    }
    set maxLength (value: number) {
        this._maxLength = value;
    }

    /**
     * @en
     * DOM `tabIndex` for keyboard navigation (Web only).
     * - Applies only when a native DOM input is created by the platform layer.
     * - Setting updates underlying implementation via `_impl.setTabIndex`.
     * @returns Current tab index.
     * @example
     * edit.tabIndex = 10; // focus order in DOM
     *
     * @zh
     * DOM 键盘导航使用的 `tabIndex`（仅 Web 有效）。
     * - 仅在平台层创建原生 DOM 输入元素时生效。
     * - 赋值会通过 `_impl.setTabIndex` 更新底层实现。
     * @returns 当前 tab 索引。
     */
    @displayOrder(10)
    @tooltip('i18n:editbox.tab_index')
    get tabIndex (): number {
        return this._tabIndex;
    }

    set tabIndex (value) {
        if (this._tabIndex !== value) {
            this._tabIndex = value;
            if (this._impl) {
                this._impl.setTabIndex(value);
            }
        }
    }

    /**
     * @deprecated since v3.7.0, this is an engine private interface that will be removed in the future.
     */
    public static _EditBoxImpl = EditBoxImplBase;
    /**
     * @en
     * Keyboard Return Type enum alias for convenient access: `EditBox.KeyboardReturnType`.
     * @zh
     * 键盘返回键类型的枚举别名，便于通过 `EditBox.KeyboardReturnType` 访问。
     * @example
     * edit.returnType = EditBox.KeyboardReturnType.SEARCH;
     */
    public static KeyboardReturnType = KeyboardReturnType;
    /**
     * @en
     * InputFlag enum alias for convenient access: `EditBox.InputFlag`.
     * Includes password masking, capitalization rules, etc.
     * @zh
     * 输入标志位枚举的别名，可通过 `EditBox.InputFlag` 访问，包含密码掩码、大小写规则等。
     * @example
     * edit.inputFlag = EditBox.InputFlag.PASSWORD;
     */
    public static InputFlag = InputFlag;
    /**
     * @en
     * InputMode enum alias for convenient access: `EditBox.InputMode`.
     * Controls single-line vs. multiline behavior and label wrapping.
     * @zh
     * 输入模式枚举的别名，通过 `EditBox.InputMode` 访问，用于控制单行/多行行为与标签换行。
     * @example
     * edit.inputMode = EditBox.InputMode.ANY;
     */
    public static InputMode = InputMode;
    /**
     * @en
     * EditBox event type alias for `node.emit` and `ComponentEventHandler` mapping.
     * Includes:
     * - `editing-did-began`
     * - `text-changed`
     * - `editing-did-ended`
     * - `editing-return`
     * @zh
     * EditBox 的事件类型别名，用于 `node.emit` 与 `ComponentEventHandler` 的事件映射。
     * 包含：
     * - `editing-did-began`
     * - `text-changed`
     * - `editing-did-ended`
     * - `editing-return`
     * @example
     * node.emit(EditBox.EventType.TEXT_CHANGED, editBox);
     */
    public static EventType = EditBoxEventType;
    /**
     * @en
     * Event handlers invoked when editing begins.
     * - Triggered via `ComponentEventHandler.emitEvents(editingDidBegan, this)` and `node.emit(EDITING_DID_BEGAN, this)`.
     * - Registered handlers receive the `EditBox` instance.
     * @example
     * // Inspector: add handlers to `editingDidBegan`
     *
     * @zh
     * 开始编辑时触发的事件回调数组。
     * - 通过 `ComponentEventHandler.emitEvents(editingDidBegan, this)` 与 `node.emit(EDITING_DID_BEGAN, this)` 触发。
     * - 监听函数接收 `EditBox` 实例作为参数。
     */
    @type([ComponentEventHandler])
    @serializable
    @displayOrder(11)
    @tooltip('i18n:editbox.editing_began')
    public editingDidBegan: ComponentEventHandler[] = [];

    /**
     * @en
     * Event handlers invoked when text changes during editing.
     * - Triggered via `emitEvents(textChanged, text, this)` and `node.emit(TEXT_CHANGED, this)`.
     * - Handlers receive new text and `EditBox` instance.
     * @example
     * edit.textChanged.push(new ComponentEventHandler());
     *
     * @zh
     * 编辑时文本变化触发的事件回调数组。
     * - 通过 `emitEvents(textChanged, text, this)` 与 `node.emit(TEXT_CHANGED, this)` 触发。
     * - 监听函数接收新文本与 `EditBox` 实例。
     */
    @type([ComponentEventHandler])
    @serializable
    @displayOrder(12)
    @tooltip('i18n:editbox.text_changed')
    public textChanged: ComponentEventHandler[] = [];

    /**
     * @en
     * Event handlers invoked when editing ends.
     * - Triggered via `emitEvents(editingDidEnded, this)` and `node.emit(EDITING_DID_ENDED, this, text?)`.
     * - Some platforms may provide sanitized text payload via the event.
     * @example
     * edit.editingDidEnded.push(new ComponentEventHandler());
     *
     * @zh
     * 结束编辑时触发的事件回调数组。
     * - 通过 `emitEvents(editingDidEnded, this)` 与 `node.emit(EDITING_DID_ENDED, this, text?)` 触发。
     * - 某些平台可能会通过该事件提供脱敏后的文本负载。
     */
    @type([ComponentEventHandler])
    @serializable
    @displayOrder(13)
    @tooltip('i18n:editbox.editing_ended')
    public editingDidEnded: ComponentEventHandler[] = [];

    /**
     * @en
     * Event handlers invoked when the return/enter key is pressed.
     * - Not supported on Windows.
     * - Some platforms may provide sanitized text payload.
     * @example
     * edit.editingReturn.push(new ComponentEventHandler());
     *
     * @zh
     * 当用户按下回车键时触发的事件回调数组。
     * - Windows 平台不支持。
     * - 某些平台可能会提供脱敏文本负载。
     */
    @type([ComponentEventHandler])
    @serializable
    @displayOrder(14)
    @tooltip('i18n:editbox.editing_return')
    public editingReturn: ComponentEventHandler[] = [];

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _impl: EditBoxImplBase | null = null;
    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _background: Sprite | null = null;

    @serializable
    protected _textLabel: Label | null = null;
    @serializable
    protected _placeholderLabel: Label | null = null;
    @serializable
    protected  _returnType = KeyboardReturnType.DEFAULT;
    @serializable
    protected  _string = '';
    @serializable
    protected  _tabIndex = 0;
    @serializable
    protected  _backgroundImage: SpriteFrame | null = null;
    @serializable
    protected  _inputFlag = InputFlag.DEFAULT;
    @serializable
    protected  _inputMode = InputMode.ANY;
    @serializable
    protected  _maxLength = 20;

    private _isLabelVisible = false;

    constructor () {
        super();
    }

    public __preload (): void {
        this._init();
    }

    public onEnable (): void {
        if (!EDITOR_NOT_IN_PREVIEW) {
            this._registerEvent();
        }
        this._ensureBackgroundSprite();
        if (this._impl) {
            this._impl.onEnable();
        }
    }

    private _beforeDraw (): void {
        if (this._impl) {
            this._impl.beforeDraw();
        }
    }

    public onDisable (): void {
        if (!EDITOR_NOT_IN_PREVIEW) {
            this._unregisterEvent();
        }
        this._unregisterBackgroundEvent();
        if (this._impl) {
            this._impl.onDisable();
        }
    }

    public onDestroy (): void {
        director.off(DirectorEvent.BEFORE_DRAW, this._beforeDraw, this);
        if (this._impl) {
            this._impl.clear();
        }
    }

    /**
     * @en
     * Set focus to the EditBox.
     * - On platforms with a native input (Web/mobile), may trigger OS keyboard.
     * - Internally delegates to implementation via `_impl.setFocus(true)`.
     *
     * @zh
     * 让 EditBox 获得焦点。
     * - 在具备原生输入的环境（Web/移动端）可能会唤起系统键盘。
     * - 内部通过 `_impl.setFocus(true)` 委托到具体平台实现。
     * @example
     * edit.setFocus();
     */
    public setFocus (): void {
        if (this._impl) {
            this._impl.setFocus(true);
        }
    }

    /**
     * @en
     * Alias of `setFocus()`. Sets focus to the EditBox.
     *
     * @zh
     * `setFocus()` 的别名。让 EditBox 获得焦点。
     * @example
     * edit.focus();
     */
    public focus (): void {
        if (this._impl) {
            this._impl.setFocus(true);
        }
    }

    /**
     * @en
     * Remove focus from the EditBox.
     * - On platforms with a native input, hides OS keyboard.
     * - Internally delegates to implementation via `_impl.setFocus(false)`.
     *
     * @zh
     * 让 EditBox 失去焦点。
     * - 在具备原生输入的环境会收起系统键盘。
     * - 内部通过 `_impl.setFocus(false)` 委托到具体平台实现。
     * @example
     * edit.blur();
     */
    public blur (): void {
        if (this._impl) {
            this._impl.setFocus(false);
        }
    }

    /**
     * @en
     * Returns whether the EditBox currently has focus.
     * - Effective on platforms with native input (Web at present).
     * @returns `true` if focused, otherwise `false`.
     *
     * @zh
     * 返回 EditBox 当前是否处于焦点状态。
     * - 在具有原生输入的平台有效（目前为 Web）。
     * @returns 若已获得焦点返回 `true`，否则返回 `false`。
     * @example
     * if (edit.isFocused()) { // handle logic  }
     */
    public isFocused (): boolean {
        if (this._impl) {
            return this._impl.isFocused();
        }
        return false;
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _editBoxEditingDidBegan (): void {
        ComponentEventHandler.emitEvents(this.editingDidBegan, this);
        this.node.emit(EditBoxEventType.EDITING_DID_BEGAN, this);
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     * @param text content filtered by sensitive words.This parameter may be undefined.
     * If relevant platform returns desensitized content, it will be passed to developer by EventType.EDITING_DID_ENDED.
     * Now only ByteDance minigame platform
     */
    public _editBoxEditingDidEnded (text?: string): void {
        ComponentEventHandler.emitEvents(this.editingDidEnded, this);
        this.node.emit(EditBoxEventType.EDITING_DID_ENDED, this, text);
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _editBoxTextChanged (text: string): void {
        text = this._updateLabelStringStyle(text, true);
        this.string = text;
        ComponentEventHandler.emitEvents(this.textChanged, text, this);
        this.node.emit(EditBoxEventType.TEXT_CHANGED, this);
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     * @param text content filtered by sensitive words.This parameter may be undefined.
     * If relevant platform returns desensitized content, it will be passed to developer by EventType.EDITING_RETURN.
     * Now only ByteDance minigame platform
     */
    public _editBoxEditingReturn (text?: string): void {
        ComponentEventHandler.emitEvents(this.editingReturn, this);
        this.node.emit(EditBoxEventType.EDITING_RETURN, this, text);
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _showLabels (): void {
        this._isLabelVisible = true;
        this._updateLabels();
    }

    /**
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _hideLabels (): void {
        this._isLabelVisible = false;
        if (this._textLabel) {
            this._textLabel.node.active = false;
        }
        if (this._placeholderLabel) {
            this._placeholderLabel.node.active = false;
        }
    }

    protected _onTouchBegan (event: EventTouch): void {
        event.propagationStopped = true;
    }

    protected _onTouchCancel (event: EventTouch): void {
        event.propagationStopped = true;
    }

    protected _onTouchEnded (event: EventTouch): void {
        if (this._impl) {
            this._impl.beginEditing();
        }
        event.propagationStopped = true;
    }

    protected _init (): void {
        this._updatePlaceholderLabel();
        this._updateTextLabel();
        this._isLabelVisible = true;
        this.node.on(NodeEventType.SIZE_CHANGED, this._resizeChildNodes, this);
        director.on(DirectorEvent.BEFORE_DRAW, this._beforeDraw, this);

        const impl = this._impl = new EditBox._EditBoxImpl();
        impl.init(this);
        this._updateString(this._string);
        this._syncSize();
    }

    protected _ensureBackgroundSprite (): void {
        if (!this._background) {
            let background = this.node.getComponent(Sprite);
            if (!background) {
                background = this.node.addComponent(Sprite);
            }
            if (background !== this._background) {
                // init background
                background.type = Sprite.Type.SLICED;
                background.spriteFrame = this._backgroundImage;
                this._background = background;
                this._registerBackgroundEvent();
            }
        }
    }

    protected _updateTextLabel (): void {
        let textLabel = this._textLabel;

        // If textLabel doesn't exist, create one.
        if (!textLabel) {
            let node = this.node.getChildByName('TEXT_LABEL');
            if (!node) {
                node = new Node('TEXT_LABEL');
                node.layer = this.node.layer;
            }
            textLabel = node.getComponent(Label);
            if (!textLabel) {
                textLabel = node.addComponent(Label);
            }
            node.parent = this.node;
            this._textLabel = textLabel;
        }

        if (this._inputMode === InputMode.ANY) {
            textLabel.verticalAlign = VerticalTextAlignment.TOP;
            textLabel.enableWrapText = true;
        } else {
            textLabel.enableWrapText = false;
        }
        textLabel.string = this._updateLabelStringStyle(this._string);
    }

    protected _updatePlaceholderLabel (): void {
        let placeholderLabel = this._placeholderLabel;

        // If placeholderLabel doesn't exist, create one.
        if (!placeholderLabel) {
            let node = this.node.getChildByName('PLACEHOLDER_LABEL');
            if (!node) {
                node = new Node('PLACEHOLDER_LABEL');
                node.layer = this.node.layer;
            }
            placeholderLabel = node.getComponent(Label);
            if (!placeholderLabel) {
                placeholderLabel = node.addComponent(Label);
            }
            node.parent = this.node;
            this._placeholderLabel = placeholderLabel;
        }

        if (this._inputMode === InputMode.ANY) {
            placeholderLabel.enableWrapText = true;
        } else {
            placeholderLabel.enableWrapText = false;
        }
        placeholderLabel.string = this.placeholder;
    }

    protected _syncSize (): void {
        const trans = this.node._getUITransformComp()!;
        const size = trans.contentSize;

        if (this._background) {
            const bgTrans = this._background.node._getUITransformComp()!;
            bgTrans.anchorPoint = trans.anchorPoint;
            bgTrans.setContentSize(size);
        }

        this._updateLabelPosition(size);
        if (this._impl) {
            this._impl.setSize(size.width, size.height);
        }
    }

    protected _updateLabels (): void {
        if (this._isLabelVisible) {
            const content = this._string;
            if (this._textLabel) {
                this._textLabel.node.active = (content !== '');
            }
            if (this._placeholderLabel) {
                this._placeholderLabel.node.active = (content === '');
            }
        }
    }

    protected _updateString (text: string): void {
        const textLabel = this._textLabel;
        // Not inited yet
        if (!textLabel) {
            return;
        }

        let displayText = text;
        if (displayText) {
            displayText = this._updateLabelStringStyle(displayText);
        }

        textLabel.string = displayText;

        this._updateLabels();
    }

    protected _updateLabelStringStyle (text: string, ignorePassword = false): string {
        const inputFlag = this._inputFlag;
        if (!ignorePassword && inputFlag === InputFlag.PASSWORD) {
            let passwordString = '';
            const len = text.length;
            for (let i = 0; i < len; ++i) {
                passwordString += '\u25CF';
            }
            text = passwordString;
        } else if (inputFlag === InputFlag.INITIAL_CAPS_ALL_CHARACTERS) {
            text = text.toUpperCase();
        } else if (inputFlag === InputFlag.INITIAL_CAPS_WORD) {
            text = capitalize(text);
        } else if (inputFlag === InputFlag.INITIAL_CAPS_SENTENCE) {
            text = capitalizeFirstLetter(text);
        }

        return text;
    }

    protected _registerEvent (): void {
        const self = this;
        const node = self.node;
        node.on(NodeEventType.TOUCH_START, self._onTouchBegan, self);
        node.on(NodeEventType.TOUCH_END, self._onTouchEnded, self);

        if (USE_XR) {
            node.on(XrUIPressEventType.XRUI_UNCLICK, self._xrUnClick, self);
            node.on(XrKeyboardEventType.XR_KEYBOARD_INPUT, self._xrKeyBoardInput, self);
        }
    }

    protected _unregisterEvent (): void {
        const self = this;
        const node = self.node;
        node.off(NodeEventType.TOUCH_START, self._onTouchBegan, self);
        node.off(NodeEventType.TOUCH_END, self._onTouchEnded, self);

        if (USE_XR) {
            node.off(XrUIPressEventType.XRUI_UNCLICK, self._xrUnClick, self);
            node.off(XrKeyboardEventType.XR_KEYBOARD_INPUT, self._xrKeyBoardInput, self);
        }
    }

    private _onBackgroundSpriteFrameChanged (): void {
        if (!this._background) {
            return;
        }
        this.backgroundImage = this._background.spriteFrame;
    }

    private _registerBackgroundEvent (): void {
        const node = this._background && this._background.node;
        node?.on(SpriteEventType.SPRITE_FRAME_CHANGED, this._onBackgroundSpriteFrameChanged, this);
    }

    private _unregisterBackgroundEvent (): void {
        const node = this._background && this._background.node;
        node?.off(SpriteEventType.SPRITE_FRAME_CHANGED, this._onBackgroundSpriteFrameChanged, this);
    }

    protected _updateLabelPosition (size: Size): void {
        const trans = this.node._getUITransformComp()!;
        const offX = -trans.anchorX * trans.width;
        const offY = -trans.anchorY * trans.height;

        const placeholderLabel = this._placeholderLabel;
        const textLabel = this._textLabel;
        if (textLabel) {
            textLabel.node._getUITransformComp()!.setContentSize(size.width - LEFT_PADDING, size.height);
            textLabel.node.setPosition(offX + LEFT_PADDING, offY + size.height, textLabel.node.position.z);
            if (this._inputMode === InputMode.ANY) {
                textLabel.verticalAlign = VerticalTextAlignment.TOP;
            }
            textLabel.enableWrapText = this._inputMode === InputMode.ANY;
        }

        if (placeholderLabel) {
            placeholderLabel.node._getUITransformComp()!.setContentSize(size.width - LEFT_PADDING, size.height);
            placeholderLabel.node.setPosition(offX + LEFT_PADDING, offY + size.height, placeholderLabel.node.position.z);
            placeholderLabel.enableWrapText = this._inputMode === InputMode.ANY;
        }
    }

    protected _resizeChildNodes (): void {
        const trans = this.node._getUITransformComp()!;
        const textLabelNode = this._textLabel && this._textLabel.node;
        if (textLabelNode) {
            textLabelNode.setPosition(-trans.width / 2, trans.height / 2, textLabelNode.position.z);
            textLabelNode._getUITransformComp()!.setContentSize(trans.contentSize);
        }
        const placeholderLabelNode = this._placeholderLabel && this._placeholderLabel.node;
        if (placeholderLabelNode) {
            placeholderLabelNode.setPosition(-trans.width / 2, trans.height / 2, placeholderLabelNode.position.z);
            placeholderLabelNode._getUITransformComp()!.setContentSize(trans.contentSize);
        }
        const backgroundNode = this._background && this._background.node;
        if (backgroundNode) {
            backgroundNode._getUITransformComp()!.setContentSize(trans.contentSize);
        }

        this._syncSize();
    }

    protected _xrUnClick (): void {
        if (!USE_XR) return;
        this.node.emit(EditBoxEventType.XR_EDITING_DID_BEGAN, this._maxLength, this.string);
    }

    protected _xrKeyBoardInput (str: string): void {
        if (!USE_XR) return;
        this.string = str;
    }
}

// this equals to sys.isBrowser
// now we have no web-adapter yet
if (typeof window === 'object' && typeof document === 'object' && !MINIGAME && !JSB && !RUNTIME_BASED) {
    EditBox._EditBoxImpl = EditBoxImpl;
}

/**
 * @en if you don't need the EditBox and it isn't in any running Scene, you should
 * call the destroy method on this component or the associated node explicitly.
 * Otherwise, the created DOM element won't be removed from web page.
 * @zh
 * 如果你不再使用 EditBox，并且组件未添加到场景中，那么你必须手动对组件或所在节点调用 destroy。
 * 这样才能移除网页上的 DOM 节点，避免 Web 平台内存泄露。
 * @example
 * ```
 * editbox.node.parent = null;  // or  editbox.node.removeFromParent(false);
 * // when you don't need editbox anymore
 * editbox.node.destroy();
 * ```
 * @return {Boolean} whether it is the first time the destroy being called
 */

legacyCC.internal.EditBox = EditBox;
