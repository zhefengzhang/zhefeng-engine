/* eslint-disable max-len */
/*
 Copyright (c) 2019-2023 Xiamen Yaji Software Co., Ltd.

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

import { BUILD, EDITOR, PREVIEW } from 'internal:constants';
import { Asset } from '../assets/asset';
import { error, settings, path, cclegacy, EventTarget, SettingsCategory } from '../../core';
import Bundle from './bundle';
import Cache, { ICache } from './cache';
import CacheManager from './cache-manager';
import dependUtil, { DependUtil } from './depend-util';
import downloader, { Downloader } from './downloader';
import factory from './factory';
import fetch from './fetch';
import * as helper from './helper';
import load from './load';
import packManager from './pack-manager';
import parser, { Parser } from './parser';
import { Pipeline } from './pipeline';
import preprocess from './preprocess';
import { ReleaseManager, releaseManager } from './release-manager';
import RequestItem from './request-item';
import {
    presets,
    references,
    assets, BuiltinBundleName, bundles, fetchPipeline, files, parsed, pipeline, transformPipeline, assetsOverrideMap, IRequest } from './shared';

import Task from './task';
import { combine, parse, replaceOverrideAsset } from './url-transformer';
import { asyncify, parseParameters } from './utilities';

const querySettings = settings.querySettings.bind(settings);
const SETTINGS_CATEGORY_ASSETS = SettingsCategory.ASSETS;

const EVENT_ASSET_MISSING = 'asset-missing';
/**
 * @en
 * Configuration options for AssetManager initialization.
 * These options control various aspects of asset loading, downloading, and management.
 *
 * @zh
 * AssetManager 初始化配置选项。
 * 这些选项控制资源加载、下载和管理的各个方面。
 */
export interface IAssetManagerOptions {
    /**
     * @en Base path for imported assets (Editor only).
     * @zh 导入资源的基础路径（仅编辑器）。
     */
    importBase?: string;

    /**
     * @en Base path for native assets (Editor only).
     * @zh 原生资源的基础路径（仅编辑器）。
     */
    nativeBase?: string;

    /**
     * @en Maximum number of concurrent download tasks for JSB downloader (Native platforms only).
     * @zh JSB 下载器的最大并发下载任务数（仅原生平台）。
     */
    jsbDownloaderMaxTasks?: number;

    /**
     * @en Timeout duration for JSB downloader in milliseconds (Native platforms only).
     * @zh JSB 下载器的超时时间，单位毫秒（仅原生平台）。
     */
    jsbDownloaderTimeout?: number;

    /**
     * @en
     * Version information for all bundles, used for cache management and updates.
     * Key is bundle name, value is version string.
     *
     * @zh
     * 所有 bundle 的版本信息，用于缓存管理和更新。
     * 键为 bundle 名称，值为版本字符串。
     */
    bundleVers?: Record<string, string>;

    /**
     * @en
     * Remote server base URL for downloading assets.
     *
     * @zh
     * 用于下载资源的远程服务器基础 URL。
     */
    server?: string;

    /**
     * @en
     * Array of bundle names that should be treated as subpackages.
     * Subpackages are loaded on-demand to reduce initial package size.
     *
     * @zh
     * 应被视为子包的 bundle 名称数组。
     * 子包按需加载以减少初始包大小。
     */
    subpackages?: string[];

    /**
     * @en
     * Array of bundle names that should be loaded from remote server.
     * These bundles will be downloaded from the configured server URL.
     *
     * @zh
     * 应从远程服务器加载的 bundle 名称数组。
     * 这些 bundle 将从配置的服务器 URL 下载。
     */
    remoteBundles?: string[];

    /**
     * @en
     * Maximum number of concurrent downloads allowed during asset loading.
     * Higher values may improve loading speed but consume more bandwidth.
     *
     * @zh
     * 资源加载期间允许的最大并发下载数。
     * 较高的值可能提高加载速度但消耗更多带宽。
     */
    downloadMaxConcurrency?: number;
}

/**
 * @en
 * AssetManager is the core module that controls all asset-related operations including loading, caching, and releasing.
 * It provides a unified interface for asset management across different platforms and environments.
 * This is a singleton class that can be accessed via the global `assetManager` instance.
 *
 * Key features:
 * - Asset loading with multiple pipelines (normal, fetch, transform)
 * - Bundle management for modular asset organization
 * - Dependency tracking and automatic resolution
 * - Cross-platform compatibility (Web, Native, Editor)
 * - Configurable caching and downloading strategies
 *
 * @zh
 * AssetManager 是控制所有资源相关操作的核心模块，包括加载、缓存和释放。
 * 它为跨平台和环境的资源管理提供统一接口。
 * 这是一个单例类，可以通过全局 `assetManager` 实例访问。
 *
 * 主要功能：
 * - 多管线资源加载（正常、获取、转换）
 * - 模块化资源组织的 Bundle 管理
 * - 依赖跟踪和自动解析
 * - 跨平台兼容性（Web、原生、编辑器）
 * - 可配置的缓存和下载策略
 */
export class AssetManager {
    /**
     * @en
     * Normal loading pipeline. Asset manager uses this pipeline to load all assets, it has an additional asset parsing process compared to the fetchPipeline.
     *
     * @zh
     * 正常加载管线。Asset manager 使用此管线来加载所有资源，他与 fetchPipeline 相比额外多了资源的解析过程。
     */
    public pipeline: Pipeline = pipeline.append(preprocess).append(load);

    /**
     * @en
     * Fetching pipeline. Asset manager uses this pipeline to preload all assets, which lacks the asset parsing process compared to the pipeline.
     *
     * @zh
     * 下载管线。Asset manager 使用此管线来预加载所有资源，他与 pipeline 相比缺少了资源的解析过程。
     *
     */
    public fetchPipeline: Pipeline = fetchPipeline.append(preprocess).append(fetch);

    /**
     * @en
     * Url transformer. Asset manager uses this pipeline to convert the uuid, path, etc. to the path of the final file path to be loaded.
     * You can customize this pipeline to redirect the path to the path you want.
     *
     * @zh
     * Url 转换器。Asset manager 使用此管线将 uuid, 路径等信息转换为最终要加载的文件路径。你可以自定义此管线将路径重定向到你想要的路径。
     *
     */
    public transformPipeline: Pipeline = transformPipeline.append(parse).append(replaceOverrideAsset).append(combine);

    /**
     * @en
     * The collection of bundle which is already loaded, you can remove cache with [[removeBundle]].
     *
     * @zh
     * 已加载 bundle 的集合， 你能通过 [[removeBundle]] 来移除缓存。
     *
     */
    public bundles: ICache<Bundle> = bundles;

    /**
     * @en
     * The collection of asset which is already loaded, you can remove cache with [[releaseAsset]].
     *
     * @zh
     * 已加载资源的集合， 你能通过 [[releaseAsset]] 来移除缓存。
     */
    public assets: ICache<Asset> = assets;

    /**
     * @internal only using in L10N for now.
     */
    public readonly assetsOverrideMap = assetsOverrideMap;

    /**
     * @internal
     */
    public generalImportBase = '';
    /**
     * @internal
     */
    public generalNativeBase = '';

    /**
     * @en
     * Manage relationship between asset and its dependencies.
     *
     * @zh
     * 管理资源间依赖关系。
     */
    public dependUtil = dependUtil;

    /**
     * @en
     * A flag indicates whether to force loading assets and ignore errors.
     *
     * @zh
     * 是否强制加载资源标志, 如果为 true，加载资源时将会忽略错误。
     *
     */
    public force = EDITOR || PREVIEW;

    /**
     * @en
     * Whether to use image bitmap to load image first. If enabled, images loading will become faster but memory usage will increase.
     *
     * @zh
     * 是否优先使用 image bitmap 来加载图片，启用之后，图片加载速度会更快, 但内存占用会变高。
     *
     */
    public allowImageBitmap = false;

    /**
     * @en
     * Some useful functions, such as the convert function between url and uuid.
     *
     * @zh
     * 一些有用的方法, 例如 url 与 uuid 之间的转换方法。
     *
     */
    public utils = helper;

    /**
     * @en
     * The downloader used by `assetManager`.It manages all downloading tasks.
     *
     * @zh
     * `assetManager` 所使用的下载器，管理所有下载任务。
     *
     */
    public downloader = downloader;

    /**
     * @en
     * The parser used by `assetManager`.It manages all parsing tasks.
     *
     * @zh
     * `assetManager` 所使用的解析器，管理所有解析任务。
     *
     */
    public parser = parser;

    /**
     * @en
     * Manage all packed assets.
     *
     * @zh
     * 管理所有合并后的资源。
     *
     * @deprecated Since v3.7, this is an engine internal interface. You usually don't need to care about how resources are merged and split.
     */
    public packManager = packManager;

    /**
     * @en
     * Whether to cache loaded assets.
     *
     * @zh
     * 是否缓存已加载的资源。
     *
     */
    public cacheAsset = true;

    /**
     * @en
     * Cache manager is a module which controls all caches downloaded from server in non-web platform.
     *
     * @zh
     * 缓存管理器是一个模块，在非 WEB 平台上，用于管理所有从服务器上下载下来的缓存。
     *
     */
    public cacheManager: CacheManager | null = null;

    /**
     * @en
     * The preset of options.
     *
     * @zh
     * 可选参数的预设集。
     *
     */
    public presets = presets;

    /**
     * @internal
     */
    public factory = factory;

    /**
     * @en
     * Preprocessing pipeline that handles initial request processing.
     * This pipeline prepares requests for further processing by validating
     * parameters and setting up the loading context.
     *
     * @zh
     * 处理初始请求处理的预处理管线。
     * 此管线通过验证参数和设置加载上下文为进一步处理准备请求。
     *
     * @internal
     */
    public preprocessPipe = preprocess;

    /**
     * @en
     * Fetching pipeline that handles asset downloading and caching.
     * This pipeline is responsible for retrieving assets from various sources
     * including local storage, remote servers, and bundles.
     *
     * @zh
     * 处理资源下载和缓存的获取管线。
     * 此管线负责从各种来源检索资源，包括本地存储、远程服务器和 bundle。
     *
     * @internal
     */
    public fetchPipe = fetch;

    /**
     * @en
     * Loading pipeline that handles the complete asset loading process.
     * This pipeline processes assets through multiple stages including downloading,
     * parsing, and dependency resolution.
     *
     * @zh
     * 处理完整资源加载过程的加载管线。
     * 此管线通过多个阶段处理资源，包括下载、解析和依赖解析。
     *
     * @internal
     */
    public loadPipe = load;

    /**
     * @internal
     */
    public references = references;

    private _releaseManager = releaseManager;
    private _files = files;
    private _parsed = parsed;
    private _parsePipeline = BUILD ? null : new Pipeline('parse existing json', [this.loadPipe]);
    private _projectBundles: string[] = [];
    private static _instance: AssetManager;
    private _eventTarget = new EventTarget();

    /**
     * @en
     * A global singleton instance of [[AssetManager]], which you can access directly through [[assetManager]].
     *
     * @zh
     * [[AssetManager]] 的全局单例，你可以直接通过 [[assetManager]] 访问。
     */
    static get instance (): AssetManager {
        if (!this._instance) {
            this._instance = new AssetManager();
        }
        return this._instance;
    }

    private constructor () {}

    /**
     * @engineInternal
     */
    public get files (): Cache {
        return this._files;
    }

    /**
     * @engineInternal
     */
    public getReleaseManager (): ReleaseManager {
        return this._releaseManager;
    }

    /**
     * @en
     * The builtin 'main' bundle.
     *
     * @zh
     * 内置 main 包。
     */
    public get main (): Bundle | null {
        return bundles.get(BuiltinBundleName.MAIN) || null;
    }

    /**
     * @en
     * The builtin 'resources' bundle.
     *
     * @zh
     * 内置 resources 包。
     *
     */
    public get resources (): Bundle | null {
        return bundles.get(BuiltinBundleName.RESOURCES) || null;
    }

    /**
     * @en
     * Add a delegate which will be invoked when asset is missing.
     *
     * @zh
     * 添加当资源丢失时调用的委托。
     *
     * @param func - @en The missing asset delegate. @zh 资源丢失委托。
     * @param target - @en The target of the missing asset delegate, can be null. @zh 资源丢失委托的目标对象，可以为空。
     * @internal
     * @engineInternal
     */
    public onAssetMissing (func: (parentAsset: Asset, owner: any, propName: string, uuid: string) => void, target?: any): void {
        this._eventTarget.on(EVENT_ASSET_MISSING, func, target);
    }

    /**
     * @en
     * Remove the delegate when asset is missing.
     * @zh
     * 移除资源丢失时调用的委托。
     * @param func - @en The missing asset delegate. @zh 资源丢失委托。
     * @param target - @en The target of the missing asset delegate, can be null. @zh 资源丢失委托的目标对象，可以为空。
     * @internal
     * @engineInternal
     */
    public offAssetMissing (func: (parentAsset: Asset, owner: any, propName: string, uuid: string) => void, target?: any): void {
        this._eventTarget.off(EVENT_ASSET_MISSING, func, target);
    }

    /**
     * @en
     * Dispatch event when asset is missing.
     * @zh
     * 触发资源丢失时事件。
     * @param parentAsset - @en The parent asset of the missing asset. @zh 丢失的资源的父资源。
     * @param owner - @en The owner of the missing asset. @zh 丢失的资源的拥有者。
     * @param propName - @en The property name of the missing asset. @zh 丢失的资源的属性名称。
     * @param uuid - @en The uuid of the missing asset. @zh 丢失的资源的 uuid。
     * @internal
     * @engineInternal
     */
    public dispatchAssetMissing (parentAsset: Asset, owner: any, propName: string, uuid: string): void {
        this._eventTarget.emit(EVENT_ASSET_MISSING, parentAsset, owner, propName, uuid);
    }

    /**
     * @en
     * Initializes assetManager with options.
     * This method will be called automatically when the engine starts, you should not call this method manually at any time.
     *
     * @zh
     * 初始化资源管理器，引擎在启动时，将会自动调用此方法，你不应该在任何时候手动调用此方法。
     *
     * @param options @en The configuration of asset manager. @zh 资源管理器的配置选项。
     * @internal
     */
    public init (options: IAssetManagerOptions = {}): void {
        const server = options.server || querySettings(SETTINGS_CATEGORY_ASSETS, 'server') || '';
        const bundleVers = options.bundleVers || querySettings(SETTINGS_CATEGORY_ASSETS, 'bundleVers') || {};
        const remoteBundles = options.remoteBundles || querySettings(SETTINGS_CATEGORY_ASSETS, 'remoteBundles') || [];
        const downloadMaxConcurrency = options.downloadMaxConcurrency || querySettings(SETTINGS_CATEGORY_ASSETS, 'downloadMaxConcurrency');
        if (downloadMaxConcurrency && downloadMaxConcurrency > 0) {
            this.downloader.maxConcurrency = downloadMaxConcurrency;
        }

        this._files.clear();
        this._parsed.clear();
        this._releaseManager.init();
        this.assets.clear();
        this.bundles.clear();
        this.packManager.init();
        this.downloader.init(server, bundleVers, remoteBundles);
        this.parser.init();
        this.dependUtil.init();
        let importBase = options.importBase || querySettings(SETTINGS_CATEGORY_ASSETS, 'importBase') || '';
        if (importBase && importBase.endsWith('/')) {
            importBase = importBase.substring(0, importBase.length - 1);
        }
        let nativeBase = options.nativeBase || querySettings(SETTINGS_CATEGORY_ASSETS, 'nativeBase') || '';
        if (nativeBase && nativeBase.endsWith('/')) {
            nativeBase = nativeBase.substring(0, nativeBase.length - 1);
        }
        this.generalImportBase = importBase;
        this.generalNativeBase = nativeBase;
        this._projectBundles = querySettings(SETTINGS_CATEGORY_ASSETS, 'projectBundles') || [];
        const assetsOverride = querySettings(SETTINGS_CATEGORY_ASSETS, 'assetsOverrides') || {};
        for (const key in assetsOverride) {
            this.assetsOverrideMap.set(key, assetsOverride[key] as string);
        }
    }

    /**
     * @en
     * Gets the bundle which has been loaded with the name of bundle.
     *
     * @zh
     * 通过包名称获取已加载的分包。
     *
     * @param name @en The name of bundle. @zh 资源包的名称。
     * @returns @en The loaded bundle. @zh 已加载的资源包。
     *
     * @example
     * // ${project}/assets/test1
     * assetManager.getBundle('test1');
     *
     * assetManager.getBundle('resources');
     *
     */
    public getBundle (name: string): Bundle | null {
        return bundles.get(name) || null;
    }

    /**
     * @en
     * Removes this bundle. NOTE: The asset within this bundle will not be released automatically,
     * you can call [[AssetManager.Bundle.releaseAll]] manually before removing it if you need.
     *
     * @zh
     * 移除此包, 注意：这个包内的资源不会自动释放, 如果需要的话你可以在摧毁之前手动调用 [[AssetManager.Bundle.releaseAll]] 进行释放。
     *
     * @param bundle @en The bundle to be removed. @zh 准备移除的 Bundle。
     *
     */
    public removeBundle (bundle: Bundle): void {
        bundle._destroy();
        bundles.remove(bundle.name);
    }

    /**
     * @en
     * Universal asset loading interface that provides maximum flexibility for loading any type of asset.
     * This method supports multiple request formats and extensive customization through options.
     *
     * Features:
     * - Supports single or batch loading
     * - Progress tracking with detailed callbacks
     * - Customizable loading pipeline through options
     * - Automatic dependency resolution
     * - Cross-platform compatibility
     *
     * For simpler use cases, consider using specialized methods like `load`, `loadDir`, etc.
     * Custom parameters in `options` are distributed to all pipeline handlers, allowing for
     * extensive customization of the loading process.
     *
     * Reserved Keywords for additional parameters: `uuid`, `url`, `path`, `dir`, `scene`, `type`, `priority`, `preset`, `audioLoadMode`, `ext`,
     * `bundle`, `onFileProgress`, `maxConcurrency`, `maxRequestsPerFrame`, `maxRetryCount`, `version`, `xhrResponseType`,
     * `xhrWithCredentials`, `xhrMimeType`, `xhrTimeout`, `xhrHeader`, `reloadAsset`, `cacheAsset`, `cacheEnabled`,
     * Please DO NOT use these words as your own options!
     *
     * @zh
     * 通用资源加载接口，为加载任何类型的资源提供最大的灵活性。
     * 此方法支持多种请求格式，并通过选项提供广泛的自定义功能。
     *
     * 功能特性：
     * - 支持单个或批量加载
     * - 详细回调的进度跟踪
     * - 通过选项自定义加载管线
     * - 自动依赖解析
     * - 跨平台兼容性
     *
     * 对于简单的使用场景，建议使用专门的方法如 `load`、`loadDir` 等。
     * `options` 中的自定义参数会分发到所有管线处理器，允许对加载过程进行广泛自定义。
     *
     * 额外参数保留关键字: `uuid`, `url`, `path`, `dir`, `scene`, `type`, `priority`, `preset`, `audioLoadMode`, `ext`, `bundle`, `onFileProgress`,
     *  `maxConcurrency`, `maxRequestsPerFrame`, `maxRetryCount`, `version`, `xhrResponseType`, `xhrWithCredentials`, `xhrMimeType`, `xhrTimeout`, `xhrHeader`,
     *  `reloadAsset`, `cacheAsset`, `cacheEnabled`, 请不要使用这些字段为你自己的参数!
     *
     * @param requests @en Asset loading requests (string, array, or request objects). @zh 资源加载请求（字符串、数组或请求对象）。
     * @param options @en Loading configuration and custom parameters. @zh 加载配置和自定义参数。
     * @param onProgress @en Progress callback invoked during loading process. @zh 加载过程中调用的进度回调。
     * @param onProgress.finished
     * @en Number of completed loading requests.
     * @zh 已完成的加载请求数量。
     * @param onProgress.total @en Total number of requests to be loaded. @zh 待加载的请求总数。
     * @param onProgress.item @en Currently completed request item. @zh 当前完成的请求项。
     * @param onComplete @en Completion callback invoked when all assets are loaded. @zh 所有资源加载完成时调用的完成回调。
     * @param onComplete.err @en Loading error (null if successful). @zh 加载错误（成功时为 null）。
     * @param onComplete.data @en Loaded asset data (null if error occurred). @zh 已加载的资源数据（发生错误时为 null）。
     *
     * @example
     * assetManager.loadAny({url: 'http://example.com/a.png'}, (err, img) => log(img));
     * assetManager.loadAny(['60sVXiTH1D/6Aft4MRt9VC'], (err, assets) => log(assets));
     * assetManager.loadAny([{ uuid: '0cbZa5Y71CTZAccaIFluuZ'}, {url: 'http://example.com/a.png'}], (err, assets) => log(assets));
     * assetManager.downloader.register('.asset', (url, options, onComplete) => {
     *      url += '?userName=' + options.userName + "&password=" + options.password;
     *      // other logic.
     * });
     * assetManager.parser.register('.asset', (file, options, onComplete) => {
     *      var json = JSON.parse(file);
     *      var skin = json[options.skin];
     *      var model = json[options.model];
     *      onComplete(null, {skin, model});
     * });
     * assetManager.loadAny({ url: 'http://example.com/my.asset' }, { skin: 'xxx', model: 'xxx', userName: 'xxx', password: 'xxx' });
     *
     */
    public loadAny (requests: string | string[] | IRequest | Array<IRequest>, options: { [key: string]: any, preset?: string } | null, onProgress: ((finished: number, total: number, item: RequestItem) => void) | null, onComplete: ((err: Error | null, data: any) => void) | null): void;
    public loadAny (requests: string | string[] | IRequest | Array<IRequest>, onProgress: ((finished: number, total: number, item: RequestItem) => void) | null, onComplete: ((err: Error | null, data: any) => void) | null): void;
    public loadAny (requests: string | string[] | IRequest | Array<IRequest>, options: { [key: string]: any, preset?: string } | null, onComplete?: ((err: Error | null, data: any) => void) | null): void;
    public loadAny<T extends Asset> (requests: string, onComplete?: ((err: Error | null, data: T) => void) | null): void;
    public loadAny<T extends Asset> (requests: string[], onComplete?: ((err: Error | null, data: T[]) => void) | null): void;
    public loadAny (requests: string | string[] | IRequest | Array<IRequest>, onComplete?: ((err: Error | null, data: any) => void) | null): void;
    public loadAny (
        requests: string | string[] | IRequest | Array<IRequest>,
        options?: { [key: string]: any, preset?: string } | ((finished: number, total: number, item: RequestItem) => void) | ((err: Error | null, data: any) => void) | null,
        onProgress?: ((finished: number, total: number, item: RequestItem) => void) | ((err: Error | null, data: any) => void) | null,
        onComplete?: ((err: Error | null, data: any) => void) | null,
    ): void {
        const { options: opts, onProgress: onProg, onComplete: onComp } = parseParameters(options, onProgress, onComplete);
        opts.preset = opts.preset || 'default';
        requests = Array.isArray(requests) ? requests.slice() : requests;
        const task = Task.create({ input: requests, onProgress: onProg, onComplete: asyncify(onComp), options: opts });
        pipeline.async(task);
    }

    /**
     * @en
     * Universal asset preloading interface that downloads assets without parsing them.
     * This method is optimized for preparing assets in advance to reduce loading time later.
     *
     * Key differences from `loadAny`:
     * - Only downloads assets (fetch phase)
     * - Does not parse or instantiate assets
     * - Requires subsequent `loadAny` call to complete loading
     * - Ideal for background downloading and caching
     *
     * Use cases:
     * - Preloading assets for upcoming scenes
     * - Background downloading during gameplay
     * - Reducing perceived loading times
     *
     * For simpler scenarios, consider using `preloadRes`, `preloadResDir`, etc.
     *
     * @zh
     * 通用资源预加载接口，下载资源但不解析它们。
     * 此方法针对提前准备资源进行了优化，以减少后续加载时间。
     *
     * 与 `loadAny` 的主要区别：
     * - 仅下载资源（获取阶段）
     * - 不解析或实例化资源
     * - 需要后续调用 `loadAny` 来完成加载
     * - 适合后台下载和缓存
     *
     * 使用场景：
     * - 为即将到来的场景预加载资源
     * - 游戏过程中的后台下载
     * - 减少感知加载时间
     *
     * 对于简单场景，建议使用 `preloadRes`、`preloadResDir` 等。
     *
     * @param requests @en Asset preloading requests (string, array, or request objects). @zh 资源预加载请求（字符串、数组或请求对象）。
     * @param options @en Preloading configuration and custom parameters. @zh 预加载配置和自定义参数。
     * @param onProgress @en Progress callback invoked during preloading process. @zh 预加载过程中调用的进度回调。
     * @param onProgress.finished
     * @en Number of completed preloading requests.
     * @zh 已完成的预加载请求数量。
     * @param onProgress.total @en Total number of requests to be preloaded. @zh 待预加载的请求总数。
     * @param onProgress.item @en Currently completed preloading item. @zh 当前完成的预加载项。
     * @param onComplete @en Completion callback invoked when all assets are preloaded. @zh 所有资源预加载完成时调用的完成回调。
     * @param onComplete.err
     * @en Preloading error (null if successful).
     * @zh 预加载错误（成功时为 null）。
     * @param onComplete.items @en Array of preloaded request items. @zh 预加载的请求项数组。
     *
     * @example
     * assetManager.preloadAny('0cbZa5Y71CTZAccaIFluuZ', (err) => assetManager.loadAny('0cbZa5Y71CTZAccaIFluuZ'));
     *
     */
    public preloadAny (
        requests: string | string[] | IRequest | Array<IRequest>,
        options: { [key: string]: any, preset?: string } | null,
        onProgress: ((finished: number, total: number, item: RequestItem) => void) | null,
        onComplete: ((err: Error | null, data: RequestItem[]) => void)|null): void;
    public preloadAny (requests: string | string[] | IRequest | Array<IRequest>, onProgress: ((finished: number, total: number, item: RequestItem) => void) | null, onComplete: ((err: Error | null, data: RequestItem[]) => void) | null): void;
    public preloadAny (requests: string | string[] | IRequest | Array<IRequest>, options: { [key: string]: any, preset?: string } | null, onComplete?: ((err: Error | null, data: RequestItem[]) => void) | null): void;
    public preloadAny (requests: string | string[] | IRequest | Array<IRequest>, onComplete?: ((err: Error | null, data: RequestItem[]) => void) | null): void;
    public preloadAny (
        requests: string | string[] | IRequest | Array<IRequest>,
        options?: { [key: string]: any, preset?: string } | ((finished: number, total: number, item: RequestItem) => void) | ((err: Error | null, data: RequestItem[]) => void) | null,
        onProgress?: ((finished: number, total: number, item: RequestItem) => void) | ((err: Error | null, data: RequestItem[]) => void) | null,
        onComplete?: ((err: Error | null, data: RequestItem[]) => void) | null,
    ): void {
        const { options: opts, onProgress: onProg, onComplete: onComp } = parseParameters(options, onProgress, onComplete);
        opts.preset = opts.preset || 'preload';
        requests = Array.isArray(requests) ? requests.slice() : requests;
        const task = Task.create({ input: requests, onProgress: onProg, onComplete: asyncify(onComp), options: opts });
        fetchPipeline.async(task);
    }

    /**
     * @en
     * Loads remote assets from external URLs with automatic type detection.
     * This method is specifically designed for loading assets from remote servers,
     * CDNs, or any external URL source.
     *
     * Key features:
     * - Automatic asset type detection from file extension
     * - Support for various asset types (images, audio, text, etc.)
     * - Manual extension specification for URLs without extensions
     * - Automatic caching and reuse of loaded assets
     * - Cross-platform URL handling
     *
     * Important: The asset type is determined by the file extension in the URL.
     * For URLs without extensions, use the `ext` option to specify the asset type.
     *
     * @zh
     * 从外部 URL 加载远程资源，具有自动类型检测功能。
     * 此方法专门用于从远程服务器、CDN 或任何外部 URL 源加载资源。
     *
     * 主要功能：
     * - 从文件扩展名自动检测资源类型
     * - 支持各种资源类型（图像、音频、文本等）
     * - 为没有扩展名的 URL 手动指定扩展名
     * - 自动缓存和重用已加载的资源
     * - 跨平台 URL 处理
     *
     * 重要提示：资源类型由 URL 中的文件扩展名确定。
     * 对于没有扩展名的 URL，请使用 `ext` 选项指定资源类型。
     *
     * @param url @en Remote asset URL (must be a valid HTTP/HTTPS URL). @zh 远程资源 URL（必须是有效的 HTTP/HTTPS URL）。
     * @param options @en Loading configuration and optional parameters. @zh 加载配置和可选参数。
     * @param options.ext
     * @en File extension to specify asset type when URL lacks extension (e.g., '.png', '.mp3').
     * @zh 当 URL 缺少扩展名时用于指定资源类型的文件扩展名（例如 '.png'、'.mp3'）。
     * @param onComplete @en Completion callback invoked when loading finishes. @zh 加载完成时调用的完成回调。
     * @param onComplete.err @en Loading error (null if successful). @zh 加载错误（成功时为 null）。
     * @param onComplete.asset
     * @en The loaded asset instance (null if error occurred).
     * @zh 已加载的资源实例（发生错误时为 null）。
     *
     * @example
     * assetManager.loadRemote('http://www.cloud.com/test1.jpg', (err, texture) => console.log(err));
     * assetManager.loadRemote('http://www.cloud.com/test2.mp3', (err, audioClip) => console.log(err));
     * assetManager.loadRemote('http://www.cloud.com/test3', { ext: '.png' }, (err, texture) => console.log(err));
     *
     */
    public loadRemote<T extends Asset> (url: string, options: { [k: string]: any, ext?: string } | null, onComplete?: ((err: Error | null, data: T) => void) | null): void;
    public loadRemote<T extends Asset> (url: string, onComplete?: ((err: Error | null, data: T) => void) | null): void;
    public loadRemote<T extends Asset> (url: string, options?: { [k: string]: any, ext?: string } | ((err: Error | null, data: T) => void) | null, onComplete?: ((err: Error | null, data: T) => void) | null): void {
        const { options: opts, onComplete: onComp } = parseParameters<((err: Error | null, data: T) => void)>(options, undefined, onComplete);

        if (!opts.reloadAsset && this.assets.has(url)) {
            asyncify(onComp)(null, this.assets.get(url));
            return;
        }

        opts.__isNative__ = true;
        opts.preset = opts.preset || 'remote';
        this.loadAny({ url }, opts, null, (err, data): void => {
            if (err) {
                error(err.message, err.stack);
                if (onComp) { onComp(err, data as T); }
            } else {
                factory.create(url, data, (opts.ext as string) || path.extname(url), opts, (p1, p2): void => {
                    if (onComp) { onComp(p1, p2 as T); }
                });
            }
        });
    }

    /**
     * @en
     * Loads an asset bundle from a specified URL or name.
     * Asset bundles are collections of assets that can be loaded as a unit,
     * providing efficient resource management and modular content delivery.
     *
     * Key features:
     * - Support for both local and remote bundle loading
     * - Automatic bundle registration and management
     * - Progress tracking and error handling
     * - Dependency resolution for bundle assets
     * - Version control and caching support
     *
     * The bundle can be loaded from:
     * - Bundle name (for registered bundles)
     * - Absolute URL path
     * - Relative path from project root
     *
     * Note: When you load a remote bundle by name, the bundle will be cached locally after download and will continue to use that cache in future, even if
     * the version of the bundle file on your server has changed. When you need to load the latest bundle, you can pass an additional `version` parameter in the
     * optional parameters and the asset system will compare this version number with the local cache, if the comparison fails, the asset system will pull
     * the latest version of the bundle data from the server again.
     *
     * @zh
     * 从指定的 URL 或名称加载资源包。
     * 资源包是可以作为一个单元加载的资源集合，
     * 提供高效的资源管理和模块化内容交付。
     *
     * 主要功能：
     * - 支持本地和远程包加载
     * - 自动包注册和管理
     * - 进度跟踪和错误处理
     * - 包资源的依赖解析
     * - 版本控制和缓存支持
     *
     * 包可以从以下位置加载：
     * - 包名称（用于已注册的包）
     * - 绝对 URL 路径
     * - 项目根目录的相对路径
     *
     * 注意：当你用名称加载远程 bundle 时，该 bundle 在下载后将会缓存在本地并在后续持续使用该缓存，即使你服务器上的 bundle 文件版本已经发生变化。当你需要加载
     * 最新的 bundle 时，你可以在可选参数中额外传入一个 `version` 参数，资源系统将比对此版本号与本地缓存是否一致，如果比对失败，则资源系统将重新从服务器上拉取
     * 最新版本的 bundle 数据。
     *
     * @param nameOrUrl @en Bundle name (for registered bundles) or URL path. @zh 包名称（用于已注册的包）或 URL 路径。
     * @param options @en Loading configuration options (same as `loadAny`). @zh 加载配置选项（与 `loadAny` 相同）。
     * @param options.version
     * @en The version of the bundle, which you can get in the editor's build system, or directly by looking at the md5 hash value in the `config.json` path in the bundle directory after the build.
     * @zh bundle 的版本号，你可以在编辑器的构建系统中获取，或者直接查看构建后的 bundle 目录中 config.json 路径中的 md5 hash 值。
     * @param onComplete @en Completion callback invoked when bundle loading finishes. @zh 包加载完成时调用的完成回调。
     * @param onComplete.err @en Loading error (null if successful). @zh 加载错误（成功时为 null）。
     * @param onComplete.bundle
     * @en The loaded bundle instance. If there is an error in the loading process, this bundle will be null.
     * @zh 已加载的包实例。如果加载过程中出现了错误，则为 null。
     *
     * @example
     * loadBundle('myBundle', (err, bundle) => console.log(bundle));
     * loadBundle('http://localhost:8080/test', null, (err, bundle) => console.log(err));
     *
     */
    public loadBundle (nameOrUrl: string, options: { [k: string]: any, version?: string } | null, onComplete?: ((err: Error | null, data: Bundle) => void) | null): void;
    public loadBundle (nameOrUrl: string, onComplete?: ((err: Error | null, data: Bundle) => void) | null): void;
    public loadBundle (nameOrUrl: string, options?: { [k: string]: any, version?: string } | ((err: Error | null, data: Bundle) => void) | null, onComplete?: ((err: Error | null, data: Bundle) => void) | null): void {
        const { options: opts, onComplete: onComp } = parseParameters<((err: Error | null, data: Bundle) => void)>(options, undefined, onComplete);

        const bundleName = path.basename(nameOrUrl);

        if (this.bundles.has(bundleName)) {
            asyncify(onComp)(null, this.getBundle(bundleName));
            return;
        }

        opts.preset = opts.preset || 'bundle';
        opts.ext = 'bundle';
        opts.__isNative__ = true;
        this.loadAny({ url: nameOrUrl }, opts, null, (err, data): void => {
            if (err) {
                error(err.message, err.stack);
                if (onComp) { onComp(err, data as Bundle); }
            } else {
                factory.create(nameOrUrl, data, 'bundle', opts, (p1, p2): void => {
                    if (onComp) { onComp(p1, p2 as Bundle); }
                });
            }
        });
    }

    /**
     * @en
     * Releases an asset and all its dependencies from memory.
     * This method performs comprehensive cleanup by:
     * - Removing the asset from AssetManager's cache
     * - Freeing up the asset's content and GPU resources
     * - Releasing associated dependencies (textures, materials, etc.)
     * - Cleaning up native platform resources
     *
     * **CRITICAL WARNING**: This operation is irreversible and may cause visual artifacts
     * if other objects still reference the released asset. Ensure no active references
     * exist before calling this method.
     *
     * Common use cases:
     * - Memory optimization when assets are no longer needed
     * - Cleanup before loading new content
     * - Managing memory in resource-constrained environments
     *
     * Side effects:
     * - Nodes using the released asset may display incorrectly (black textures)
     * - GPU errors may occur if the asset is still being rendered
     * - Dependent assets may also be released if no other references exist
     *
     * @zh
     * 从内存中释放资源及其所有依赖项。
     * 此方法执行全面清理：
     * - 从 AssetManager 缓存中移除资源
     * - 释放资源内容和 GPU 资源
     * - 释放关联的依赖项（纹理、材质等）
     * - 清理原生平台资源
     *
     * **严重警告**：此操作不可逆，如果其他对象仍然引用已释放的资源，
     * 可能会导致视觉异常。调用此方法前请确保没有活动引用。
     *
     * 常见用例：
     * - 不再需要资源时的内存优化
     * - 加载新内容前的清理
     * - 在资源受限环境中管理内存
     *
     * 副作用：
     * - 使用已释放资源的节点可能显示不正确（黑色纹理）
     * - 如果资源仍在渲染，可能发生 GPU 错误
     * - 如果没有其他引用，依赖资源也可能被释放
     *
     * @param asset @en The asset instance to be released from memory. @zh 要从内存中释放的资源实例。
     *
     * @example
     * // release a texture which is no longer need
     * assetManager.releaseAsset(texture);
     *
     */
    public releaseAsset (asset: Asset): void {
        releaseManager.tryRelease(asset, true);
    }

    /**
     * @en
     * Releases all unused assets from memory to optimize performance.
     * This method automatically identifies and releases assets that are no longer
     * referenced by any active objects in the scene or application.
     *
     * Features:
     * - Automatic reference counting and detection
     * - Safe release of unreferenced assets only
     * - Memory optimization without affecting active content
     * - Preserves assets still in use by the application
     *
     * This is a safer alternative to `releaseAll()` as it only releases
     * assets that are confirmed to be unused.
     *
     * @zh
     * 释放所有未使用的资源以优化性能。
     * 此方法自动识别并释放不再被场景或应用程序中任何活动对象引用的资源。
     *
     * 功能特性：
     * - 自动引用计数和检测
     * - 仅安全释放未引用的资源
     * - 内存优化而不影响活动内容
     * - 保留应用程序仍在使用的资源
     *
     * 此方法是 `releaseAll()` 的更安全替代方案，因为它只释放确认未使用的资源。
     *
     * @engineInternal
     *
     */
    public releaseUnusedAssets (): void {
        assets.forEach((asset): void => {
            releaseManager.tryRelease(asset);
        });
    }

    /**
     * @en
     * Forcibly releases ALL assets from memory, regardless of their usage status.
     * This method performs a complete cleanup of the asset cache and should be used
     * with extreme caution as it can break the application if assets are still in use.
     *
     * **DANGER**: This method will release ALL assets, including those currently
     * being used by active scenes, UI elements, or other game objects.
     *
     * Use cases:
     * - Complete application reset or restart
     * - Transitioning between major game states
     * - Emergency memory cleanup in critical situations
     * - Development/debugging scenarios
     *
     * **WARNING**: After calling this method, you must ensure all references
     * to previously loaded assets are cleared and reload necessary assets.
     *
     * @zh
     * 强制释放内存中的所有资源，无论其使用状态如何。
     * 此方法执行资源缓存的完全清理，应极其谨慎使用，
     * 因为如果资源仍在使用中可能会破坏应用程序。
     *
     * **危险**：此方法将释放所有资源，包括当前正在被活动场景、
     * UI 元素或其他游戏对象使用的资源。
     *
     * 使用场景：
     * - 完整的应用程序重置或重启
     * - 主要游戏状态之间的转换
     * - 关键情况下的紧急内存清理
     * - 开发/调试场景
     *
     * **警告**：调用此方法后，必须确保清除所有对先前加载资源的引用
     * 并重新加载必要的资源。
     *
     */
    public releaseAll (): void {
        assets.forEach((asset): void => {
            releaseManager.tryRelease(asset, true);
        });
    }

    /**
     * @en
     * Loads an asset from a JSON object for internal engine usage (Editor only).
     * This method is primarily used by the editor for loading assets from serialized
     * JSON data without going through the normal file system pipeline.
     *
     * Features:
     * - Direct JSON-to-asset conversion
     * - Bypasses file system operations
     * - Supports custom asset IDs
     * - Progress tracking for complex assets
     * - Editor-only functionality
     *
     * **Note**: This method is only available in the editor environment
     * and will throw an error in build versions.
     *
     * @zh
     * 从 JSON 对象加载资源，供引擎内部使用（仅编辑器）。
     * 此方法主要由编辑器用于从序列化的 JSON 数据加载资源，
     * 而无需通过正常的文件系统管线。
     *
     * 功能特性：
     * - 直接 JSON 到资源的转换
     * - 绕过文件系统操作
     * - 支持自定义资源 ID
     * - 复杂资源的进度跟踪
     * - 仅编辑器功能
     *
     * **注意**：此方法仅在编辑器环境中可用，
     * 在构建版本中会抛出错误。
     *
     * @param json @en The JSON object containing asset data. @zh 包含资源数据的 JSON 对象。
     * @param options @en Loading options including custom asset ID. @zh 加载选项，包括自定义资源 ID。
     * @param onProgress @en Progress callback for tracking loading progress. @zh 用于跟踪加载进度的进度回调。
     * @param onComplete @en Completion callback with error and loaded asset. @zh 完成回调，包含错误和已加载的资源。
     * @internal
     */
    public loadWithJson<T extends Asset> (
        json: Record<string, any>,
        options: { [key: string]: any, assetId?: string } | null,
        onProgress: ((finished: number, total: number, item: RequestItem) => void) | null,
        onComplete: ((err: Error | null, data: T) => void) | null): void;
    public loadWithJson<T extends Asset> (json: Record<string, any>, onProgress: ((finished: number, total: number, item: RequestItem) => void) | null, onComplete: ((err: Error | null, data: T) => void) | null): void;
    public loadWithJson<T extends Asset> (json: Record<string, any>, options: { [key: string]: any, assetId?: string }, onComplete?: ((err: Error | null, data: T) => void) | null): void;
    public loadWithJson<T extends Asset> (json: Record<string, any>, onComplete?: ((err: Error | null, data: T) => void) | null): void;
    public loadWithJson<T extends Asset> (
        json: Record<string, any>,
        options?: { [key: string]: any, assetId?: string } | ((err: Error | null, data: T) => void) | null,
        onProgress?: ((finished: number, total: number, item: RequestItem) => void) | ((err: Error | null, data: T) => void) | null,
        onComplete?: ((err: Error | null, data: T) => void) | null,
    ): void {
        if (BUILD) { throw new Error('Only valid in Editor'); }

        const { options: opts, onProgress: onProg, onComplete: onComp } = parseParameters<((err: Error | null, data: T) => void)>(options, onProgress, onComplete);

        const item = RequestItem.create();
        item.isNative = false;
        item.uuid = opts.assetId || (`${new Date().getTime()}${Math.random()}`);
        item.file = json;
        item.ext = '.json';

        const task = Task.create({
            input: [item],
            onProgress: onProg,
            options: opts,
            onComplete: asyncify((err: Error | null, data: T): void => {
                if (!err) {
                    if (!opts.assetId) {
                        data._uuid = '';
                    }
                }
                if (onComp) { onComp(err, data); }
            }),
        });
        this._parsePipeline!.async(task);
    }
}

AssetManager.Pipeline = Pipeline;
AssetManager.Task = Task;
AssetManager.Cache = Cache;
AssetManager.RequestItem = RequestItem;
AssetManager.Bundle = Bundle;
AssetManager.BuiltinBundleName = BuiltinBundleName;
AssetManager.CacheManager = CacheManager;
AssetManager.Downloader = Downloader;
AssetManager.Parser = Parser;
AssetManager.DependUtil = DependUtil;

export declare namespace AssetManager {
    export { Pipeline };
    export { Task };
    export { Cache };
    export { RequestItem };
    export { Bundle };
    export { BuiltinBundleName };
    export { CacheManager };
    // Can not export interface in namespace for now.
    // export { ICache };
    // export { IAssetInfo, IPackInfo, IAddressableInfo, ISceneInfo, IRequest };
    export { DependUtil };
    export { Downloader };
    export { Parser };
}

/**
 * @en `assetManager` is a global singleton instance of [[AssetManager]].
 * The engine uses `assetManager` to manage all asset and asset bundle, including loading, releasing, etc.
 * @zh `assetManager` 为 [[AssetManager]] 的全局单例，引擎使用 `assetManager` 来完成所有资源和资源包的管理工作，包括加载，释放等。
 */
const assetManager = cclegacy.assetManager = AssetManager.instance;
export default assetManager;
cclegacy.AssetManager = AssetManager;
