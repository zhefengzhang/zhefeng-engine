// // jszip version 3.10.1
import downloader from './downloader';
import { JSZip }  from '../../core/ziplib/jszip';
const ZipCache = new Map<string, any>();
const ResCache = new Map<string, any>();
const ResCacheJsonVersion = new Map<string, number>();

export class ZipLoader {
    static _ins: ZipLoader;
    loadFinishZips: string[] = [];
    builtinBundles: string[] = ["internal", "main"];
    static get ins() {
        if (!JSZip) return false;
        if (!this._ins) {
            this._ins = new ZipLoader();
        }
        return this._ins;
    }

    constructor() {
        this.init();
    }

    static downloadZip(path: string) {
        return new Promise((resolve)=>{
            downloader.downloadFile(path + '.zip',
            {xhrResponseType: 'arraybuffer'},
            null,
            (err, data)=>{
                resolve(data);
            });
        });
    }

    async loadZip(path: string) {
        const jsZip = new JSZip();
        const zipBuffer = await ZipLoader.downloadZip(path);
        const zipFile = await jsZip.loadAsync(zipBuffer as any);
        zipFile.forEach((v, t) => {
            if (t.dir) return;
            ZipCache.set(path + "/" + v, t);
        });
    }

    init () {
        const accessor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
        Object.defineProperty(XMLHttpRequest.prototype, 'response', {
            get: function () {
                if (this.ZipCacheUrl) {
                    return ResCache.get(this.ZipCacheUrl);
                }
                //@ts-ignore
                return accessor.get.call(this);
            },
            set: function (str) {

            },
            configurable: true,
        });

        // 拦截open
        const oldOpen = XMLHttpRequest.prototype.open;
        // @ts-ignore
        XMLHttpRequest.prototype.open = function (method, url: string, async, user, password) {

            if (ZipCache.has(url as string)) {
                this.ZipCacheUrl = url;
            }
            //@ts-ignore
            return oldOpen.apply(this, arguments);
        };

        // 拦截send
        const oldSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = async function (data) {
            if (this.ZipCacheUrl) {
                if (!ResCache.has(this.ZipCacheUrl)) {
                    const cache = ZipCache.get(this.ZipCacheUrl);
                    var resData: any = null;
                    if (this.responseType === "json") {
                        const textData = await cache.async("text");
                        resData = JSON.parse(textData);
                    } else if (this.responseType === "arraybuffer" || this.responseType === "text") {
                        resData = await cache.async(this.responseType);
                    }
                        
                    var jsonVersionOld = ResCacheJsonVersion.get(this.ZipCacheUrl);
                    if (jsonVersionOld) {
                        ResCache.delete(`${this.ZipCacheUrl}@version${jsonVersionOld}`);
                        ResCacheJsonVersion.delete(this.ZipCacheUrl);
                    }
                    var jsonVersionNew = performance.now();

                    ResCacheJsonVersion.set(this.ZipCacheUrl, jsonVersionNew);

                    this.ZipCacheUrl = `${this.ZipCacheUrl}@version${jsonVersionNew}`;
                    ResCache.set(this.ZipCacheUrl, resData);
                }
                //@ts-ignore
                this.onload();
                return;
            }
            //@ts-ignore
            return oldSend.apply(this, arguments);
        }
    }
}
export const zipLoader = ZipLoader.ins;
