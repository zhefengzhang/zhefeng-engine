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

import { ISchedulable } from './scheduler';
import { Enum } from './value-types/enum';

/**
 * @en Predefined priority levels for system execution order.
 * @zh 系统执行顺序的预定义优先级级别。
 * @enum {number}
 */
export enum SystemPriority {
    /** @en Low priority systems execute last @zh 低优先级系统最后执行 */
    LOW = 0,
    /** @en Medium priority systems execute in the middle @zh 中等优先级系统在中间执行 */
    MEDIUM = 100,
    /** @en High priority systems execute first @zh 高优先级系统最先执行 */
    HIGH = 200,
    /** @en Special priority for scheduler system @zh 调度器系统的特殊优先级 */
    SCHEDULER = (1 << 31) >>> 0,
}

/**
 * @en Base class for all functional systems managed by Director. Provides lifecycle methods and priority-based execution order.
 * @zh 功能系统的基类，由 Director 管理。提供生命周期方法和基于优先级的执行顺序。
 */
export class System implements ISchedulable {
    /**
     * @en Static enum for system priority levels, compatible with legacy code.
     * @zh 系统优先级级别的静态枚举，与旧代码兼容。
     * @static
     * @readonly
     */
    static Priority = Enum({
        LOW: SystemPriority.LOW,
        MEDIUM: SystemPriority.MEDIUM,
        HIGH: SystemPriority.HIGH,
        SCHEDULER: SystemPriority.SCHEDULER,
    });

    /**
     * @en Unique identifier for this system instance.
     * @zh 此系统实例的唯一标识符。
     * @protected
     */
    protected _id = '';
    
    /**
     * @en Execution priority of this system. Higher values execute first.
     * @zh 此系统的执行优先级。数值越高越先执行。
     * @protected
     */
    protected _priority = 0;
    
    /**
     * @en Whether this system should execute in edit mode.
     * @zh 此系统是否应在编辑模式下执行。
     * @protected
     */
    protected _executeInEditMode = false;

    /**
     * @en Set the execution priority of this system.
     * @zh 设置此系统的执行优先级。
     * @param value - The priority value (higher values execute first)
     */
    set priority (value: number) {
        this._priority = value;
    }
    
    /**
     * @en Get the execution priority of this system.
     * @zh 获取此系统的执行优先级。
     * @returns The current priority value
     */
    get priority (): number {
        return this._priority;
    }

    /**
     * @en Set the unique identifier for this system.
     * @zh 设置此系统的唯一标识符。
     * @param id - The system identifier string
     */
    set id (id: string) {
        this._id = id;
    }
    
    /**
     * @en Get the unique identifier of this system.
     * @zh 获取此系统的唯一标识符。
     * @returns The system identifier string
     */
    get id (): string {
        return this._id;
    }

    /**
     * @en Comparator function for sorting systems by priority in descending order (higher priority first).
     * @zh 用于按优先级降序排列系统的比较函数（高优先级在前）。
     * @param a - First system to compare
     * @param b - Second system to compare
     * @returns Negative if a has higher priority, positive if b has higher priority, zero if equal
     * @static
     */
    public static sortByPriority (a: System, b: System): number {
        if (a._priority < b._priority) {
            return 1;
        } else if (a._priority > b._priority) {
            return -1;
        } else {
            return 0;
        }
    }

    /**
     * @en Initialize the system. Called by Director when the system is registered. Override this method to implement custom initialization logic.
     * @zh 初始化系统。当系统被注册时由 Director 调用。重写此方法以实现自定义初始化逻辑。
     * @virtual
     */
    init (): void {}
    /**
     * @en Update function called every frame between component update and late update phases. Override to implement per-frame logic.
     * @zh 每帧调用的更新函数，在组件 update 和 lateUpdate 阶段之间执行。重写以实现每帧逻辑。
     * @param dt - Delta time in seconds since the last frame
     * @virtual
     */
    update (dt: number): void {}
    /**
     * @en Post-update function called after all components' late update phase and before rendering. Override to implement post-processing logic.
     * @zh 后更新函数，在所有组件的 lateUpdate 阶段之后、渲染之前调用。重写以实现后处理逻辑。
     * @param dt - Delta time in seconds since the last frame
     * @virtual
     */
    postUpdate (dt: number): void {}

    /**
     * @en Cleanup function called when the system is being destroyed. Override to implement custom cleanup logic.
     * @zh 系统销毁时调用的清理函数。重写以实现自定义清理逻辑。
     * @virtual
     */
    destroy (): void {}
}
