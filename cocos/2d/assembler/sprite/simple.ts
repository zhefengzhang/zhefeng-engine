/*
 Copyright (c) 2017-2023 Xiamen Yaji Software Co., Ltd.

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
 * @packageDocumentation
 * @module ui-assembler
 */

import type { IAssembler } from '../../renderer/base';
import type { IRenderData, RenderData } from '../../renderer/render-data';
import type { IBatcher } from '../../renderer/i-batcher';
import type { Sprite } from '../../components';
import { dynamicAtlasManager } from '../../utils/dynamic-atlas/atlas-manager';
import type { StaticVBChunk } from '../../renderer/static-vb-accessor';

const QUAD_INDICES = Uint16Array.from([0, 1, 2, 1, 3, 2]);

/**
 * @en
 * Simple assembler, draws the basic shape of the texture, allowing uniform stretching of the graphic.
 * The usage condition is to select Type as SIMPLE for the Sprite component .
 * This assembler can be obtained via `Sprite.Assembler.getAssembler(sprite)`.
 * 
 * @zh
 * simple 组装器，绘制纹理的基本形状，允许均匀拉伸图形
 * 使用条件为 Sprite 组件选择 Type 为 SIMPLE
 * 可通过 `Sprite.Assembler.getAssembler(sprite)` 获取该组装器。
 */
class Simple implements IAssembler {
    /**
     * @en
     * Creates render data for the sprite. 
     * This method initializes the vertex buffer and index buffer
     * for rendering a quad (rectangle) shape. The render data contains 4 vertices and 6 indices
     * to form two triangles that make up the quad.
     * 
     * @zh
     * 为精灵创建渲染数据。
     * 此方法初始化用于渲染四边形（矩形）形状的顶点缓冲区和索引缓冲区。
     * 渲染数据包含4个顶点和6个索引，用于构成组成四边形的两个三角形。
     * 
     * @param sprite - @en The sprite component to create render data for
     *                @zh 要为其创建渲染数据的精灵组件
     * 
     * @returns @en The created render data object containing vertex and index buffers
     *          @zh 创建的渲染数据对象，包含顶点和索引缓冲区
     */
    createData (sprite: Sprite): RenderData {
        const renderData = sprite.requestRenderData();
        renderData.dataLength = 4;
        renderData.resize(4, 6);
        renderData.chunk.setIndexBuffer(QUAD_INDICES);
        return renderData;
    }

    /**
     * @en
     * Updates the render data for the sprite. 
     * This method handles the complete update process
     * including packing to dynamic atlas, updating UV coordinates, and refreshing vertex data when necessary. 
     * It's called automatically when the sprite's properties change.
     * 
     * @zh
     * 更新精灵的渲染数据。
     * 此方法处理完整的更新过程，包括打包到动态图集、更新UV坐标以及在必要时刷新顶点数据。
     * 当精灵的属性发生变化时自动调用。
     * 
     * @param sprite - @en The sprite component to update render data for
     *                @zh 要为其更新渲染数据的精灵组件
     */
    updateRenderData (sprite: Sprite): void {
        const frame = sprite.spriteFrame;

        dynamicAtlasManager.packToDynamicAtlas(sprite, frame);
        this.updateUVs(sprite);// dirty need
        //this.updateColor(sprite);// dirty need

        const renderData = sprite.renderData;
        if (renderData && frame) {
            if (renderData.vertDirty) {
                this.updateVertexData(sprite);
            }
            renderData.updateRenderData(sprite, frame);
        }
    }

    private updateWorldVerts (sprite: Sprite, chunk: StaticVBChunk): void {
        const renderData = sprite.renderData;
        if (!renderData) return;
        const vData = chunk.vb;

        const dataList: IRenderData[] = renderData.data;
        const node = sprite.node;
        const m = node.worldMatrix;

        const m00 = m.m00; const m01 = m.m01; const m02 = m.m02; const m03 = m.m03;
        const m04 = m.m04; const m05 = m.m05; const m06 = m.m06; const m07 = m.m07;
        const m12 = m.m12; const m13 = m.m13; const m14 = m.m14; const m15 = m.m15;

        const stride = renderData.floatStride;
        let offset = 0;
        const length = dataList.length;
        for (let i = 0; i < length; ++i) {
            const curData = dataList[i];
            const x = curData.x;
            const y = curData.y;
            let rhw = m03 * x + m07 * y + m15;
            rhw = rhw ? 1 / rhw : 1;

            offset = i * stride;
            vData[offset + 0] = (m00 * x + m04 * y + m12) * rhw;
            vData[offset + 1] = (m01 * x + m05 * y + m13) * rhw;
            vData[offset + 2] = (m02 * x + m06 * y + m14) * rhw;
        }
    }

    /**
     * @en
     * Fills the vertex and index buffers with sprite data for rendering. This method is called
     * during the rendering process to populate the GPU buffers with the current sprite geometry.
     * It handles both vertex transformation and index buffer population using an optimized approach.
     * 
     * @zh
     * 使用精灵数据填充顶点和索引缓冲区以进行渲染。此方法在渲染过程中调用，
     * 用于将当前精灵几何数据填充到GPU缓冲区。它使用优化的方法处理顶点变换和索引缓冲区填充。
     * 
     * @param sprite - @en The sprite component to fill buffers for
     *                @zh 要为其填充缓冲区的精灵组件
     * @param renderer - @en The batcher renderer that manages the rendering process
     *                  @zh 管理渲染过程的批处理渲染器
     */
    fillBuffers (sprite: Sprite, renderer: IBatcher): void {
        if (sprite === null) {
            return;
        }

        const renderData = sprite.renderData;
        if (!renderData) return;
        const chunk = renderData.chunk;
        if (sprite._flagChangedVersion !== sprite.node.flagChangedVersion || renderData.vertDirty) {
            // const vb = chunk.vertexAccessor.getVertexBuffer(chunk.bufferId);
            this.updateWorldVerts(sprite, chunk);
            renderData.vertDirty = false;
            sprite._flagChangedVersion = sprite.node.flagChangedVersion;
        }

        // quick version
        const vidOrigin = chunk.vertexOffset;
        const meshBuffer = chunk.meshBuffer;
        const ib = chunk.meshBuffer.iData;
        let indexOffset = meshBuffer.indexOffset;

        const vid = vidOrigin;

        // left bottom
        ib[indexOffset++] = vid;
        // right bottom
        ib[indexOffset++] = vid + 1;
        // left top
        ib[indexOffset++] = vid + 2;

        // right bottom
        ib[indexOffset++] = vid + 1;
        // right top
        ib[indexOffset++] = vid + 3;
        // left top
        ib[indexOffset++] = vid + 2;

        // IndexOffset should add 6 when vertices of a rect are visited.
        meshBuffer.indexOffset += 6;
        // slow version
        // renderer.switchBufferAccessor().appendIndices(chunk);
    }

    private updateVertexData (sprite: Sprite): void {
        const renderData: RenderData | null = sprite.renderData;
        if (!renderData) {
            return;
        }

        const uiTrans = sprite.node._getUITransformComp()!;
        const dataList: IRenderData[] = renderData.data;
        const cw = uiTrans.width;
        const ch = uiTrans.height;
        const appX = uiTrans.anchorX * cw;
        const appY = uiTrans.anchorY * ch;
        let l = 0;
        let b = 0;
        let r = 0;
        let t = 0;
        if (sprite.trim) {
            l = -appX;
            b = -appY;
            r = cw - appX;
            t = ch - appY;
        } else {
            const frame = sprite.spriteFrame!;
            const originSize = frame.originalSize;
            const ow = originSize.width;
            const oh = originSize.height;
            const scaleX = cw / ow;
            const scaleY = ch / oh;
            const trimmedBorder = frame.trimmedBorder;
            l = trimmedBorder.x * scaleX - appX;
            b = trimmedBorder.z * scaleY - appY;
            r = cw + trimmedBorder.y * scaleX - appX;
            t = ch + trimmedBorder.w * scaleY - appY;
        }

        dataList[0].x = l;
        dataList[0].y = b;

        dataList[1].x = r;
        dataList[1].y = b;

        dataList[2].x = l;
        dataList[2].y = t;

        dataList[3].x = r;
        dataList[3].y = t;

        renderData.vertDirty = true;
    }

    /**
     * @en
     * Updates the UV coordinates in the vertex buffer based on the sprite frame's texture coordinates.
     * UV coordinates define how the texture is mapped onto the sprite geometry.
     * This method is called automatically when the sprite frame changes.
     * 
     * @zh
     * 根据精灵帧的纹理坐标更新顶点缓冲区中的UV坐标。
     * UV坐标定义了纹理如何映射到精灵几何体上。
     * 当精灵帧发生变化时自动调用此方法。
     * 
     * @param sprite - @en The sprite component to update UV coordinates for
     *                @zh 要为其更新UV坐标的精灵组件
     */
    updateUVs (sprite: Sprite): void {
        const renderData = sprite.renderData;
        if (!sprite.spriteFrame || !renderData) return;
        const vData = renderData.chunk.vb;
        const uv = sprite.spriteFrame.uv;
        const stride = renderData.floatStride;
        let uvOffset = 3;
        for (let i = 0; i < renderData.dataLength; ++i) {
            const index = i * 2;
            vData[uvOffset] = uv[index];
            vData[uvOffset + 1] = uv[index + 1];
            uvOffset += stride;
        }
    }

    /**
     * @en
     * Updates the color values in the vertex buffer based on the sprite's color property.
     * This method converts the sprite's RGBA color values (0-255 range) to normalized
     * values (0.0-1.0 range) and stores them in the vertex buffer for all 4 vertices.
     * This method is automatically called when the color property of the Sprite component is modified.
     * 
     * @zh
     * 根据精灵的颜色属性更新顶点缓冲区中的颜色值。
     * 此方法将精灵的RGBA颜色值（0-255范围）转换为归一化值（0.0-1.0范围）
     * 并将其存储在顶点缓冲区中的所有4个顶点中。
     * 修改 Sprite 组件的 color 属性时自动调用此方法。
     * 
     * @param sprite - @en The sprite component to update color values for
     *                @zh 要为其更新颜色值的精灵组件
     */
    updateColor (sprite: Sprite): void {
        const renderData = sprite.renderData;
        if (!renderData) return;
        const vData = renderData.chunk.vb;
        let colorOffset = 5;
        const color = sprite.color;
        const colorR = color.r / 255;
        const colorG = color.g / 255;
        const colorB = color.b / 255;
        const colorA = color.a / 255;
        for (let i = 0; i < 4; i++, colorOffset += renderData.floatStride) {
            vData[colorOffset] = colorR;
            vData[colorOffset + 1] = colorG;
            vData[colorOffset + 2] = colorB;
            vData[colorOffset + 3] = colorA;
        }
    }
}

export const simple = new Simple();
