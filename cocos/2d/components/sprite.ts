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

import { ccclass, help, executionOrder, menu, tooltip, displayOrder, type, range, editable, serializable, visible } from 'cc.decorator';
import { BUILD, EDITOR } from 'internal:constants';
import { SpriteAtlas } from '../assets/sprite-atlas';
import { SpriteFrame, SpriteFrameEvent } from '../assets/sprite-frame';
import { builtinResMgr } from '../../asset/asset-manager/builtin-res-mgr';
import { Vec2, cclegacy, ccenum, clamp, warnID } from '../../core';
import { IBatcher } from '../renderer/i-batcher';
import { UIRenderer, InstanceMaterialType } from '../framework/ui-renderer';
import { PixelFormat } from '../../asset/assets/asset-enum';
import { TextureBase } from '../../asset/assets/texture-base';
import { Material, RenderTexture } from '../../asset/assets';
import { NodeEventType } from '../../scene-graph/node-event';
import type { RenderData } from '../renderer/render-data';

/**
 * @en Enum for sprite type, which determines how the sprite is rendered in the scene.
 * @zh Sprite 类型枚举，用于决定精灵在场景中的渲染方式。
 */
export enum SpriteType {
    /**
     * @en Simple rendering type, stretches the entire sprite uniformly.
     * @zh 简单渲染类型，均匀拉伸整个精灵。
     */
    SIMPLE = 0,
    /**
     * @en Sliced rendering type (9-slice), allows non-uniform scaling of edges and center.
     * @zh 切片渲染类型（九宫格），允许边缘和中心非均匀缩放。
     */
    SLICED = 1,
    /**
     * @en Tiled rendering type, repeats the sprite in a grid pattern.
     * @zh 平铺渲染类型，在网格模式下重复精灵。
     */
    TILED = 2,
    /**
     * @en Filled rendering type, fills a portion of the sprite based on fill parameters.
     * @zh 填充渲染类型，根据填充参数填充精灵的一部分。
     */
    FILLED = 3,
    // /**
    //  * @en Mesh rendering type, composed of mesh triangles (commented out).
    //  * @zh 网格渲染类型，由网格三角形组成（已注释）。
    //  */
    // MESH: 4
}
ccenum(SpriteType);

/**
 * @en Enum for fill type, used when sprite type is FILLED to specify the filling direction or method.
 * @zh 填充类型枚举，用于精灵类型为FILLED时指定填充方向或方法。
 */
enum FillType {
    /**
     * @en Horizontal filling, fills the sprite from left to right or vice versa.
     * @zh 水平填充，从左到右填充精灵。
     */
    HORIZONTAL = 0,
    /**
     * @en Vertical filling, fills the sprite from bottom to top or vice versa.
     * @zh 垂直填充，从下到上填充精灵。
     */
    VERTICAL = 1,
    /**
     * @en Radial filling, fills the sprite in a circular pattern from the center.
     * @zh 径向填充，从中心以圆形模式填充精灵。
     */
    RADIAL = 2,
}
ccenum(FillType);

/**
 * @en Enum for sprite size mode, determines how the sprite's size adapts to its frame.
 * @zh 精灵尺寸模式枚举，决定精灵尺寸如何适应其帧。
 */
enum SizeMode {
    /**
     * @en Custom mode, uses the node's predefined size without adaptation.
     * @zh 自定义模式，使用节点预设尺寸，不进行适应。
     */
    CUSTOM = 0,
    /**
     * @en Trimmed mode, automatically matches the trimmed dimensions of the sprite frame.
     * @zh 裁剪模式，自动匹配精灵帧的裁剪后尺寸。
     */
    TRIMMED = 1,
    /**
     * @en Raw mode, automatically matches the original untrimmed dimensions of the sprite frame.
     * @zh 原始模式，自动匹配精灵帧的原始未裁剪尺寸。
     */
    RAW = 2,
}
ccenum(SizeMode);

export enum SpriteEventType {
    SPRITE_FRAME_CHANGED = 'spriteframe-changed',
}

/**
 * @en Renders a sprite in the scene, supporting various rendering types like simple, sliced, tiled, and filled.
 * This component handles sprite frames, atlases, and material configurations for 2D graphics in Cocos Creator.
 * @zh 渲染场景中的精灵，支持简单、切片、平铺和填充等多种渲染类型。
 * 该组件处理精灵帧、图集和材质配置，用于Cocos Creator中的2D图形渲染。
 */
@ccclass('cc.Sprite')
@help('i18n:cc.Sprite')
@executionOrder(110)
@menu('2D/Sprite')
export class Sprite extends UIRenderer {
    constructor () {
        super();
    }

    /**
     * @en
     * The sprite atlas where the sprite is.
     *
     * @zh
     * 精灵的图集。
     */
    @type(SpriteAtlas)
    @displayOrder(4)
    get spriteAtlas (): SpriteAtlas | null {
        return this._atlas;
    }
    set spriteAtlas (value) {
        if (this._atlas === value) {
            return;
        }
        this._atlas = value;
    }

    /**
     * @en The sprite frame used for rendering this sprite. Changing this updates the texture and size accordingly.
     * @zh 用于渲染此精灵的精灵帧。更改此属性会相应更新纹理和尺寸。
     */
    @type(SpriteFrame)
    @displayOrder(5)
    get spriteFrame (): SpriteFrame | null {
        return this._spriteFrame;
    }
    set spriteFrame (value) {
        if (this._spriteFrame === value) {
            return;
        }

        const lastSprite = this._spriteFrame;
        this._spriteFrame = value;
        this._markForUpdateRenderData();
        this._applySpriteFrame(lastSprite);
        if (EDITOR) {
            this.node.emit(SpriteEventType.SPRITE_FRAME_CHANGED, this);
        }
    }

    /**
     * @en
     * The sprite render type.
     *
     * @zh
     * 精灵渲染类型。
     *
     * @example
     * ```ts
     * import { Sprite } from 'cc';
     * sprite.type = Sprite.Type.SIMPLE;
     * ```
     */
    @type(SpriteType)
    @displayOrder(6)
    get type (): SpriteType {
        return this._type;
    }
    set type (value: SpriteType) {
        if (this._type !== value) {
            this._type = value;
            this._flushAssembler();
        }
    }

    /**
     * @en
     * The fill type, This will only have any effect if the "type" is set to “Sprite.Type.FILLED”.
     *
     * @zh
     * 精灵填充类型，仅渲染类型设置为 Sprite.Type.FILLED 时有效。
     *
     * @example
     * ```ts
     * import { Sprite } from 'cc';
     * sprite.fillType = Sprite.FillType.HORIZONTAL;
     * ```
     */
    @type(FillType)
    @displayOrder(6)
    @tooltip('i18n:sprite.fill_type')
    get fillType (): FillType {
        return this._fillType;
    }
    set fillType (value: FillType) {
        if (this._fillType !== value) {
            if (value === FillType.RADIAL || this._fillType === FillType.RADIAL) {
                this.destroyRenderData();
            } else if (this.renderData) {
                this._markForUpdateRenderData(true);
            }
        }

        this._fillType = value;
        this._flushAssembler();
    }

    /**
     * @en
     * The fill Center, This will only have any effect if the "type" is set to “Sprite.Type.FILLED”.
     *
     * @zh
     * 填充中心点，仅渲染类型设置为 Sprite.Type.FILLED 时有效。
     *
     * @example
     * ```ts
     * import { Vec2 } from 'cc';
     * sprite.fillCenter = new Vec2(0, 0);
     * ```
     */
    @displayOrder(6)
    @tooltip('i18n:sprite.fill_center')
    get fillCenter (): Vec2 {
        return this._fillCenter;
    }
    set fillCenter (value) {
        this._fillCenter.x = value.x;
        this._fillCenter.y = value.y;
        if (this._type === SpriteType.FILLED && this.renderData) {
            this._markForUpdateRenderData();
        }
    }

    /**
     * @en
     * The fill Start, This will only have any effect if the "type" is set to “Sprite.Type.FILLED”.
     *
     * @zh
     * 填充起始点，仅渲染类型设置为 Sprite.Type.FILLED 时有效。
     *
     * @example
     * ```ts
     * // -1 To 1 between the numbers
     * sprite.fillStart = 0.5;
     * ```
     */
    @range([0, 1, 0.1])
    @displayOrder(6)
    @tooltip('i18n:sprite.fill_start')
    get fillStart (): number {
        return this._fillStart;
    }

    set fillStart (value) {
        this._fillStart = clamp(value, 0, 1);
        if (this._type === SpriteType.FILLED && this.renderData) {
            this._markForUpdateRenderData();
            this._updateUVs();
        }
    }

    /**
     * @en
     * The fill Range, This will only have any effect if the "type" is set to “Sprite.Type.FILLED”.
     *
     * @zh
     * 填充范围，仅渲染类型设置为 Sprite.Type.FILLED 时有效。
     *
     * @example
     * ```ts
     * // -1 To 1 between the numbers
     * sprite.fillRange = 1;
     * ```
     */
    @range([-1, 1, 0.1])
    @displayOrder(6)
    @tooltip('i18n:sprite.fill_range')
    get fillRange (): number {
        return this._fillRange;
    }
    set fillRange (value) {
        // positive: counterclockwise, negative: clockwise
        this._fillRange = clamp(value, -1, 1);
        if (this._type === SpriteType.FILLED && this.renderData) {
            this._markForUpdateRenderData();
            this._updateUVs();
        }
    }
    /**
     * @en
     * specify the frame is trimmed or not.
     *
     * @zh
     * 是否使用裁剪模式。
     *
     * @example
     * ```ts
     * sprite.trim = true;
     * ```
     */
    @visible(function (this: Sprite) {
        return this._type === SpriteType.SIMPLE;
    })
    @displayOrder(8)
    get trim (): boolean {
        return this._isTrimmedMode;
    }

    set trim (value) {
        if (this._isTrimmedMode === value) {
            return;
        }

        this._isTrimmedMode = value;
        if ((this._type === SpriteType.SIMPLE /* || this._type === SpriteType.MESH */)
            && this.renderData) {
            this._markForUpdateRenderData(true);
        }
    }

    /**
     * @en Grayscale mode.
     * @zh 是否以灰度模式渲染。
     */
    @editable
    @displayOrder(5)
    get grayscale (): boolean {
        return this._useGrayscale;
    }
    set grayscale (value) {
        if (this._useGrayscale === value) {
            return;
        }
        this._useGrayscale = value;
        this.changeMaterialForDefine();
        this.updateMaterial();
    }

    /**
     * @en
     * Specify the size tracing mode.
     *
     * @zh
     * 精灵尺寸调整模式。
     *
     * @example
     * ```ts
     * import { Sprite } from 'cc';
     * sprite.sizeMode = Sprite.SizeMode.CUSTOM;
     * ```
     */
    @type(SizeMode)
    @displayOrder(5)
    get sizeMode (): SizeMode {
        return this._sizeMode;
    }
    set sizeMode (value) {
        if (this._sizeMode === value) {
            return;
        }

        this._sizeMode = value;
        if (value !== SizeMode.CUSTOM) {
            this._applySpriteSize();
        }
    }

    /**
     * @en Enum for fill type.
     * @zh 填充类型。
     */
    public static FillType = FillType;
    /**
     * @en Enum for sprite type.
     * @zh Sprite 类型。
     */
    public static Type = SpriteType;
    /**
     * @en Sprite's size mode, including trimmed size, raw size, and none.
     * @zh 精灵尺寸调整模式。
     */
    public static SizeMode = SizeMode;
    /**
     * @en Event types for sprite.
     * @zh sprite 的事件类型。
     */
    public static EventType = SpriteEventType;

    @serializable
    protected _spriteFrame: SpriteFrame | null = null;
    @serializable
    protected _type = SpriteType.SIMPLE;
    @serializable
    protected _fillType = FillType.HORIZONTAL;
    @serializable
    protected _sizeMode = SizeMode.TRIMMED;
    @serializable
    protected _fillCenter: Vec2 = new Vec2(0, 0);
    @serializable
    protected _fillStart = 0;
    @serializable
    protected _fillRange = 0;
    @serializable
    protected _isTrimmedMode = true;
    @serializable
    protected _useGrayscale = false;
    @serializable
    protected _atlas: SpriteAtlas | null = null;

    public __preload (): void {
        this.changeMaterialForDefine();
        super.__preload();

        if (EDITOR) {
            this._resized();
            this.node.on(NodeEventType.SIZE_CHANGED, this._resized, this);
        }
    }

    /**
     * @en Called when the component is enabled. Activates materials, updates UV coordinates,
     * and registers sprite frame event listeners for sliced sprites.
     * This ensures the sprite is properly rendered when the component becomes active.
     * @zh 当组件启用时调用。激活材质，更新UV坐标，
     * 并为切片精灵注册精灵帧事件监听器。
     * 这确保了组件激活时精灵能够正确渲染。
     */
    public onEnable (): void {
        super.onEnable();

        // Force update uv, material define, active material, etc
        this._activateMaterial();
        const spriteFrame = this._spriteFrame;
        if (spriteFrame) {
            this._updateUVs();
            if (this._type === SpriteType.SLICED) {
                spriteFrame.on(SpriteFrameEvent.UV_UPDATED, this._updateUVs, this);
            }
        }
    }

    /**
     * @en Called when the component is disabled. Cleans up sprite frame event listeners
     * to prevent memory leaks and unnecessary updates when the component is inactive.
     * @zh 当组件禁用时调用。清理精灵帧事件监听器，
     * 以防止内存泄漏和组件非活动时的不必要更新。
     */
    public onDisable (): void {
        super.onDisable();
        if (this._spriteFrame && this._type === SpriteType.SLICED) {
            this._spriteFrame.off(SpriteFrameEvent.UV_UPDATED, this._updateUVs, this);
        }
    }

    /**
     * @en Called when the component is destroyed. Removes all event listeners
     * and performs cleanup to prevent memory leaks.
     * @zh 当组件销毁时调用。移除所有事件监听器
     * 并执行清理以防止内存泄漏。
     */
    public onDestroy (): void {
        if (EDITOR) {
            this.node.off(NodeEventType.SIZE_CHANGED, this._resized, this);
        }
        super.onDestroy();
    }

    /**
     * @en
     * Quickly switch to other sprite frame in the sprite atlas.
     * If there is no atlas, the switch fails.
     *
     * @zh
     * 选取使用精灵图集中的其他精灵。
     * @param name @en Name of the spriteFrame to switch. @zh 要切换的 spriteFrame 名字。
     */
    public changeSpriteFrameFromAtlas (name: string): void {
        if (!this._atlas) {
            warnID(16377);
            return;
        }
        const sprite = this._atlas.getSpriteFrame(name);
        this.spriteFrame = sprite;
    }

    /**
     * @deprecated Since v3.7.0, this is an engine private interface that will be removed in the future.
     */
    public changeMaterialForDefine (): void {
        let texture;
        const lastInstanceMaterialType = this._instanceMaterialType;
        if (this._spriteFrame) {
            texture = this._spriteFrame.texture;
        }
        let value = false;
        if (texture instanceof TextureBase) {
            const format = texture.getPixelFormat();
            value = (format === PixelFormat.RGBA_ETC1 || format === PixelFormat.RGB_A_PVRTC_4BPPV1 || format === PixelFormat.RGB_A_PVRTC_2BPPV1);
        }

        if (value && this.grayscale) {
            this._instanceMaterialType = InstanceMaterialType.USE_ALPHA_SEPARATED_AND_GRAY;
        } else if (value) {
            this._instanceMaterialType = InstanceMaterialType.USE_ALPHA_SEPARATED;
        } else if (this.grayscale) {
            this._instanceMaterialType = InstanceMaterialType.GRAYSCALE;
        } else {
            this._instanceMaterialType = InstanceMaterialType.ADD_COLOR_AND_TEXTURE;
        }
        if (lastInstanceMaterialType !== this._instanceMaterialType) {
            this.updateMaterial();
        }
    }

    protected _updateBuiltinMaterial (): Material {
        let mat = super._updateBuiltinMaterial();
        if (this.spriteFrame && this.spriteFrame.texture instanceof RenderTexture) {
            const rtMatName = `rt-${mat.name}`;
            let rtMat = builtinResMgr.get(rtMatName) as Material | null;
            if (!rtMat) {
                rtMat = new Material(rtMatName);
                rtMat.copy(mat, { defines: { SAMPLE_FROM_RT: true } });
                builtinResMgr.addAsset(rtMatName, rtMat);
            }
            mat = rtMat;
        }
        return mat;
    }

    protected _render (render: IBatcher): void {
        render.commitComp(this, this.renderData, this._spriteFrame, this._assembler, null);
    }

    protected _canRender (): boolean {
        if (!super._canRender()) {
            return false;
        }

        const spriteFrame = this._spriteFrame;
        if (!spriteFrame || !spriteFrame.texture) {
            return false;
        }
        return true;
    }

    protected _flushAssembler (): void {
        const self = this;
        const assembler = Sprite.Assembler.getAssembler(self);

        if (self._assembler !== assembler) {
            self.destroyRenderData();
            self._assembler = assembler;
        }

        if (!self._renderData) {
            if (assembler && assembler.createData) {
                const rd = self._renderData = assembler.createData(self) as RenderData;
                rd.material = self.getRenderMaterial(0);
                self._markForUpdateRenderData();
                if (self.spriteFrame) {
                    assembler.updateUVs!(self);
                }
                self._updateColor();
            }
        }

        // Only Sliced type need update uv when sprite frame insets changed
        const spriteFrame = self._spriteFrame;
        if (spriteFrame) {
            if (self._type === SpriteType.SLICED) {
                spriteFrame.on(SpriteFrameEvent.UV_UPDATED, self._updateUVs, self);
            } else {
                spriteFrame.off(SpriteFrameEvent.UV_UPDATED, self._updateUVs, self);
            }
        }
    }

    private _applySpriteSize (): void {
        const self = this;
        const spriteFrame = self._spriteFrame;
        if (spriteFrame) {
            if (BUILD || !spriteFrame.isDefault) {
                const uiProps = self.node._uiProps;
                if (SizeMode.RAW === self._sizeMode) {
                    const size = spriteFrame.originalSize;
                    uiProps.uiTransformComp!.setContentSize(size);
                } else if (SizeMode.TRIMMED === self._sizeMode) {
                    const rect = spriteFrame.rect;
                    uiProps.uiTransformComp!.setContentSize(rect.width, rect.height);
                }
            }
        }
    }

    private _resized (): void {
        if (!EDITOR) {
            return;
        }

        if (this._spriteFrame) {
            const actualSize = this.node._getUITransformComp()!.contentSize;
            let expectedW = actualSize.width;
            let expectedH = actualSize.height;
            if (this._sizeMode === SizeMode.RAW) {
                const size = this._spriteFrame.originalSize;
                expectedW = size.width;
                expectedH = size.height;
            } else if (this._sizeMode === SizeMode.TRIMMED) {
                const rect = this._spriteFrame.rect;
                expectedW = rect.width;
                expectedH = rect.height;
            }

            if (expectedW !== actualSize.width || expectedH !== actualSize.height) {
                this._sizeMode = SizeMode.CUSTOM;
            }
        }
    }

    private _activateMaterial (): void {
        const spriteFrame = this._spriteFrame;
        const material = this.getRenderMaterial(0);
        if (spriteFrame) {
            if (material) {
                this._markForUpdateRenderData();
            }
        }

        if (this.renderData) {
            this.renderData.material = material;
        }
    }

    private _updateUVs (): void {
        if (this._assembler) {
            this._assembler.updateUVs!(this);
        }
    }

    private _applySpriteFrame (oldFrame: SpriteFrame | null): void {
        const self = this;
        const spriteFrame = self._spriteFrame;

        if (oldFrame && self._type === SpriteType.SLICED) {
            oldFrame.off(SpriteFrameEvent.UV_UPDATED, self._updateUVs, self);
        }

        let textureChanged = false;
        if (spriteFrame) {
            if (!oldFrame || oldFrame.texture !== spriteFrame.texture) {
                textureChanged = true;
            }
            if (textureChanged) {
                if (self.renderData) self.renderData.textureDirty = true;
                // texture type changed, set this._instanceMaterialType to default value
                const oldIsRT = oldFrame ? oldFrame.texture instanceof RenderTexture : false;
                const newIsRT = spriteFrame.texture instanceof RenderTexture;
                if (oldIsRT !== newIsRT) {
                    self._instanceMaterialType = -1;
                }
                self.changeMaterialForDefine();
            }
            self._applySpriteSize();
            if (self._type === SpriteType.SLICED) {
                spriteFrame.on(SpriteFrameEvent.UV_UPDATED, self._updateUVs, self);
            }
        }
    }
}

cclegacy.Sprite = Sprite;
