/*
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

import { ccclass, serializable, editable } from 'cc.decorator';
import { EDITOR, TEST } from 'internal:constants';
import { CCObject } from '../core/data/object';
import { assert, getError } from '../core/platform/debug';
import { RenderScene } from '../render-scene/core/render-scene';
import { Node } from './node';
import { legacyCC } from '../core/global-exports';
import { Component } from './component';
import { SceneGlobals } from './scene-globals';
import { applyTargetOverrides, expandNestedPrefabInstanceNode } from './prefab/utils';

/**
 * @en
 * Scene is a subclass of [[Node]], composed by nodes, representing the root of a runnable environment in the game.
 * It's managed by [[Director]] and user can switch from a scene to another using [[Director.loadScene]]
 * @zh
 * Scene 是 [[Node]] 的子类，由节点所构成，代表着游戏中可运行的某一个整体环境。
 * 它由 [[Director]] 管理，用户可以使用 [[Director.loadScene]] 来切换场景
 */
@ccclass('cc.Scene')
export class Scene extends Node {
    /**
     * @en The renderer scene, normally user don't need to use it
     * @zh 渲染层场景，一般情况下用户不需要关心它
     */
    get renderScene (): RenderScene | null {
        return this._renderScene;
    }

    /**
     * @en Scene-level global settings and configurations
     * @zh 场景级别的全局设置和配置
     */
    @editable
    get globals (): SceneGlobals {
        return this._globals;
    }

    /**
     * @en Indicates whether all (directly or indirectly) static referenced assets of this scene are releasable by default after scene unloading.
     * @zh 指示该场景中直接或间接静态引用到的所有资源是否默认在场景切换后自动释放。
     */
    @serializable
    @editable
    public autoReleaseAssets = false;

    /**
     * @en Per-scene level rendering info
     * @zh 场景级别的渲染信息
     *
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    @serializable
    public _globals = new SceneGlobals();

    /**
     * @en Cache for all dependent assets used for automatic release
     * @zh 用于自动释放的所有依赖资源的缓存
     */
    public dependAssets = null;

    /**
     * @en Internal render scene instance
     * @zh 内部渲染场景实例
     */
    protected _renderScene: RenderScene | null = null;

    /**
     * @en Flag indicating whether the scene has been initialized
     * @zh 标识场景是否已经初始化的标志
     */
    protected declare _inited: boolean;

    /**
     * @en Flag for prefab synchronization during live reload
     * @zh 热重载期间预制体同步的标志
     */
    protected _prefabSyncedInLiveReload = false;

    /**
     * @en Update the scene reference for this node
     * @zh 更新此节点的场景引用
     */
    protected _updateScene (): void {
        this._scene = this;
    }

    /**
     * @description Creates a new Scene instance with the specified name and initializes its core systems
     * @description 创建一个具有指定名称的新场景实例并初始化其核心系统
     *
     * @method constructor
     * @param {string} name - The name identifier for this scene / 此场景的名称标识符
     *
     * Functionality / 功能职责:
     * - Initialize scene hierarchy state / 初始化场景层级状态
     * - Create render scene instance / 创建渲染场景实例
     * - Set up scene initialization flags / 设置场景初始化标志
     * - Configure scene activation state / 配置场景激活状态
     *
     * @see Node constructor for base initialization
     * @see RenderScene for rendering pipeline integration
     *
     * @example
     * ```typescript
     * // Create a new scene
     * const gameScene = new Scene('GameLevel1');
     * _nodeActivator
     * // Scene is automatically registered with director
     * director.runScene(gameScene);
     * ```
     */
    constructor (name: string) {
        super(name);
        this._activeInHierarchy = false;
        if (legacyCC.director && legacyCC.director.root) {
            this._renderScene = legacyCC.director.root.createScene({});
        }
        this._inited = legacyCC.game ? !legacyCC.game._isCloning : true;
    }

    /**
     * @description Destroys the current scene and all its child nodes, preserving related assets
     * @description 销毁当前场景及其所有子节点，但保留相关资源
     *
     * @method destroy
     * @returns {boolean} True if destruction was successful / 如果销毁成功则返回true
     *
     * Functionality / 功能职责:
     * - Deactivate all child nodes / 停用所有子节点
     * - Destroy render scene instance / 销毁渲染场景实例
     * - Reset scene activation state / 重置场景激活状态
     * - Clean up scene hierarchy / 清理场景层级结构
     * - Preserve asset references / 保留资源引用
     *
     * @warning This method does not destroy assets, only scene nodes
     * @warning 此方法不会销毁资源，仅销毁场景节点
     *
     * @see CCObject.destroy for base destruction logic
     * @see director.destroyScene for render scene cleanup
     *
     * @example
     * ```typescript
     * // Destroy current scene
     * const success = currentScene.destroy();
     * if (success) {
     *     console.log('Scene destroyed successfully');
     * }
     * ```
     */
    public destroy (): boolean {
        const success = CCObject.prototype.destroy.call(this);
        if (success) {
            const children = this._children;
            for (let i = 0; i < children.length; ++i) {
                children[i].active = false;
            }
        }
        if (this._renderScene) legacyCC.director.root.destroyScene(this._renderScene);
        this._active = false;
        this._activeInHierarchy = false;
        return success;
    }

    /**
     * @en Only for compatibility purpose, user should not add any component to the scene
     * @zh 仅为兼容性保留，用户不应该在场景上直接添加任何组件
     */
    public addComponent(...args: any[]): Component;

    /**
     * @en Only for compatibility purpose, user should not add any component to the scene
     * @zh 仅为兼容性保留，用户不应该在场景上直接添加任何组件
     */
    public addComponent (): Component {
        throw new Error(getError(3822));
    }

    /**
     * @en Internal method for handling hierarchy changes (deprecated)
     * @zh 处理层级变化的内部方法（已废弃）
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _onHierarchyChanged (): void {
        // do nothing
    }

    /**
     * @en Internal method called after activation state changes (deprecated)
     * @zh 激活状态改变后调用的内部方法（已废弃）
     * @param active The activation state
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _onPostActivated (active: boolean): void {
        // do nothing
    }

    /**
     * @en Internal method for batch creation of child nodes (deprecated)
     * @zh 批量创建子节点的内部方法（已废弃）
     * @param dontSyncChildPrefab Whether to skip child prefab synchronization
     * @deprecated since v3.5.0, this is an engine private interface that will be removed in the future.
     */
    public _onBatchCreated (dontSyncChildPrefab: boolean): void {
        const len = this._children.length;
        for (let i = 0; i < len; ++i) {
            this._children[i]._siblingIndex = i;
            this._children[i]._onBatchCreated(dontSyncChildPrefab);
        }
    }

    /**
     * @en
     * Refer to [[Node.updateWorldTransform]]
     * @zh
     * 参考 [[Node.updateWorldTransform]]
     */
    public updateWorldTransform (): void {
        // do nothing
    }

    // life-cycle call backs

    /**
     * @en Internal method for instantiating scene nodes (not supported for Scene)
     * @zh 用于实例化场景节点的内部方法（Scene 不支持此操作）
     * @param cloned The cloned node reference
     * @param isSyncedNode Whether this is a synchronized node
     * @returns Always returns null for Scene instances
     */
    protected _instantiate (cloned?: Node | null, isSyncedNode: boolean = false): Node {
        // Can not initialize scene.
        return null as unknown as Node;
    }

    /**
     * @description Internal method to load and initialize the scene with all its components and nodes
     * @description 加载和初始化场景及其所有组件和节点的内部方法
     *
     * @method _load
     * @engineInternal
     * @mangle
     *
     * Functionality / 功能职责:
     * - Expand nested prefab instance nodes / 展开嵌套预制体实例节点
     * - Apply target overrides to nodes / 应用节点目标覆盖
     * - Batch create child nodes / 批量创建子节点
     * - Set scene reference for all nodes / 为所有节点设置场景引用
     * - Initialize scene state flags / 初始化场景状态标志
     *
     * @warning This is an internal engine method, should not be called directly
     * @warning 这是引擎内部方法，不应直接调用
     *
     * @see expandNestedPrefabInstanceNode for prefab processing
     * @see applyTargetOverrides for node override logic
     * @see Node._setScene for scene reference setup
     */
    public _load (): void {
        if (!this._inited) {
            if (TEST) {
                assert(!this._activeInHierarchy, 'Should deactivate ActionManager by default');
            }

            expandNestedPrefabInstanceNode(this);
            applyTargetOverrides(this);
            this._onBatchCreated(EDITOR && this._prefabSyncedInLiveReload);
            this._inited = true;
        }
        // static method can't use this as parameter type
        this.walk(Node._setScene);
    }

    /**
     * @description Internal method to activate or deactivate the scene and all its systems
     * @description 激活或停用场景及其所有系统的内部方法
     *
     * @method _activate
     * @param {boolean} active - Whether to activate the scene / 是否激活场景
     * @engineInternal
     * @mangle
     *
     * Functionality / 功能职责:
     * - Register/unregister nodes with editor (in editor mode) / 在编辑器中注册/注销节点
     * - Activate/deactivate node hierarchy / 激活/停用节点层级
     * - Activate scene globals and rendering systems / 激活场景全局设置和渲染系统
     * - Manage scene lifecycle state / 管理场景生命周期状态
     *
     * @warning This is an internal engine method, should not be called directly
     * @warning 这是引擎内部方法，不应直接调用
     *
     * @see director._nodeActivator for node activation logic
     * @see SceneGlobals.activate for rendering system activation
     */
    public _activate (active = true): void {
        if (EDITOR) {
            // register all nodes to editor
            // TODO: `_registerIfAttached` is injected property
            // issue: https://github.com/cocos/cocos-engine/issues/14643
            (this as any)._registerIfAttached!(active);
        }
        legacyCC.director._nodeActivator.activateNode(this, active);
        // The test environment does not currently support the renderer
        if (!TEST) {
            this._globals.activate(this);
        }
    }
}

legacyCC.Scene = Scene;
