/* eslint-disable max-len */
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

import { ccclass, requireComponent, executeInEditMode, executionOrder, help, menu, multiline, type, displayOrder, serializable, editable } from 'cc.decorator';
import { DEBUG, DEV, EDITOR } from 'internal:constants';
import { Font, SpriteAtlas, TTFFont, SpriteFrame } from '../assets';
import { EventTouch } from '../../input/types';
import { assert, warnID, Color, Vec2, CCObjectFlags, cclegacy, js, Size } from '../../core';
import { HtmlTextParser, IHtmlTextParserResultObj, IHtmlTextParserStack } from '../utils/html-text-parser';
import { Node } from '../../scene-graph';
import { CacheMode, HorizontalTextAlignment, Label, VerticalTextAlignment } from './label';
import { Sprite } from './sprite';
import { UITransform } from '../framework';
import { Component } from '../../scene-graph/component';
import { NodeEventType } from '../../scene-graph/node-event';
import {
    BASELINE_RATIO,
    fragmentText,
    isUnicodeCJK,
    isUnicodeSpace,
    getEnglishWordPartAtFirst,
    getEnglishWordPartAtLast,
    getSymbolAt,
} from '../utils/text-utils';

const _htmlTextParser = new HtmlTextParser();
const RichTextChildName = 'RICHTEXT_CHILD';
const RichTextChildImageName = 'RICHTEXT_Image_CHILD';

const _tempSize = new Vec2();
const _tempSizeLeft = new Vec2();

/**
 * 富文本池。<br/>
 */
const labelPool = new js.Pool((seg: ISegment) => {
    if (DEV) {
        assert(!seg.node.parent, 'Recycling node\'s parent should be null!');
    }
    if (!cclegacy.isValid(seg.node)) {
        return false;
    } else {
        const label = seg.node.getComponent(Label);
        if (label) {
            label.outlineWidth = 0;
        }
    }
    return true;
}, 20);

const imagePool = new js.Pool((seg: ISegment) => {
    if (DEV) {
        assert(!seg.node.parent, 'Recycling node\'s parent should be null!');
    }
    return cclegacy.isValid(seg.node) as boolean;
}, 10);

//
function createSegment (type: string): ISegment {
    return {
        node: new Node(type),
        comp: null,
        lineCount: 0,
        styleIndex: 0,
        imageOffset: '',
        clickParam: '',
        clickHandler: '',
        type,
    };
}

function getSegmentByPool (type: string, content: string | SpriteFrame): ISegment | null {
    let seg;
    if (type === RichTextChildName) {
        seg = labelPool._get();
    } else if (type === RichTextChildImageName) {
        seg = imagePool._get();
    }
    seg = seg || createSegment(type);
    let node = seg.node as Node;
    if (!node) {
        node = new Node(type);
    }
    node.hideFlags |= CCObjectFlags.DontSave | CCObjectFlags.HideInHierarchy;
    node.active = true; // Reset node state when use node
    if (type === RichTextChildImageName) {
        seg.comp = node.getComponent(Sprite) || node.addComponent(Sprite);
        seg.comp.spriteFrame = content as SpriteFrame;
        seg.comp.type = Sprite.Type.SLICED;
        seg.comp.sizeMode = Sprite.SizeMode.CUSTOM;
    } else { // RichTextChildName
        seg.comp = node.getComponent(Label) || node.addComponent(Label);
        seg.comp.string = content as string;
        seg.comp.horizontalAlign = HorizontalTextAlignment.LEFT;
        seg.comp.verticalAlign = VerticalTextAlignment.TOP;
        seg.comp.underlineHeight = 2;
    }
    node.setPosition(0, 0, 0);
    const trans = node._getUITransformComp()!;
    trans.setAnchorPoint(0.5, 0.5);

    seg.node = node;
    seg.lineCount = 0;
    seg.styleIndex = 0;
    seg.imageOffset = '';
    seg.clickParam = '';
    seg.clickHandler = '';
    return seg as ISegment | null;
}

interface ISegment {
    node: Node;
    comp: Label | Sprite | null;
    lineCount: number;
    styleIndex: number;
    imageOffset: string;
    clickParam: string;
    clickHandler: string;
    type: string,
}

/**
 * @en
 * RichText component.
 * It parses the `string` into segments, applies styles (color, bold, italic, underline, outline, size, font),
 * performs line-breaking and alignment based on `maxWidth`, `lineHeight`, `horizontalAlign`, `verticalAlign`,
 * and composes `Label`/`Sprite` child nodes reused through internal pools for performance.
 *
 * Key behaviors:
 * - Parsing: Uses `HtmlTextParser` to convert the input into a structured segment array.
 * - Layout: Calculates line widths/heights, wraps text respecting word boundaries and CJK rules, updates positions.
 * - Caching: Reuses `Label`/`Sprite` nodes via pools; `cacheMode` applies only to system fonts.
 * - Fonts: Supports system fonts and TTF via `font`/`useSystemFont` with editor-friendly toggling.
 * - Images: `<img src="key">` resolves `SpriteFrame` from `imageAtlas`; invalid `src` is ignored.
 * - Input: When `handleTouchEvent` is true, consumes touch within bounds and can trigger click handlers on segments.
 *
 * @zh
 * RichText 组件。它会将 `string` 解析成片段，
 * 应用样式（颜色、加粗、斜体、下划线、描边、字号、字体），并依据 `maxWidth`、`lineHeight`、
 * `horizontalAlign`、`verticalAlign` 进行换行与对齐，通过内部对象池复用 `Label`/`Sprite` 子节点以提升性能。
 *
 * 主要行为：
 * - 解析：使用 `HtmlTextParser` 将输入文本转换为结构化片段数组。
 * - 排版：计算每行宽高，按词边界与 CJK(中日韩文字) 规则进行换行，更新片段位置。
 * - 缓存：通过对象池复用 `Label`/`Sprite` 节点；`cacheMode` 仅支持系统字体。
 * - 字体：支持系统字体与 TTF，结合 `font`/`useSystemFont` 进行切换，并兼容编辑器工作流。
 * - 图片：`<img src="key">` 会从 `imageAtlas` 解析 `SpriteFrame`；无效 `src` 会被忽略。
 * - 输入：当 `handleTouchEvent` 为真时，拦截边界内的触摸并可对片段触发点击回调。
 *
 * @example
 * // English: Basic colored text with image
 * richText.string = '<color=#ff0000>Hello</color> <img src="star"/> world';
 * richText.maxWidth = 300;
 * richText.horizontalAlign = RichText.HorizontalAlign.CENTER;
 *
 * // 中文：基础彩色文本并插入图片
 * richText.string = '<color=#ff0000>你好</color> <img src="star"/> 世界';
 * richText.maxWidth = 300;
 * richText.horizontalAlign = RichText.HorizontalAlign.CENTER;
 */
@ccclass('cc.RichText')
@requireComponent(UITransform)
@help('i18n:cc.RichText')
@executionOrder(110)
@menu('2D/RichText')
@executeInEditMode
export class RichText extends Component {
    /**
     * @en
     * Content string of RichText. Supports color, size, font style, underline, outline and inline image via tags.
     * Setting this property re-parses content and triggers layout update.
     * @returns {string} Current rich text source string.
     * @example
     * // English
     * richText.string = '<b>Bold</b> and <i>Italic</i> with <color=#00ff00>green</color>';
     * // 中文
     * richText.string = '<b>加粗</b>与<i>斜体</i>以及<color=#00ff00>绿色</color>';
     *
     * @zh
     * 富文本源字符串，支持颜色、字号、字体样式、下划线、描边及内联图片标签。
     * 设置该属性会重新解析文本并触发布局更新。
     */
    @multiline
    get string (): string {
        return this._string;
    }
    /**
     * @en Assign rich text content string. Triggers parse and full layout refresh.
     * @param {string} value New rich text source string.
     * @zh 设置富文本内容字符串。会重新解析并刷新完整排版。
     */
    set string (value) {
        if (this._string === value) {
            return;
        }

        this._string = value;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Horizontal alignment of each line. Impacts X offset when positioning segments.
     * Changing this property marks layout dirty and recalculates positions.
     * @returns {HorizontalTextAlignment} Current horizontal alignment.
     * @zh
     * 每行的水平对齐方式。影响片段的 X 轴偏移。变更后会标记布局为脏并重新计算位置。
     */
    @type(HorizontalTextAlignment)
    get horizontalAlign (): HorizontalTextAlignment {
        return this._horizontalAlign;
    }

    /**
     * @en Set horizontal alignment and refresh layout.
     * @param {HorizontalTextAlignment} value LEFT | CENTER | RIGHT
     * @zh 设置水平对齐并刷新布局。
     */
    set horizontalAlign (value) {
        if (this.horizontalAlign === value) {
            return;
        }

        this._horizontalAlign = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Vertical alignment applied when distributing lines within node height.
     * Affects baseline offset of the first line.
     * @returns {VerticalTextAlignment} Current vertical alignment.
     * @zh
     * 竖直对齐，用于在节点高度内分配各行位置。影响首行的基线偏移。
     */
    @type(VerticalTextAlignment)
    get verticalAlign (): VerticalTextAlignment {
        return this._verticalAlign;
    }

    /**
     * @en Set vertical alignment and mark layout dirty.
     * @param {VerticalTextAlignment} value TOP | CENTER | BOTTOM
     * @zh 设置竖直对齐并标记布局为脏。
     */
    set verticalAlign (value) {
        if (this._verticalAlign === value) {
            return;
        }

        this._verticalAlign = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Font size used for text segments without explicit size in tags.
     * Changing this triggers a reflow and text measurement update.
     * @returns {number} Current default font size in pixels.
     * @zh
     * 用于未在标签中显式指定字号的文本片段的默认字号。变更会触发重新排版与文本测量更新。
     */
    @editable
    get fontSize (): number {
        return this._fontSize;
    }

    /**
     * @en Set default font size and refresh layout.
     * @param {number} value Font size in pixels.
     * @zh 设置默认字号并刷新布局。
     */
    set fontSize (value) {
        if (this._fontSize === value) {
            return;
        }

        this._fontSize = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Default text color for segments without explicit color. Alpha cascade is not supported.
     * Changing this updates label colors immediately.
     * @returns {Color} Current default color.
     * @zh
     * 未显式指定颜色的文本片段的默认颜色。不支持颜色级联。
     */
    @type(Color)
    get fontColor (): Color {
        return this._fontColor;
    }
    /**
     * @en Set default font color and apply to existing label segments.
     * @param {Color} value Color instance.
     * @zh 设置默认文字颜色并应用到已有的标签片段。
     */
    set fontColor (value: Color) {
        if (this._fontColor === value) {
            return;
        }

        this._fontColor = value;
        this._updateTextDefaultColor();
    }

    /**
     * @en
     * System font family name when using system fonts.
     * Changing this marks layout dirty and refreshes measurement for system-font labels.
     * @returns {string} Current system font family.
     * @zh
     * 使用系统字体时的字体族名称。变更会标记布局为脏并刷新系统字体标签的测量。
     */
    @editable
    get fontFamily (): string {
        return this._fontFamily;
    }
    /**
     * @en Set system font family and refresh layout.
     * @param {string} value CSS-like font family name.
     * @zh 设置系统字体族名称并刷新布局。
     */
    set fontFamily (value: string) {
        if (this._fontFamily === value) return;
        this._fontFamily = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * TTF font asset. When set, system font is disabled and TTF metrics are used.
     * @returns {TTFFont|null} Current TTF font asset or null.
     * @zh
     * TTF 字体资源。设置后会关闭系统字体并使用 TTF。
     */
    @type(Font)
    get font (): TTFFont | null {
        return this._font;
    }
    /**
     * @en Assign TTF font. Enables TTF mode and refreshes layout; assigning null switches to system font.
     * @param {TTFFont|null} value TTF font asset or null.
     * @zh 设置 TTF 字体。启用 TTF 模式并刷新布局；设为 null 将切换为系统字体。
     */
    set font (value) {
        if (this._font === value) {
            return;
        }
        this._font = value;
        this._layoutDirty = true;
        if (this._font) {
            if (EDITOR) {
                this._userDefinedFont = this._font;
            }
            this.useSystemFont = false;
            this._onTTFLoaded();
        } else {
            this.useSystemFont = true;
        }
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Whether to use system font rendering instead of a TTF asset.
     * When enabled, `font` is ignored; when disabled and a user font exists, it will be restored in editor.
     * @returns {boolean} True if system font is in use.
     * @zh
     * 是否使用系统字体而非 TTF 资源。启用时忽略 `font`；禁用且存在用户字体时，在编辑器会恢复该字体。
     */
    @displayOrder(12)
    get useSystemFont (): boolean {
        return this._isSystemFontUsed;
    }
    /**
     * @en Toggle system font usage. Triggers layout refresh and asset switching.
     * @param {boolean} value True to use system font.
     * @zh 切换系统字体使用状态。触发布局刷新与资源切换。
     */
    set useSystemFont (value: boolean) {
        if (this._isSystemFontUsed === value) {
            return;
        }
        this._isSystemFontUsed = value;

        if (EDITOR) {
            if (value) {
                this._font = null;
            } else if (this._userDefinedFont) {
                this._font = this._userDefinedFont;
                return;
            }
        }

        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Cache mode applied to system-font labels. Controls glyph caching for performance.
     * Does not affect TTF rendering.
     * @returns {CacheMode} Current cache mode.
     * @zh
     * 系统字体标签的缓存模式，用于控制字形缓存以提升性能。不影响 TTF 渲染。
     */
    @type(CacheMode)
    get cacheMode (): CacheMode {
        return this._cacheMode;
    }
    /**
     * @en Set cache mode for system fonts and refresh text.
     * @param {CacheMode} value Cache mode enum.
     * @zh 设置系统字体的缓存模式并刷新文本。
     */
    set cacheMode (value: CacheMode) {
        if (this._cacheMode === value) {
            return;
        }
        this._cacheMode = value;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Maximum text width. When greater than 0, text wraps to new lines to fit this width.
     * @returns {number} Max content width in pixels; 0 means no wrapping.
     * @zh
     * 最大文本宽度。大于 0 时文本会按此宽度换行。返回值 0 表示不换行。
     */
    @editable
    get maxWidth (): number {
        return this._maxWidth;
    }

    /**
     * @en Set max text width and reflow content.
     * @param {number} value Width in pixels; 0 to disable wrapping.
     * @zh 设置最大文本宽度并重新排版；0 表示禁用换行限制。
     */
    set maxWidth (value) {
        if (this._maxWidth === value) {
            return;
        }

        this._maxWidth = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Line height used to place segments vertically. If not set in tags, this is the default spacing.
     * @returns {number} Current line height in pixels.
     * @zh
     * 用于竖直放置片段的行高。若标签未指定，将作为默认行距。
     */
    @editable
    get lineHeight (): number {
        return this._lineHeight;
    }

    /**
     * @en Set line height and refresh layout.
     * @param {number} value Line height in pixels.
     * @zh 设置行高并刷新布局。
     */
    set lineHeight (value) {
        if (this._lineHeight === value) {
            return;
        }

        this._lineHeight = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * Atlas used to resolve `<img src="...">` sprite frames. Each `src` must exist in this atlas.
     * @returns {SpriteAtlas|null} Current atlas; null means images are unavailable.
     * @zh
     * 解析 `<img src="...">` 的图集。每个 `src` 必须在该图集中存在。
     */
    @type(SpriteAtlas)
    get imageAtlas (): SpriteAtlas | null {
        return this._imageAtlas;
    }

    /**
     * @en Assign atlas for image tags and refresh layout.
     * @param {SpriteAtlas|null} value Atlas containing required `SpriteFrame`s.
     * @zh 设置用于图片标签的图集并刷新布局。
     */
    set imageAtlas (value) {
        if (this._imageAtlas === value) {
            return;
        }

        this._imageAtlas = value;
        this._layoutDirty = true;
        this._updateRichTextStatus();
    }

    /**
     * @en
     * When enabled, RichText captures input events inside its bounds to prevent click-through.
     * Toggles listener registration based on enabled state.
     * @returns {boolean} True if touch events are handled.
     * @zh
     * 启用后，RichText 会在其边界内捕获输入事件以防止穿透。会根据启用状态自动注册/注销监听。
     */
    @editable
    get handleTouchEvent (): boolean {
        return this._handleTouchEvent;
    }

    /**
     * @en Enable/disable touch handling. Registers/unregisters event listeners accordingly.
     * @param {boolean} value True to handle touch.
     * @zh 启用/禁用触摸事件处理。会按需注册或移除事件监听器。
     */
    set handleTouchEvent (value) {
        if (this._handleTouchEvent === value) {
            return;
        }

        this._handleTouchEvent = value;
        if (this.enabledInHierarchy) {
            if (this._handleTouchEvent) {
                this._addEventListeners();
            } else {
                this._removeEventListeners();
            }
        }
    }
    /**
     * @en
     * Enum alias for horizontal text alignment used by `RichText`.
     * Values: `LEFT`, `CENTER`, `RIGHT`.
     * @example
     * // English
     * richText.horizontalAlign = RichText.HorizontalAlign.CENTER;
     * // 中文
     * richText.horizontalAlign = RichText.HorizontalAlign.CENTER;
     * @zh
     * `RichText` 使用的横向对齐枚举别名，取值：`LEFT`、`CENTER`、`RIGHT`。
     */
    public static HorizontalAlign = HorizontalTextAlignment;
    /**
     * @en
     * Enum alias for vertical text alignment used by `RichText`.
     * Values: `TOP`, `CENTER`, `BOTTOM`.
     * @example
     * // English
     * richText.verticalAlign = RichText.VerticalAlign.BOTTOM;
     * // 中文
     * richText.verticalAlign = RichText.VerticalAlign.BOTTOM;
     * @zh
     * `RichText` 使用的纵向对齐枚举别名，取值：`TOP`、`CENTER`、`BOTTOM`。
     */
    public static VerticalAlign = VerticalTextAlignment;

    @serializable
    protected _lineHeight = 40;
    @serializable
    protected _string = '<color=#00ff00>Rich</color><color=#0fffff>Text</color>';
    // protected _updateRichTextStatus =
    @serializable
    protected _horizontalAlign = HorizontalTextAlignment.LEFT;
    @serializable
    protected _verticalAlign = VerticalTextAlignment.TOP;
    @serializable
    protected _fontSize = 40;
    @serializable
    protected _fontColor: Color = Color.WHITE.clone();
    @serializable
    protected _maxWidth = 0;
    @serializable
    protected _fontFamily = 'Arial';
    @serializable
    protected _font: TTFFont | null = null;
    @serializable
    protected _isSystemFontUsed = true;
    @serializable
    protected _userDefinedFont: TTFFont | null = null;
    @serializable
    protected _cacheMode: CacheMode = CacheMode.NONE;
    @serializable
    protected _imageAtlas: SpriteAtlas | null = null;
    @serializable
    protected _handleTouchEvent = true;

    protected _textArray: IHtmlTextParserResultObj[] = [];
    protected _segments: ISegment[] = [];
    protected _labelSegmentsCache: ISegment[] = [];
    protected _linesWidth: number[] = [];
    protected _lineCount = 1;
    protected _labelWidth = 0;
    protected _labelHeight = 0;
    protected _layoutDirty = true;
    protected _lineOffsetX = 0;
    protected declare _updateRichTextStatus: () => void;
    protected _labelChildrenNum = 0; // only ISegment

    constructor () {
        super();
        this._updateRichTextStatus = this._updateRichText;
    }

    public onLoad (): void {
        this.node.on(NodeEventType.LAYER_CHANGED, this._applyLayer, this);
        this.node.on(NodeEventType.ANCHOR_CHANGED, this._updateRichTextPosition, this);
    }

    public onEnable (): void {
        if (this.handleTouchEvent) {
            this._addEventListeners();
        }

        this._updateRichText();
        this._activateChildren(true);
    }

    public onDisable (): void {
        if (this.handleTouchEvent) {
            this._removeEventListeners();
        }

        this._activateChildren(false);
    }

    public onRestore (): void {
        if (!EDITOR) {
            return;
        }

        // TODO: refine undo/redo system
        // Because undo/redo will not call onEnable/onDisable,
        // we need call onEnable/onDisable manually to active/disactive children nodes.
        if (this.enabledInHierarchy) {
            this.onEnable();
        } else {
            this.onDisable();
        }
    }

    public onDestroy (): void {
        this._segments.forEach((seg) => {
            seg.node.removeFromParent();
            if (seg.type === RichTextChildName) {
                labelPool.put(seg);
            } else if (seg.type === RichTextChildImageName) {
                imagePool.put(seg);
            }
        });

        this.node.off(NodeEventType.ANCHOR_CHANGED, this._updateRichTextPosition, this);
        this.node.off(NodeEventType.LAYER_CHANGED, this._applyLayer, this);
    }

    protected _addEventListeners (): void {
        this.node.on(NodeEventType.TOUCH_END, this._onTouchEnded, this);
    }

    protected _removeEventListeners (): void {
        this.node.off(NodeEventType.TOUCH_END, this._onTouchEnded, this);
    }

    protected _updateLabelSegmentTextAttributes (): void {
        this._segments.forEach((item) => {
            this._applyTextAttribute(item);
        });
    }

    protected _createFontLabel (str: string): ISegment {
        return getSegmentByPool(RichTextChildName, str)!;
    }

    protected _createImage (spriteFrame: SpriteFrame): ISegment {
        return getSegmentByPool(RichTextChildImageName, spriteFrame)!;
    }

    protected _onTTFLoaded (): void {
        if (this._font instanceof TTFFont) {
            this._layoutDirty = true;
            this._updateRichText();
        } else {
            this._layoutDirty = true;
            this._updateRichText();
        }
    }

    /**
    * @engineInternal
    * @mangle
    */
    protected splitLongStringApproximatelyIn2048 (text: string, styleIndex: number): string[] {
        const approxSize = text.length * this.fontSize;
        const partStringArr: string[] = [];
        // avoid that many short richtext still execute _calculateSize so that performance is low
        // we set a threshold as 2048 * 0.8, if the estimated size is less than it, we can skip _calculateSize precisely
        if (approxSize <= 2048 * 0.8) {
            partStringArr.push(text);
            return partStringArr;
        }

        this._calculateSize(_tempSize, styleIndex, text);
        if (_tempSize.x < 2048) {
            partStringArr.push(text);
        } else {
            const multilineTexts = text.split('\n');
            for (let i = 0; i < multilineTexts.length; i++) {
                this._calculateSize(_tempSize, styleIndex, multilineTexts[i]);
                if (_tempSize.x < 2048) {
                    partStringArr.push(multilineTexts[i]);
                } else {
                    const thisPartSplitResultArr =  this.splitLongStringOver2048(multilineTexts[i], styleIndex);
                    partStringArr.push(...thisPartSplitResultArr);
                }
            }
        }
        return partStringArr;
    }

    /**
    * @engineInternal
    * @mangle
    */
    protected splitLongStringOver2048 (text: string, styleIndex: number): string[] {
        const partStringArr: string[] = [];
        const longStr = text;

        let curStart = 0;
        let curEnd = longStr.length / 2;
        let curString = longStr.substring(curStart, curEnd);
        let leftString = longStr.substring(curEnd);
        const curStringSize = this._calculateSize(_tempSize, styleIndex, curString);
        const leftStringSize = this._calculateSize(_tempSizeLeft, styleIndex, leftString);
        let maxWidth = this._maxWidth;
        if (this._maxWidth === 0) {
            maxWidth = 2047.9; // Callback when maxWidth is 0
        }

        // a line should be an unit to split long string
        const lineCountForOnePart = 1;
        const sizeForOnePart = lineCountForOnePart * maxWidth;

        // divide text into some pieces of which the size is less than sizeForOnePart
        while (curStringSize.x > sizeForOnePart) {
            curEnd /= 2;
            // at least one char can be an entity, step back.
            if (curEnd < 1) {
                curEnd *= 2;
                break;
            }

            curString = curString.substring(curStart, curEnd);
            leftString = longStr.substring(curEnd);
            this._calculateSize(curStringSize, styleIndex, curString);
        }

        // avoid too many loops
        let leftTryTimes = 1000;
        // the minimum step of expansion or reduction
        let curWordStep = 1;
        while (leftTryTimes && curStart < text.length) {
            while (leftTryTimes && curStringSize.x < sizeForOnePart) {
                const nextPartExec = getEnglishWordPartAtFirst(leftString);
                // add a character, unless there is a complete word at the beginning of the next line
                if (nextPartExec && nextPartExec.length > 0) {
                    curWordStep = nextPartExec[0].length;
                }
                curEnd += curWordStep;

                curString = longStr.substring(curStart, curEnd);
                leftString = longStr.substring(curEnd);
                this._calculateSize(curStringSize, styleIndex, curString);

                leftTryTimes--;
            }

            // reduce condition：size > maxwidth && curString.length >= 2
            while (leftTryTimes && curString.length >= 2 && curStringSize.x > sizeForOnePart) {
                curEnd -= curWordStep;
                curString = longStr.substring(curStart, curEnd);
                this._calculateSize(curStringSize, styleIndex, curString);
                // after the first reduction, the step should be 1.
                curWordStep = 1;

                leftTryTimes--;
            }

            // consider there is a part of a word at the end of this line, it should be moved to the next line
            if (curString.length >= 2) {
                const lastWordExec = getEnglishWordPartAtLast(curString);
                if (lastWordExec && lastWordExec.length > 0
                    // to avoid endless loop when there is only one word in this line
                    && curString !== lastWordExec[0]) {
                    curEnd -= lastWordExec[0].length;
                    curString = longStr.substring(curStart, curEnd);
                }
            }

            // curStart and curEnd can be float since they are like positions of pointer,
            // but step must be integer because we split the complete characters of which the unit is integer.
            // it is reasonable that using the length of this result to estimate the next result.
            partStringArr.push(curString);
            const partStep = curString.length;
            curStart = curEnd;
            curEnd += partStep;

            curString = longStr.substring(curStart, curEnd);
            leftString = longStr.substring(curEnd);
            this._calculateSize(leftStringSize, styleIndex, leftString);
            this._calculateSize(curStringSize, styleIndex, curString);

            leftTryTimes--;

            // Exit: If the left part string size is less than 2048, the method will finish.
            if (leftStringSize.x < 2048 && curStringSize.x < sizeForOnePart) {
                partStringArr.push(curString);
                curStart = text.length;
                curEnd = text.length;
                curString = leftString;
                if (leftString !== '') {
                    partStringArr.push(curString);
                }
                break;
            }
        }

        return partStringArr;
    }

    protected _measureText (styleIndex: number, string?: string): number | ((s: string) => number) {
        const func = (s: string): number => {
            const width = this._calculateSize(_tempSize, styleIndex, s).x;
            return width;
        };
        if (string) {
            return func(string);
        } else {
            return func;
        }
    }

    /**
    * @engineInternal
    * @mangle
    */
    protected _calculateSize (out: Vec2, styleIndex: number, s: string): Vec2 {
        let label: ISegment;
        if (this._labelSegmentsCache.length === 0) {
            label = this._createFontLabel(s);
            this._labelSegmentsCache.push(label);
        } else {
            label = this._labelSegmentsCache[0];
            label.node.getComponent(Label)!.string = s;
        }
        label.styleIndex = styleIndex;
        this._applyTextAttribute(label);
        const size = label.node._getUITransformComp()!.contentSize;
        Vec2.set(out, size.x, size.y);
        return out;
    }

    protected _onTouchEnded (event: EventTouch): void {
        const components = this.node.getComponents(Component);

        this._segments.forEach((seg) => {
            const clickHandler = seg.clickHandler;
            const clickParam = seg.clickParam;
            if (clickHandler && this._containsTouchLocation(seg, event.touch!.getUILocation())) {
                components.forEach((component) => {
                    const func = component[clickHandler];
                    if (component.enabledInHierarchy && func) {
                        func.call(component, event, clickParam);
                    }
                });
                event.propagationStopped = true;
            }
        });
    }

    protected _containsTouchLocation (label: ISegment, point: Vec2): boolean {
        const comp = label.node.getComponent(UITransform);
        if (!comp) {
            return false;
        }

        const myRect = comp.getBoundingBoxToWorld();
        return myRect.contains(point);
    }

    protected _resetState (): void {
        const children = this.node.children;

        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (child.name === RichTextChildName || child.name === RichTextChildImageName) {
                if (DEBUG) {
                    assert(child.parent === this.node);
                }
                child.parent = null;

                const segment = createSegment(child.name);
                segment.node = child;
                if (child.name === RichTextChildName) {
                    segment.comp = child.getComponent(Label);
                    labelPool.put(segment);
                } else {
                    segment.comp = child.getComponent(Sprite);
                    imagePool.put(segment);
                }
                this._labelChildrenNum--;
            }
        }

        this._segments.length = 0;
        this._labelSegmentsCache.length = 0;
        this._linesWidth.length = 0;
        this._lineOffsetX = 0;
        this._lineCount = 1;
        this._labelWidth = 0;
        this._labelHeight = 0;
        this._layoutDirty = true;
    }

    protected _activateChildren (active): void {
        for (let i = this.node.children.length - 1; i >= 0; i--) {
            const child = this.node.children[i];
            if (child.name === RichTextChildName || child.name === RichTextChildImageName) {
                child.active = active;
            }
        }
    }

    protected _addLabelSegment (stringToken: string, styleIndex: number): ISegment {
        let labelSegment: ISegment;
        if (this._labelSegmentsCache.length === 0) {
            labelSegment = this._createFontLabel(stringToken);
        } else {
            labelSegment = this._labelSegmentsCache.pop()!;
            const label = labelSegment.node.getComponent(Label);
            if (label) {
                label.string = stringToken;
            }
        }

        // set vertical alignments
        // because horizontal alignment is applied with line offsets in method "_updateRichTextPosition"
        const labelComp: Label = labelSegment.comp as Label;
        if (labelComp.verticalAlign !== this._verticalAlign) {
            labelComp.verticalAlign = this._verticalAlign;
        }

        labelSegment.styleIndex = styleIndex;
        labelSegment.lineCount = this._lineCount;
        labelSegment.node._getUITransformComp()!.setAnchorPoint(0, 0);
        labelSegment.node.layer = this.node.layer;
        this.node.insertChild(labelSegment.node, this._labelChildrenNum++);
        this._applyTextAttribute(labelSegment);
        this._segments.push(labelSegment);

        return labelSegment;
    }

    protected _updateRichTextWithMaxWidth (labelString: string, labelWidth: number, styleIndex: number): void {
        let fragmentWidth = labelWidth;
        let labelSegment: ISegment;

        if (this._lineOffsetX > 0 && fragmentWidth + this._lineOffsetX > this._maxWidth) {
            // concat previous line
            let checkStartIndex = 0;
            while (this._lineOffsetX <= this._maxWidth) {
                const checkEndIndex = this._getFirstWordLen(labelString, checkStartIndex, labelString.length);
                const checkString = labelString.substr(checkStartIndex, checkEndIndex);
                const checkStringWidth = this._measureText(styleIndex, checkString) as number;

                if (this._lineOffsetX + checkStringWidth <= this._maxWidth) {
                    this._lineOffsetX += checkStringWidth;
                    checkStartIndex += checkEndIndex;
                } else {
                    if (checkStartIndex > 0) {
                        const remainingString = labelString.substr(0, checkStartIndex);
                        this._addLabelSegment(remainingString, styleIndex);
                        labelString = labelString.substr(checkStartIndex, labelString.length);
                        fragmentWidth = this._measureText(styleIndex, labelString) as number;
                    }
                    this._updateLineInfo();
                    break;
                }
            }
        }
        if (fragmentWidth > this._maxWidth) {
            const fragments = fragmentText(
                labelString,
                fragmentWidth,
                this._maxWidth,
this._measureText(styleIndex) as unknown as (s: string) => number,
            );
            for (let k = 0; k < fragments.length; ++k) {
                const splitString = fragments[k];
                labelSegment = this._addLabelSegment(splitString, styleIndex);
                const labelSize = labelSegment.node._getUITransformComp()!.contentSize;
                this._lineOffsetX += labelSize.width;
                if (fragments.length > 1 && k < fragments.length - 1) {
                    this._updateLineInfo();
                }
            }
        } else {
            this._lineOffsetX += fragmentWidth;
            this._addLabelSegment(labelString, styleIndex);
        }
    }

    protected _isLastComponentCR (stringToken): boolean {
        return stringToken.length - 1 === stringToken.lastIndexOf('\n');
    }

    protected _updateLineInfo (): void {
        this._linesWidth.push(this._lineOffsetX);
        this._lineOffsetX = 0;
        this._lineCount++;
    }

    protected _needsUpdateTextLayout (newTextArray: IHtmlTextParserResultObj[]): boolean {
        if (this._layoutDirty || !this._textArray || !newTextArray) {
            return true;
        }

        if (this._textArray.length !== newTextArray.length) {
            return true;
        }

        for (let i = 0; i < this._textArray.length; i++) {
            const oldItem = this._textArray[i];
            const newItem = newTextArray[i];
            if (oldItem.text !== newItem.text) {
                return true;
            } else {
                const oldStyle = oldItem.style; const newStyle = newItem.style;
                if (oldStyle) {
                    if (newStyle) {
                        if (!!newStyle.outline !== !!oldStyle.outline) {
                            return true;
                        }
                        if (oldStyle.size !== newStyle.size
                            || oldStyle.italic !== newStyle.italic
                            || oldStyle.isImage !== newStyle.isImage) {
                            return true;
                        }
                        if (oldStyle.src !== newStyle.src
                            || oldStyle.imageAlign !== newStyle.imageAlign
                            || oldStyle.imageHeight !== newStyle.imageHeight
                            || oldStyle.imageWidth !== newStyle.imageWidth
                            || oldStyle.imageOffset !== newStyle.imageOffset) {
                            return true;
                        }
                    } else if (oldStyle.size || oldStyle.italic || oldStyle.isImage || oldStyle.outline) {
                        return true;
                    }
                } else if (newStyle) {
                    if (newStyle.size || newStyle.italic || newStyle.isImage || newStyle.outline) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    protected _addRichTextImageElement (richTextElement: IHtmlTextParserResultObj): void {
        if (!richTextElement.style) {
            return;
        }

        const style = richTextElement.style;
        const spriteFrameName = style.src;
        const spriteFrame = this._imageAtlas && spriteFrameName && this._imageAtlas.getSpriteFrame(spriteFrameName);
        if (!spriteFrame) {
            warnID(4400);
        } else {
            const segment = this._createImage(spriteFrame);
            const uiTransform = segment.node._getUITransformComp()!;
            switch (style.imageAlign) {
            case 'top':
                uiTransform.setAnchorPoint(0, 1);
                break;
            case 'center':
                uiTransform.setAnchorPoint(0, 0.5);
                break;
            default:
                uiTransform.setAnchorPoint(0, 0);
                break;
            }

            if (style.imageOffset) {
                segment.imageOffset = style.imageOffset;
            }
            segment.node.layer = this.node.layer;
            this.node.insertChild(segment.node, this._labelChildrenNum++);
            this._segments.push(segment);

            const spriteRect = spriteFrame.rect.clone();
            let scaleFactor = 1;
            let spriteWidth = spriteRect.width;
            let spriteHeight = spriteRect.height;
            const expectWidth = style.imageWidth || 0;
            const expectHeight = style.imageHeight || 0;

            if (expectHeight > 0) {
                scaleFactor = expectHeight / spriteHeight;
                spriteWidth *= scaleFactor;
                spriteHeight *= scaleFactor;
            } else {
                scaleFactor = this._lineHeight / spriteHeight;
                spriteWidth *= scaleFactor;
                spriteHeight *= scaleFactor;
            }

            if (expectWidth > 0) {
                spriteWidth = expectWidth;
            }

            if (this._maxWidth > 0) {
                if (this._lineOffsetX + spriteWidth > this._maxWidth) {
                    this._updateLineInfo();
                }
                this._lineOffsetX += spriteWidth;
            } else {
                this._lineOffsetX += spriteWidth;
                if (this._lineOffsetX > this._labelWidth) {
                    this._labelWidth = this._lineOffsetX;
                }
            }
            uiTransform.setContentSize(spriteWidth, spriteHeight);
            segment.lineCount = this._lineCount;

            segment.clickHandler = '';
            segment.clickParam = '';
            const event = style.event;
            if (event) {
                segment.clickHandler = event.click;
                segment.clickParam = event.param;
            }
        }
    }

    protected _updateTextDefaultColor (): void {
        for (let i = 0; i < this._segments.length; ++i) {
            const segment = this._segments[i];
            const label = segment.node.getComponent(Label);
            if (!label) {
                continue;
            }
            if (this._textArray[segment.styleIndex]?.style?.color) {
                continue;
            }

            label.color = this._fontColor;
        }
    }

    protected _updateRichText (): void {
        if (!this.enabledInHierarchy) {
            return;
        }

        const newTextArray = _htmlTextParser.parse(this._string);
        if (!this._needsUpdateTextLayout(newTextArray)) {
            this._textArray = newTextArray.slice();
            this._updateLabelSegmentTextAttributes();
            return;
        }

        this._textArray = newTextArray.slice();
        this._resetState();

        let lastEmptyLine = false;
        let label: ISegment;

        for (let i = 0; i < this._textArray.length; ++i) {
            const richTextElement = this._textArray[i];
            let text = richTextElement.text;
            if (text === undefined) {
                continue;
            }

            // handle <br/> <img /> tag
            if (text === '') {
                if (richTextElement.style && richTextElement.style.isNewLine) {
                    this._updateLineInfo();
                    continue;
                }
                if (richTextElement.style && richTextElement.style.isImage && this._imageAtlas) {
                    this._addRichTextImageElement(richTextElement);
                    continue;
                }
            }

            const splitArr: string[] = this.splitLongStringApproximatelyIn2048(text, i);
            text = splitArr.join('\n');

            const multilineTexts = text.split('\n');

            for (let j = 0; j < multilineTexts.length; ++j) {
                const labelString = multilineTexts[j];
                if (labelString === '') {
                    // for continues \n
                    if (this._isLastComponentCR(text) && j === multilineTexts.length - 1) {
                        continue;
                    }
                    this._updateLineInfo();
                    lastEmptyLine = true;
                    continue;
                }
                lastEmptyLine = false;

                if (this._maxWidth > 0) {
                    const labelWidth = this._measureText(i, labelString) as number;
                    this._updateRichTextWithMaxWidth(labelString, labelWidth, i);

                    if (multilineTexts.length > 1 && j < multilineTexts.length - 1) {
                        this._updateLineInfo();
                    }
                } else {
                    label = this._addLabelSegment(labelString, i);

                    this._lineOffsetX += label.node._getUITransformComp()!.width;
                    if (this._lineOffsetX > this._labelWidth) {
                        this._labelWidth = this._lineOffsetX;
                    }

                    if (multilineTexts.length > 1 && j < multilineTexts.length - 1) {
                        this._updateLineInfo();
                    }
                }
            }
        }
        if (!lastEmptyLine) {
            this._linesWidth.push(this._lineOffsetX);
        }

        if (this._maxWidth > 0) {
            this._labelWidth = this._maxWidth;
        }
        this._labelHeight = (this._lineCount + BASELINE_RATIO) * this._lineHeight;

        // trigger "size-changed" event
        this.node._getUITransformComp()!.setContentSize(this._labelWidth, this._labelHeight);

        this._updateRichTextPosition();
        this._layoutDirty = false;
    }

    protected _getFirstWordLen (text: string, startIndex: number, textLen: number): number {
        let character = getSymbolAt(text, startIndex);
        if (isUnicodeCJK(character) || isUnicodeSpace(character)) {
            return 1;
        }

        let len = 1;
        for (let index = startIndex + 1; index < textLen; ++index) {
            character = getSymbolAt(text, index);
            if (isUnicodeSpace(character) || isUnicodeCJK(character)) {
                break;
            }

            len++;
        }

        return len;
    }

    protected _updateRichTextPosition (): void {
        let nextTokenX = 0;
        let nextLineIndex = 1;
        const totalLineCount = this._lineCount;
        const trans = this.node._getUITransformComp()!;
        const anchorX = trans.anchorX;
        const anchorY = trans.anchorY;
        for (let i = 0; i < this._segments.length; ++i) {
            const segment = this._segments[i];
            const lineCount = segment.lineCount;
            if (lineCount > nextLineIndex) {
                nextTokenX = 0;
                nextLineIndex = lineCount;
            }

            let lineOffsetX = this._labelWidth * (this._horizontalAlign * 0.5 - anchorX);
            switch (this._horizontalAlign) {
            case HorizontalTextAlignment.LEFT:
                break;
            case HorizontalTextAlignment.CENTER:
                lineOffsetX -= this._linesWidth[lineCount - 1] / 2;
                break;
            case HorizontalTextAlignment.RIGHT:
                lineOffsetX -= this._linesWidth[lineCount - 1];
                break;
            default:
                break;
            }

            const segmentNode = segment.node;

            const pos = segmentNode.position;
            segmentNode.setPosition(
                nextTokenX + lineOffsetX,
                this._lineHeight * (totalLineCount - lineCount) - this._labelHeight * anchorY,
                pos.z,
            );

            if (lineCount === nextLineIndex) {
                nextTokenX += segmentNode._getUITransformComp()!.width;
            }

            const sprite = segmentNode.getComponent(Sprite);
            if (sprite) {
                const position = segmentNode.position.clone();
                // adjust img align (from <img align=top|center|bottom>)
                const lineHeightSet = this._lineHeight;
                const lineHeightReal = this._lineHeight * (1 + BASELINE_RATIO); // single line node height
                switch (segmentNode._getUITransformComp()!.anchorY) {
                case 1:
                    position.y += (lineHeightSet + ((lineHeightReal - lineHeightSet) / 2));
                    break;
                case 0.5:
                    position.y += (lineHeightReal / 2);
                    break;
                default:
                    position.y += ((lineHeightReal - lineHeightSet) / 2);
                    break;
                }
                // adjust img offset (from <img offset=12|12,34>)
                if (segment.imageOffset) {
                    const offsets = segment.imageOffset.split(',');
                    if (offsets.length === 1 && offsets[0]) {
                        const offsetY = parseFloat(offsets[0]);
                        if (Number.isInteger(offsetY)) position.y += offsetY;
                    } else if (offsets.length === 2) {
                        const offsetX = parseFloat(offsets[0]);
                        const offsetY = parseFloat(offsets[1]);
                        if (Number.isInteger(offsetX)) position.x += offsetX;
                        if (Number.isInteger(offsetY)) position.y += offsetY;
                    }
                }
                segmentNode.position = position;
            }

            // adjust y for label with outline
            const label = segmentNode.getComponent(Label);
            if (label && label.enableOutline) {
                const position = segmentNode.position.clone();
                position.y -= label.outlineWidth;
                segmentNode.position = position;
            }
        }
    }

    protected _convertLiteralColorValue (color: string): Color {
        const colorValue = color.toUpperCase();
        if (Color[colorValue]) {
            const colorUse: Color = Color[colorValue];
            return colorUse;
        } else {
            const out = new Color();
            return out.fromHEX(color);
        }
    }

    protected _applyTextAttribute (labelSeg: ISegment): void {
        const label = labelSeg.node.getComponent(Label);
        if (!label) {
            return;
        }
        this._resetLabelState(label);

        const index = labelSeg.styleIndex;

        let textStyle: IHtmlTextParserStack | undefined;
        if (this._textArray[index]) {
            textStyle = this._textArray[index].style;
        }

        if (textStyle) {
            if (textStyle.color) {
                label.color = this._convertLiteralColorValue(textStyle.color);
            } else {
                label.color = this._fontColor;
            }
            label.isBold = !!textStyle.bold;
            label.isItalic = !!textStyle.italic;
            // TODO: temporary implementation, the italic effect should be implemented in the internal of label-assembler.
            // if (textStyle.italic) {
            //     labelNode.skewX = 12;
            // }

            label.isUnderline = !!textStyle.underline;
            if (textStyle.outline) {
                label.enableOutline = true;
                label.outlineColor = this._convertLiteralColorValue(textStyle.outline.color);
                label.outlineWidth = textStyle.outline.width;
            }

            label.fontSize = textStyle.size || this._fontSize;

            labelSeg.clickHandler = '';
            labelSeg.clickParam = '';
            const event = textStyle.event;
            if (event) {
                labelSeg.clickHandler = event.click || '';
                labelSeg.clickParam = event.param || '';
            }
        }

        label.cacheMode = this._cacheMode;

        const isAsset = this._font instanceof Font;
        if (isAsset && !this._isSystemFontUsed) {
            label.font = this._font;
        } else {
            label.fontFamily = this._fontFamily;
        }
        label.useSystemFont = this._isSystemFontUsed;
        label.lineHeight = this._lineHeight;

        label.updateRenderData(true);
    }

    protected _applyLayer (): void {
        this._segments.forEach((seg) => {
            seg.node.layer = this.node.layer;
        });
    }

    protected _resetLabelState (label: Label): void {
        label.fontSize = this._fontSize;
        label.color = this._fontColor;
        label.isBold = false;
        label.isItalic = false;
        label.isUnderline = false;
    }
}

cclegacy.RichText = RichText;
