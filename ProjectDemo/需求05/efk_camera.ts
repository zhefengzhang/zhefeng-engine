import { _decorator, Camera, CCClass, Component, Layers } from 'cc';
import { EFKRender } from './efk_render';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('EFKCamera')
@executeInEditMode
export class EFKCamera extends Component {

    @property({ type: Layers.Enum })
    renderID: Layers.Enum = Layers.Enum.DEFAULT;

    @property(Camera)
    backgroud: Camera = null!;

    private efk_render_id: number = 0;

    private needUpdateCamera: boolean = false;

    protected onLoad(): void {
        if (EDITOR) {
            let attrs = [];
            for (let i in Layers.Enum) {
                attrs.push({ name: i, value: Layers.Enum[i] });
            }
            CCClass.Attr.setClassAttr(EFKCamera, 'renderID', 'enumList', attrs);
        }
        const cam = this.getComponent(Camera);
        if (this.renderID !== Layers.Enum.NONE && (cam.visibility & this.renderID) === this.renderID) {
            this.needUpdateCamera = true;
        }
    }

    protected onEnable() {
        if (!this.needUpdateCamera) return;
        const cam = this.getComponent(Camera);

        let idx = EFKRender.cameras.indexOf(cam.camera);
        if (idx < 0) {
            EFKRender.cameras.push(cam.camera);
        }

        this.efk_render_id = this.renderID.toString(2).indexOf("1");

        if (this.backgroud && this.backgroud.targetTexture) {
            this.backgroud.targetTexture.resize(screen.width, screen.height);
            EFKRender.enableExternalTexture(this.efk_render_id, this.backgroud);
        }
    }

    protected onDisable(): void {
        const cam = this.getComponent(Camera);
        let idx = EFKRender.cameras.indexOf(cam.camera);
        if (idx >= 0) {
            EFKRender.cameras.splice(idx, 1);
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this.needUpdateCamera) return;
        const cam = this.getComponent(Camera);
        const icam = cam.camera;
        EFKRender.updateCamera(this.efk_render_id, icam);
    }

}
