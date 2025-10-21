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

import { IDGenerator } from './utils/id-generator';
import { createMap } from './utils/js';
import { System, SystemPriority } from './system';
import { legacyCC } from './global-exports';
import { errorID, warnID, logID, assertID } from './platform/debug';

const MAX_POOL_SIZE = 20;

const idGenerator = new IDGenerator('Scheduler');

/**
 * @en Interface for objects that can be scheduled by the Scheduler.
 * This interface defines the objects that need to be managed by the Scheduler system.
 * Objects implementing this interface can receive regular update calls and timer-based callbacks.
 *
 * @zh 可以被 Scheduler 调度的对象接口。
 * 此接口定义了需要被调度器系统管理的对。
 * 实现此接口的对象可以接收定期的更新调用和基于定时器的回调。
 *
 * @example
 * ```typescript
 * class MyComponent implements ISchedulable {
 *     id: string = 'my-component';
 *
 *     update(dt: number): void {
 *         // Update logic here
 *     }
 * }
 * ```
 */
export interface ISchedulable {
    /**
     * @en Unique identifier for the schedulable object.
     * This ID is used by the Scheduler to track and manage the object.
     * If not provided, the Scheduler will automatically generate one.
     *
     * @zh 可调度对象的唯一标识符。
     * 此 ID 被调度器用来跟踪和管理对象。
     * 如果未提供，调度器将自动生成一个。
     */
    id?: string;

    /**
     * @en UUID for the schedulable object.
     * Alternative unique identifier that can be used instead of or alongside the id.
     * Commonly used for objects that already have a UUID from other systems.
     *
     * @zh 可调度对象的 UUID。
     * 可以代替或与 id 一起使用的替代唯一标识符。
     * 通常用于已经从其他系统获得 UUID 的对象。
     */
    uuid?: string;

    /**
     * @en Update method called by the scheduler every frame.
     * This method is invoked during the scheduler's update cycle to allow
     * the object to perform per-frame logic updates.
     *
     * @zh 由调度器每帧调用的更新方法。
     * 此方法在调度器的更新周期中被调用，允许对象执行每帧的逻辑更新。
     *
     * @param dt
     * @en Delta time in seconds since the last frame.
     * This value represents the time elapsed and can be used for time-based calculations.
     *
     * @zh 自上一帧以来的增量时间（以秒为单位）。
     * 此值表示经过的时间，可用于基于时间的计算。
     */
    update?(dt: number): void;
}

// data structures
/**
 * @en A list entry used for "updates with priority".
 * This class represents an entry in the scheduler's priority-based update lists.
 * It manages objects that need to receive update calls every frame with specific priority ordering.
 * Uses object pooling pattern for optimal memory management and performance.
 *
 * @zh 用于"优先更新"的列表条目。
 * 此类表示调度器基于优先级的更新列表中的一个条目。
 * 它管理需要以特定优先级顺序每帧接收更新调用的对象。
 * 使用对象池模式以实现最佳的内存管理和性能。
 *
 * @class ListEntry
 * @mangle
 */
class ListEntry {
    /**
     * @en Get a ListEntry instance from the object pool.
     * Retrieves a recycled instance if available, otherwise creates a new one.
     * This method helps reduce garbage collection by reusing objects.
     *
     * @zh 从对象池中获取 ListEntry 实例。
     * 如果可用则检索回收的实例，否则创建新实例。
     * 此方法通过重用对象来帮助减少垃圾回收。
     *
     * @param target The schedulable object to associate with this entry
     * @param priority The priority value for execution order (lower values execute first)
     * @param paused Whether this entry should be paused initially
     * @param markedForDeletion Whether this entry is marked for deletion
     * @returns A configured ListEntry instance ready for use
     */
    public static get (target: ISchedulable, priority: number, paused: boolean, markedForDeletion: boolean): ListEntry {
        let result = ListEntry._listEntries.pop();
        if (result) {
            result.target = target;
            result.priority = priority;
            result.paused = paused;
            result.markedForDeletion = markedForDeletion;
        } else {
            result = new ListEntry(target, priority, paused, markedForDeletion);
        }
        return result;
    }

    /**
     * @en Return a ListEntry instance to the object pool for reuse.
     * Cleans up the entry and adds it back to the pool if there's space.
     * This helps maintain a pool of reusable objects to reduce memory allocation.
     *
     * @zh 将 ListEntry 实例返回到对象池以供重用。
     * 清理条目并在有空间时将其添加回池中。
     * 这有助于维护可重用对象池以减少内存分配。
     *
     * @param entry The ListEntry instance to return to the pool
     */
    public static put (entry: ListEntry): void {
        if (ListEntry._listEntries.length < MAX_POOL_SIZE) {
            entry.target = null;
            ListEntry._listEntries.push(entry);
        }
    }

    /**
     * @en Object pool for ListEntry instances to minimize garbage collection.
     * @zh ListEntry 实例的对象池，用于最小化垃圾回收。
     */
    private static _listEntries: ListEntry[] = [];

    /**
     * @en The schedulable object that will receive update calls.
     * This object must implement the ISchedulable interface to be managed by the scheduler.
     *
     * @zh 将接收更新调用的可调度对象。
     * 此对象必须实现 ISchedulable 接口才能被调度器管理。
     */
    public target: ISchedulable | null;

    /**
     * @en Priority value determining the order of execution.
     * Lower values execute first: negative priority < 0 priority < positive priority.
     * This allows fine-grained control over update order.
     *
     * @zh 决定执行顺序的优先级值。
     * 较低的值先执行：负优先级 < 0优先级 < 正优先级。
     * 这允许对更新顺序进行细粒度控制。
     */
    public priority: number;

    /**
     * @en Whether this entry is currently paused and should skip updates.
     * When paused, the target's update method will not be called.
     *
     * @zh 此条目当前是否已暂停并应跳过更新。
     * 暂停时，目标的更新方法将不会被调用。
     */
    public paused: boolean;

    /**
     * @en Whether this entry is marked for deletion and should be removed.
     * When marked for deletion, the entry will be removed at the end of the current update cycle.
     *
     * @zh 此条目是否标记为删除并应被移除。
     * 标记为删除时，条目将在当前更新周期结束时被移除。
     */
    public markedForDeletion: boolean;

    /**
     * @en Creates a new ListEntry instance.
     * Initializes all properties with the provided values to create a fully configured entry.
     *
     * @zh 创建新的 ListEntry 实例。
     * 使用提供的值初始化所有属性以创建完全配置的条目。
     *
     * @param target
     * @en Target object that implements ISchedulable interface.
     * This object will receive update calls from the scheduler.
     *
     * @zh 实现 ISchedulable 接口的目标对象。
     * 此对象将从调度器接收更新调用。
     *
     * @param priority
     * @en The execution priority for this entry.
     * Lower values execute before higher values.
     *
     * @zh 此条目的执行优先级。
     * 较低的值在较高的值之前执行。
     *
     * @param paused
     * @en Whether this entry should start in a paused state.
     * Paused entries skip update calls until resumed.
     *
     * @zh 此条目是否应以暂停状态开始。
     * 暂停的条目跳过更新调用直到恢复。
     *
     * @param markedForDeletion
     * @en Whether this entry is marked for deletion.
     * Marked entries will be removed at the end of the next update cycle.
     *
     * @zh 此条目是否标记为删除。
     * 标记的条目将在下一个更新周期结束时被移除。
     */
    constructor (target: ISchedulable, priority: number, paused: boolean, markedForDeletion: boolean) {
        this.target = target;
        this.priority = priority;
        this.paused = paused;
        this.markedForDeletion = markedForDeletion;
    }
}

/**
 * @en Hash table entry for managing update callbacks with different priorities.
 * This class organizes multiple update entries for a single target, allowing
 * efficient management of callbacks with different priorities for the same object.
 * Uses object pooling pattern for memory efficiency.
 *
 * @zh 用于管理不同优先级更新回调的哈希表条目。
 * 此类为单个目标组织多个更新条目，允许
 * 高效管理同一对象的不同优先级回调。
 * 使用对象池模式以提高内存效率。
 *
 * @example
 * ```typescript
 * // Internal usage by Scheduler
 * const entry = HashUpdateEntry.get(listArray, listEntry, target, callback);
 * // ... use entry
 * HashUpdateEntry.put(entry); // Return to pool
 * ```
 * @mangle
 */
class HashUpdateEntry {
    /**
     * @en Retrieves a HashUpdateEntry instance from the object pool or creates a new one.
     * This method implements the object pool pattern to reduce memory allocation overhead.
     *
     * @zh 从对象池中检索 HashUpdateEntry 实例或创建新实例。
     * 此方法实现对象池模式以减少内存分配开销。
     *
     * @param list
     * @en The list of entries that this hash entry belongs to.
     * @zh 此哈希条目所属的条目列表。
     *
     * @param entry
     * @en The specific list entry being managed.
     * @zh 正在管理的特定列表条目。
     *
     * @param target
     * @en The schedulable target object (used as hash key).
     * @zh 可调度的目标对象（用作哈希键）。
     *
     * @param callback
     * @en The callback function to be executed.
     * @zh 要执行的回调函数。
     *
     * @returns
     * @en A configured HashUpdateEntry instance ready for use.
     * @zh 配置好的可使用的 HashUpdateEntry 实例。
     */
    public static get (list: ListEntry[], entry: ListEntry, target: ISchedulable, callback: AnyFunction | null): HashUpdateEntry {
        let result = HashUpdateEntry._hashUpdateEntries.pop();
        if (result) {
            result.list = list;
            result.entry = entry;
            result.target = target;
            result.callback = callback;
        } else {
            result = new HashUpdateEntry(list, entry, target, callback);
        }
        return result;
    }

    /**
     * @en Returns a HashUpdateEntry instance to the object pool for reuse.
     * Clears all references to prevent memory leaks before pooling.
     *
     * @zh 将 HashUpdateEntry 实例返回到对象池以供重用。
     * 在池化之前清除所有引用以防止内存泄漏。
     *
     * @param entry
     * @en The HashUpdateEntry instance to return to the pool.
     * @zh 要返回到池中的 HashUpdateEntry 实例。
     */
    public static put (entry: HashUpdateEntry): void {
        if (HashUpdateEntry._hashUpdateEntries.length < MAX_POOL_SIZE) {
            entry.list = entry.entry = entry.target = entry.callback = null;
            HashUpdateEntry._hashUpdateEntries.push(entry);
        }
    }

    /**
     * @en Object pool for HashUpdateEntry instances to reduce memory allocation.
     * Maintains a pool of reusable instances for better performance.
     *
     * @zh HashUpdateEntry 实例的对象池，用于减少内存分配。
     * 维护可重用实例池以获得更好的性能。
     */
    private static _hashUpdateEntries: HashUpdateEntry[] = [];

    /**
     * @en The list of entries that this hash entry belongs to.
     * Contains all ListEntry objects for the same target with different priorities.
     *
     * @zh 此哈希条目所属的条目列表。
     * 包含同一目标的所有不同优先级的 ListEntry 对象。
     */
    public list: ListEntry[] | null;

    /**
     * @en The specific list entry being managed by this hash entry.
     * Points to the current entry being processed during updates.
     *
     * @zh 此哈希条目管理的特定列表条目。
     * 指向更新期间正在处理的当前条目。
     */
    public entry: ListEntry | null;

    /**
     * @en The schedulable target object (used as hash key).
     * This object implements ISchedulable and receives update calls.
     *
     * @zh 可调度的目标对象（用作哈希键）。
     * 此对象实现 ISchedulable 并接收更新调用。
     */
    public target: ISchedulable | null;

    /**
     * @en The callback function to be executed during updates.
     * This function is called when the scheduler processes this entry.
     *
     * @zh 更新期间要执行的回调函数。
     * 当调度器处理此条目时调用此函数。
     */
    public callback: AnyFunction | null;

    /**
     * @en Creates a new HashUpdateEntry instance.
     * Initializes all properties with the provided values for immediate use.
     *
     * @zh 创建新的 HashUpdateEntry 实例。
     * 使用提供的值初始化所有属性以供立即使用。
     *
     * @param list
     * @en The list of entries that this hash entry will belong to.
     * @zh 此哈希条目将属于的条目列表。
     *
     * @param entry
     * @en The specific list entry to be managed.
     * @zh 要管理的特定列表条目。
     *
     * @param target
     * @en The schedulable target object.
     * @zh 可调度的目标对象。
     *
     * @param callback
     * @en The callback function to execute.
     * @zh 要执行的回调函数。
     */
    constructor (list: ListEntry[], entry: ListEntry, target: ISchedulable, callback: AnyFunction | null) {
        this.list = list;
        this.entry = entry;
        this.target = target;
        this.callback = callback;
    }
}

/**
 * @en Hash Element used for "selectors with interval".
 * @zh “用于间隔选择”的哈希元素。
 * @param timers
 * @param target  hash key (retained)
 * @param timerIndex
 * @param currentTimer
 * @param currentTimerSalvaged
 * @param paused
 * @mangle
 */
/**
 * @en Hash table entry for managing timer-based callbacks with intervals.
 * This class organizes timer callbacks for scheduled functions that execute
 * at specific intervals, providing efficient management of timed operations.
 * Uses object pooling pattern for memory efficiency.
 *
 * @zh 用于管理基于定时器的间隔回调的哈希表条目。
 * 此类为按特定间隔执行的调度函数组织定时器回调，
 * 提供定时操作的高效管理。
 * 使用对象池模式以提高内存效率。
 *
 * @example
 * ```typescript
 * // Internal usage by Scheduler
 * const entry = HashTimerEntry.get(timers, target, 0, null, false, false);
 * // ... use entry
 * HashTimerEntry.put(entry); // Return to pool
 * ```
 * @mangle
 */
class HashTimerEntry {
    /**
     * @en Get a HashTimerEntry instance from the object pool or create a new one.
     * This method implements the object pool pattern for memory efficiency.
     * @zh 从对象池中获取HashTimerEntry实例或创建新实例。
     * 此方法实现对象池模式以提高内存效率。
     *
     * @param timers - Array of callback timers / 回调定时器数组
     * @param target - The target object (hash key, retained) / 目标对象（哈希键，保留）
     * @param timerIndex - Index of the current timer / 当前定时器的索引
     * @param currentTimer - Current active timer / 当前活动定时器
     * @param currentTimerSalvaged - Whether current timer is salvaged / 当前定时器是否已被拯救
     * @param paused - Whether the entry is paused / 条目是否暂停
     * @returns A HashTimerEntry instance / HashTimerEntry实例
     */
    public static get (timers: CallbackTimer[] | null, target: ISchedulable, timerIndex: number, currentTimer: CallbackTimer | null, currentTimerSalvaged: boolean, paused: boolean): HashTimerEntry {
        let result = HashTimerEntry._hashTimerEntries.pop();
        if (result) {
            result.timers = timers;
            result.target = target;
            result.timerIndex = timerIndex;
            result.currentTimer = currentTimer;
            result.currentTimerSalvaged = currentTimerSalvaged;
            result.paused = paused;
        } else {
            result = new HashTimerEntry(timers, target, timerIndex, currentTimer, currentTimerSalvaged, paused);
        }
        return result;
    }

    /**
     * @en Return a HashTimerEntry instance to the object pool for reuse.
     * This method cleans up the entry and adds it back to the pool if there's space.
     * @zh 将HashTimerEntry实例返回到对象池以供重用。
     * 此方法清理条目并在有空间时将其添加回池中。
     *
     * @param entry - The HashTimerEntry instance to return / 要返回的HashTimerEntry实例
     */
    public static put (entry: HashTimerEntry): void {
        if (HashTimerEntry._hashTimerEntries.length < MAX_POOL_SIZE) {
            entry.timers = entry.target = entry.currentTimer = null;
            HashTimerEntry._hashTimerEntries.push(entry);
        }
    }

    /**
     * @en Object pool for HashTimerEntry instances to reduce memory allocation.
     * @zh HashTimerEntry实例的对象池，用于减少内存分配。
     * @private
     */
    private static _hashTimerEntries: HashTimerEntry[] = [];

    /**
     * @en Array of callback timers associated with this entry.
     * @zh 与此条目关联的回调定时器数组。
     */
    public timers: CallbackTimer[] | null;

    /**
     * @en The target object that owns the timers (used as hash key).
     * @zh 拥有定时器的目标对象（用作哈希键）。
     */
    public target: ISchedulable | null;

    /**
     * @en Index of the current timer in the timers array.
     * @zh 定时器数组中当前定时器的索引。
     */
    public timerIndex: number;

    /**
     * @en Reference to the currently active timer.
     * @zh 当前活动定时器的引用。
     */
    public currentTimer: CallbackTimer | null;

    /**
     * @en Flag indicating whether the current timer has been salvaged during iteration.
     * @zh 标志，指示当前定时器在迭代期间是否已被拯救。
     */
    public currentTimerSalvaged: boolean;

    /**
     * @en Flag indicating whether this timer entry is paused.
     * @zh 标志，指示此定时器条目是否暂停。
     */
    public paused: boolean;

    /**
     * @en Constructor for HashTimerEntry.
     * Initializes a new timer entry with the provided parameters.
     * @zh HashTimerEntry的构造函数。
     * 使用提供的参数初始化新的定时器条目。
     *
     * @param timers - Array of callback timers / 回调定时器数组
     * @param target - The target object / 目标对象
     * @param timerIndex - Index of the current timer / 当前定时器的索引
     * @param currentTimer - Current active timer / 当前活动定时器
     * @param currentTimerSalvaged - Whether current timer is salvaged / 当前定时器是否已被拯救
     * @param paused - Whether the entry is paused / 条目是否暂停
     */
    constructor (timers: CallbackTimer[] | null, target: ISchedulable, timerIndex: number, currentTimer: CallbackTimer | null, currentTimerSalvaged: boolean, paused: boolean) {
        this.timers = timers;
        this.target = target;
        this.timerIndex = timerIndex;
        this.currentTimer = currentTimer;
        this.currentTimerSalvaged = currentTimerSalvaged;
        this.paused = paused;
    }
}

type CallbackType = (dt?: number) => void;

/**
 * @en Lightweight timer class for managing scheduled callbacks with intervals and delays.
 * This class provides efficient timer functionality with object pooling for memory optimization.
 * Supports both repeating and one-time callbacks with customizable intervals and delays.
 *
 * @zh 用于管理带间隔和延迟的调度回调的轻量级定时器类。
 * 此类提供高效的定时器功能，并使用对象池进行内存优化。
 * 支持可自定义间隔和延迟的重复和一次性回调。
 *
 * @example
 * ```typescript
 * const timer = CallbackTimer.get();
 * timer.initWithCallback(scheduler, callback, target, 1.0, 5, 0.5);
 * // Timer will execute callback 5 times with 1 second interval after 0.5 second delay
 * ```
 * @mangle
 */
class CallbackTimer {
    /**
     * @en Object pool for CallbackTimer instances to reduce memory allocation.
     * @zh CallbackTimer实例的对象池，用于减少内存分配。
     */
    public static _timers: CallbackTimer[] = [];

    /**
     * @en Get a CallbackTimer instance from the object pool or create a new one.
     * @zh 从对象池中获取CallbackTimer实例或创建新实例。
     * @returns A CallbackTimer instance / CallbackTimer实例
     */
    public static get (): CallbackTimer { return CallbackTimer._timers.pop() || new CallbackTimer(); }

    /**
     * @en Return a CallbackTimer instance to the object pool for reuse.
     * Only returns to pool if not locked and pool has space.
     * @zh 将CallbackTimer实例返回到对象池以供重用。
     * 仅在未锁定且池有空间时返回到池中。
     * @param timer - The CallbackTimer instance to return / 要返回的CallbackTimer实例
     */
    public static put (timer: CallbackTimer): void {
        if (CallbackTimer._timers.length < MAX_POOL_SIZE && !timer._lock) {
            timer._scheduler = timer._target = timer._callback = null;
            CallbackTimer._timers.push(timer);
        }
    }

    /**
     * @en Lock flag to prevent timer from being returned to pool during execution.
     * @zh 锁定标志，防止定时器在执行期间被返回到池中。
     * @private
     */
    private _lock: boolean;

    /**
     * @en Reference to the scheduler that manages this timer.
     * @zh 管理此定时器的调度器引用。
     * @private
     */
    private _scheduler: Scheduler | null;

    /**
     * @en Elapsed time since timer started or last execution.
     * @zh 自定时器启动或上次执行以来的经过时间。
     * @private
     */
    private _elapsed: number;

    /**
     * @en Flag indicating whether timer should run forever.
     * @zh 标志，指示定时器是否应永远运行。
     * @private
     */
    private _runForever: boolean;

    /**
     * @en Flag indicating whether timer should use initial delay.
     * @zh 标志，指示定时器是否应使用初始延迟。
     * @private
     */
    private _useDelay: boolean;

    /**
     * @en Number of times the timer has been executed.
     * @zh 定时器已执行的次数。
     * @private
     */
    private _timesExecuted: number;

    /**
     * @en Number of times the timer should repeat (excluding initial execution).
     * @zh 定时器应重复的次数（不包括初始执行）。
     * @private
     */
    private _repeat: number;

    /**
     * @en Initial delay before first execution in seconds.
     * @zh 首次执行前的初始延迟（秒）。
     * @private
     */
    private _delay: number;

    /**
     * @en Interval between executions in seconds.
     * @zh 执行间隔（秒）。
     * @private
     */
    private _interval: number;

    /**
     * @en Target object that owns this timer.
     * @zh 拥有此定时器的目标对象。
     * @private
     */
    private _target: ISchedulable | null;

    /**
     * @en Callback function to execute when timer triggers.
     * @zh 定时器触发时要执行的回调函数。
     * @private
     */
    private _callback?: CallbackType | null;

    /**
     * @en Constructor for CallbackTimer.
     * Initializes all timer properties to their default values.
     * @zh CallbackTimer的构造函数。
     * 将所有定时器属性初始化为默认值。
     */
    constructor () {
        this._lock = false;
        this._scheduler = null;
        this._elapsed = -1;
        this._runForever = false;
        this._useDelay = false;
        this._timesExecuted = 0;
        this._repeat = 0;
        this._delay = 0;
        this._interval = 0;

        this._target = null;
    }

    /**
     * @en Initialize the timer with callback function and scheduling parameters.
     * This method sets up the timer for execution with specified interval, repeat count, and delay.
     * @zh 使用回调函数和调度参数初始化定时器。
     * 此方法设置定时器以指定的间隔、重复次数和延迟执行。
     *
     * @param scheduler - The scheduler that manages this timer / 管理此定时器的调度器
     * @param callback - The callback function to execute / 要执行的回调函数
     * @param target - The target object for the callback / 回调的目标对象
     * @param seconds - Interval between executions in seconds / 执行间隔（秒）
     * @param repeat - Number of times to repeat (use legacyCC.macro.REPEAT_FOREVER for infinite) / 重复次数（使用legacyCC.macro.REPEAT_FOREVER表示无限）
     * @param delay - Initial delay before first execution in seconds / 首次执行前的初始延迟（秒）
     * @returns Always returns true / 总是返回true
     */
    public initWithCallback (scheduler: Scheduler, callback: CallbackType, target: ISchedulable, seconds: number, repeat: number, delay: number): boolean {
        this._lock = false;
        this._scheduler = scheduler;
        this._target = target;
        this._callback = callback;
        this._timesExecuted = 0;

        this._elapsed = -1;
        this._interval = seconds;
        this._delay = delay;
        this._useDelay = (this._delay > 0);
        this._repeat = repeat;
        this._runForever = (this._repeat === legacyCC.macro.REPEAT_FOREVER);
        return true;
    }
    /**
     * @en get interval for timer in seconds.
     * @zh 获取计时器的时间间隔, 以秒为单位。
     * @returns
     * @en returns interval of timer in seconds.
     * @zh 返回计时器的时间间隔, 以秒为单位。
     */
    public getInterval (): number {
        return this._interval;
    }
    /**
     * @en Set interval in seconds.
     * @zh 以秒为单位设置时间间隔。
     */
    public setInterval (interval: number): void {
        this._interval = interval;
    }

    /**
     * @en Update function which triggers the timer.
     * @zh 计时更新函数，用来触发计时器。
     * @param dt
     * @en delta time. The unit is seconds.
     * @zh 更新间隔时间, 单位是秒。
     */
    public update (dt: number): void {
        if (this._elapsed === -1) {
            this._elapsed = 0;
            this._timesExecuted = 0;
        } else {
            this._elapsed += dt;
            if (this._runForever && !this._useDelay) { // standard timer usage
                if (this._elapsed >= this._interval) {
                    this.trigger();
                    this._elapsed = 0;
                }
            } else { // advanced usage
                if (this._useDelay) {
                    if (this._elapsed >= this._delay) {
                        this.trigger();

                        this._elapsed -= this._delay;
                        this._timesExecuted += 1;
                        this._useDelay = false;
                    }
                } else if (this._elapsed >= this._interval) {
                    this.trigger();

                    this._elapsed = 0;
                    this._timesExecuted += 1;
                }

                if (this._callback && !this._runForever && this._timesExecuted > this._repeat) {
                    this.cancel();
                }
            }
        }
    }

    /**
     * @en Get the callback function associated with this timer.
     * @zh 获取与此定时器关联的回调函数。
     * @returns The callback function or null/undefined if not set / 回调函数，如果未设置则为null/undefined
     */
    public getCallback (): CallbackType | null | undefined {
        return this._callback;
    }

    /**
     * @en Trigger the timer's callback function.
     * This method executes the callback with the target object and elapsed time.
     * Sets lock during execution to prevent pool return.
     * @zh 触发定时器的回调函数。
     * 此方法使用目标对象和经过时间执行回调。
     * 在执行期间设置锁定以防止返回池。
     */
    public trigger (): void {
        if (this._target && this._callback) {
            this._lock = true;
            this._callback.call(this._target, this._elapsed);
            this._lock = false;
        }
    }

    /**
     * @en Cancel the timer and unschedule it from the scheduler.
     * This method removes the timer from the scheduler's management.
     * @zh 取消定时器并从调度器中取消调度。
     * 此方法从调度器的管理中移除定时器。
     */
    public cancel (): void {
        if (this._scheduler && this._callback && this._target) {
            this._scheduler.unscheduleForTimer(this, this._target);
        }
    }
}

/**
 * @en
 * Scheduler is the core timing system responsible for triggering scheduled callbacks in the game engine.
 * It manages two types of scheduled tasks with different execution patterns and performance characteristics.
 *
 * **Task Types:**
 * - **Update callbacks**: Execute every frame with customizable priority levels (negative, zero, positive)
 * - **Custom timers**: Execute at specified intervals or every frame with more flexible timing control
 *
 * **Performance Considerations:**
 * - Update callbacks are more efficient for per-frame operations (faster execution, lower memory usage)
 * - Custom timers provide more flexibility but have slightly higher overhead
 * - Use update callbacks when possible for better performance
 *
 * **Usage Example:**
 * ```typescript
 * import { director } from 'cc';
 * // Get the global scheduler
 * const scheduler = director.getScheduler();
 *
 * // Schedule an update callback
 * scheduler.scheduleUpdate(this, 0, false);
 *
 * // Schedule a custom timer
 * scheduler.schedule(this.myCallback, this, 1.0, false);
 * ```
 *
 * @zh
 * Scheduler 是游戏引擎的核心定时系统，负责触发调度的回调函数。
 * 它管理两种不同执行模式和性能特征的调度任务。
 *
 * **任务类型：**
 * - **Update 回调**：每帧执行，支持自定义优先级（负数、零、正数）
 * - **自定义定时器**：按指定间隔或每帧执行，提供更灵活的时间控制
 *
 * **性能考虑：**
 * - Update 回调对于每帧操作更高效（执行更快，内存使用更少）
 * - 自定义定时器提供更多灵活性但开销略高
 * - 尽可能使用 update 回调以获得更好的性能
 *
 * **使用示例：**
 * ```typescript
 * import { director } from 'cc';
 * // 获取全局调度器
 * const scheduler = director.getScheduler();
 *
 * // 调度 update 回调
 * scheduler.scheduleUpdate(this, 0, false);
 *
 * // 调度自定义定时器
 * scheduler.schedule(this.myCallback, this, 1.0, false);
 * ```
 */
export class Scheduler extends System {
    public static ID = 'scheduler';

    private _timeScale: number;
    private _updatesNegList: ListEntry[];
    private _updates0List: ListEntry[];
    private _updatesPosList: ListEntry[];
    private _hashForUpdates: Record<string, HashUpdateEntry>;
    private _hashForTimers: Record<string, HashTimerEntry>;
    private _currentTarget: HashTimerEntry | null;
    private _currentTargetSalvaged: boolean;
    private _updateHashLocked: boolean;
    private _arrayForTimers: HashTimerEntry[];

    /**
     * @en
     * Enables a target object for scheduler management by ensuring it has a unique identifier.
     * This method must be called before using any scheduler APIs with the target object.
     * It automatically assigns a unique ID if the target doesn't have 'uuid' or 'id' properties.
     *
     * **Important:** Call this method before scheduling any tasks for the target.
     *
     * @zh
     * 为目标对象启用调度器管理，确保其具有唯一标识符。
     * 在对目标对象使用任何调度器 API 之前必须调用此方法。
     * 如果目标对象没有 'uuid' 或 'id' 属性，会自动分配一个唯一 ID。
     *
     * **重要：** 在为目标调度任何任务之前调用此方法。
     *
     * @param target The target object to enable for scheduling. Must implement ISchedulable interface.
     *               要启用调度的目标对象。必须实现 ISchedulable 接口。
     */
    public static enableForTarget (target: ISchedulable): void {
        let found = false;
        if (target.uuid) {
            found = true;
        } else if (target.id) {
            found = true;
        }
        if (!found) {
            target.id = idGenerator.getNewId();
        }
    }

    /**
     * @en
     * Creates a new Scheduler instance and initializes all internal data structures.
     * Sets up priority-based update lists, hash maps for efficient lookup, and timing control variables.
     *
     * @zh
     * 创建新的 Scheduler 实例并初始化所有内部数据结构。
     * 设置基于优先级的更新列表、用于高效查找的哈希映射和时间控制变量。
     */
    constructor () {
        super();
        this._timeScale = 1.0;
        this._updatesNegList = [];  // list of priority < 0
        this._updates0List = [];    // list of priority == 0
        this._updatesPosList = [];  // list of priority > 0
        this._hashForUpdates = createMap(true) as Record<string, HashUpdateEntry>;  // hash used to fetch quickly the list entries for pause, delete, etc
        this._hashForTimers = createMap(true) as Record<string, HashTimerEntry>;   // Used for "selectors with interval"
        this._currentTarget = null;
        this._currentTargetSalvaged = false;
        this._updateHashLocked = false; // If true unschedule will not remove anything from a hash. Elements will only be marked for deletion.

        this._arrayForTimers = [];  // Speed up indexing
        // this._arrayForUpdates = [];   // Speed up indexing
    }

    // -----------------------public method-------------------------

    /**
     * @en
     * Modifies the time of all scheduled callbacks.<br>
     * You can use this property to create a 'slow motion' or 'fast forward' effect.<br>
     * Default is 1.0. To create a 'slow motion' effect, use values below 1.0.<br>
     * To create a 'fast forward' effect, use values higher than 1.0.<br>
     * Note：It will affect EVERY scheduled selector / action.
     * @zh
     * 设置时间间隔的缩放比例。<br>
     * 您可以使用这个方法来创建一个 “slow motion（慢动作）” 或 “fast forward（快进）” 的效果。<br>
     * 默认是 1.0。要创建一个 “slow motion（慢动作）” 效果,使用值低于 1.0。<br>
     * 要使用 “fast forward（快进）” 效果，使用值大于 1.0。<br>
     * 注意：它影响该 Scheduler 下管理的所有定时器。
     * @param timeScale
     */
    public setTimeScale (timeScale: number): void {
        this._timeScale = timeScale;
    }

    /**
     * @en Returns time scale of scheduler.
     * @zh 获取时间间隔的缩放比例。
     */
    public getTimeScale (): number {
        return this._timeScale;
    }

    /**
     * @en 'update' the scheduler. (You should NEVER call this method, unless you know what you are doing.)
     * @zh update 调度函数。(不应该直接调用这个方法，除非完全了解这么做的结果)
     * @param dt
     * @en delta time. The unit is seconds.
     * @zh 更新间隔时间, 单位是秒。
     */
    public update (dt: number): void {
        this._updateHashLocked = true;
        if (this._timeScale !== 1) {
            dt *= this._timeScale;
        }

        let i: number;
        let list: ListEntry[];
        let len: number;
        let entry: ListEntry;

        for (i = 0, list = this._updatesNegList, len = list.length; i < len; i++) {
            entry = list[i];
            if (!entry.paused && !entry.markedForDeletion && entry.target) {
                entry.target.update?.(dt);
            }
        }

        for (i = 0, list = this._updates0List, len = list.length; i < len; i++) {
            entry = list[i];
            if (!entry.paused && !entry.markedForDeletion && entry.target) {
                entry.target.update?.(dt);
            }
        }

        for (i = 0, list = this._updatesPosList, len = list.length; i < len; i++) {
            entry = list[i];
            if (!entry.paused && !entry.markedForDeletion && entry.target) {
                entry.target.update?.(dt);
            }
        }

        // Iterate over all the custom selectors
        let elt: HashTimerEntry;
        const arr = this._arrayForTimers;
        for (i = 0; i < arr.length; i++) {
            elt = arr[i];
            this._currentTarget = elt;
            this._currentTargetSalvaged = false;

            if (!elt.paused && elt.timers) {
                // The 'timers' array may change while inside this loop
                for (elt.timerIndex = 0; elt.timerIndex < elt.timers.length; ++(elt.timerIndex)) {
                    elt.currentTimer = elt.timers[elt.timerIndex];
                    elt.currentTimerSalvaged = false;

                    elt.currentTimer.update(dt);
                    elt.currentTimer = null;
                }
            }

            // only delete currentTarget if no actions were scheduled during the cycle (issue #481)
            if (this._currentTargetSalvaged && this._currentTarget.timers?.length === 0) {
                this._removeHashElement(this._currentTarget);
                --i;
            }
        }

        // delete all updates that are marked for deletion
        // updates with priority < 0
        for (i = 0, list = this._updatesNegList; i < list.length;) {
            entry = list[i];
            if (entry.markedForDeletion) {
                this._removeUpdateFromHash(entry);
            } else {
                i++;
            }
        }

        for (i = 0, list = this._updates0List; i < list.length;) {
            entry = list[i];
            if (entry.markedForDeletion) {
                this._removeUpdateFromHash(entry);
            } else {
                i++;
            }
        }

        for (i = 0, list = this._updatesPosList; i < list.length;) {
            entry = list[i];
            if (entry.markedForDeletion) {
                this._removeUpdateFromHash(entry);
            } else {
                i++;
            }
        }

        this._updateHashLocked = false;
        this._currentTarget = null;
    }

    /**
     * @en Specify the callback to schedule a new timer.
     * If the callback function is already scheduled, then only the interval parameter will be updated without re-scheduling it again.
     * @zh 指定回调函数来规划一个新的定时器。
     * 如果回调函数已经被定时器使用，那么只会更新之前定时器的时间间隔参数，不会设置新的定时器。
     * @param callback
     * @en The specified target.
     * @zh 所指定的调用对象。
     * @param target
     * @en The scheduled method will be called every 'interval' seconds.
     * If 'interval' is 0, it will be called every frame, but if so, it recommended to use 'scheduleUpdateForTarget:' instead.
     * @zh 当时间间隔达到指定值时，设置的回调函数将会被调用。
     * 如果 interval 值为 0，那么回调函数每一帧都会被调用，但如果是这样，建议使用 scheduleUpdateForTarget 代替。
     * @param interval
     * @en repeat let the action be repeated repeat + 1 times, use `macro.REPEAT_FOREVER` to let the action run continuously.
     * @zh repeat 值可以让定时器触发 repeat + 1 次，使用 `macro.REPEAT_FOREVER` 可以让定时器一直循环触发。
     * @param repeat
     * @en delay is the amount of time the action will wait before it'll start. Unit: s.
     * @zh delay 值指定延迟时间，定时器会在延迟指定的时间之后开始计时，单位: 秒。
     * @param delay
     * @en If paused is YES, then it won't be called until it is resumed.
     * @zh 如果 paused 值为 true，那么直到 resume 被调用才开始计时。
     * @param paused
     */
    public schedule (callback: CallbackType, target: ISchedulable, interval: number, repeat?: number, delay?: number, paused?: boolean): void;
    /**
     * @en The specified target.
     * @zh 所指定的调用对象。
     * @param target
     * @en Specify the callback to schedule a new timer.
     * If the callback function is already scheduled, then only the interval parameter will be updated without re-scheduling it again.
     * @zh 指定回调函数来规划一个新的定时器。
     * 如果回调函数已经被定时器使用，那么只会更新之前定时器的时间间隔参数，不会设置新的定时器。
     * @param callback
     * @en The scheduled method will be called every 'interval' seconds.
     * If 'interval' is 0, it will be called every frame, but if so, it recommended to use 'scheduleUpdateForTarget:' instead.
     * @zh 当时间间隔达到指定值时，设置的回调函数将会被调用。
     * 如果 interval 值为 0，那么回调函数每一帧都会被调用，但如果是这样，建议使用 scheduleUpdateForTarget 代替。
     * @param interval
     * @en repeat let the action be repeated repeat + 1 times, use `macro.REPEAT_FOREVER` to let the action run continuously.
     * @zh repeat 值可以让定时器触发 repeat + 1 次，使用 `macro.REPEAT_FOREVER` 可以让定时器一直循环触发。
     * @param repeat
     * @en delay is the amount of time the action will wait before it'll start. Unit: s.
     * @zh delay 值指定延迟时间，定时器会在延迟指定的时间之后开始计时，单位: 秒。
     * @param delay
     * @en If paused is YES, then it won't be called until it is resumed.
     * @zh 如果 paused 值为 true，那么直到 resume 被调用才开始计时。
     * @param paused
     *
     * @deprecated since v3.8.0, please use `Scheduler.schedule(callback, target, interval)` instead.
     */
    public schedule (target: ISchedulable, callback: CallbackType, interval: number, repeat?: number, delay?: number, paused?: boolean): void;
    public schedule (callbackTmp: CallbackType | ISchedulable, targetTmp: ISchedulable | CallbackType, interval: number, repeat?: number, delay?: number, paused?: boolean): void {
        let callback: CallbackType;
        let target: ISchedulable;
        if (typeof callbackTmp !== 'function') {
            warnID(1514);
            callback = targetTmp as CallbackType;
            target = callbackTmp;
        } else {
            callback = callbackTmp;
            target = targetTmp as ISchedulable;
        }
        // selector, target, interval, repeat, delay, paused
        // selector, target, interval, paused
        if (arguments.length === 3 || arguments.length === 4 || arguments.length === 5) {
            paused = !!repeat;
            repeat = legacyCC.macro.REPEAT_FOREVER;
            delay = 0;
        }

        assertID(Boolean(target), 1502);

        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }
        let element = this._hashForTimers[targetId];
        if (!element) {
            // Is this the 1st element ? Then set the pause level to all the callback_fns of this target
            element = HashTimerEntry.get(null, target, 0, null, false, Boolean(paused));
            this._arrayForTimers.push(element);
            this._hashForTimers[targetId] = element;
        } else if (element.paused !== paused) {
            warnID(1511);
        }

        let timer: CallbackTimer;
        let i;
        if (element.timers == null) {
            element.timers = [];
        } else {
            for (i = 0; i < element.timers.length; ++i) {
                timer = element.timers[i];
                if (timer && callback === timer.getCallback()) {
                    logID(1507, timer.getInterval(), interval);
                    timer.setInterval(interval);
                    return;
                }
            }
        }

        timer = CallbackTimer.get();
        timer.initWithCallback(this, callback, target, interval, repeat ?? 0, delay ?? 0);
        element.timers.push(timer);

        if (this._currentTarget === element && this._currentTargetSalvaged) {
            this._currentTargetSalvaged = false;
        }
    }

    /**
     * @en
     * Schedules the update callback for a given target,
     * During every frame after schedule started, the "update" function of target will be invoked.
     * @zh
     * 使用指定的优先级为指定的对象设置 update 定时器。<br>
     * update 定时器每一帧都会被触发，触发时自动调用指定对象的 "update" 函数。<br>
     * 优先级的值越低，定时器被触发的越早。
     * @param target
     * @en The target bound to the callback. @zh 回调所绑定的目标对象。
     * @param priority
     * @en The priority. @zh 优先级。
     * @param paused
     * @en Whether is paused. @zh 是否被暂停。
     */
    public scheduleUpdate (target: ISchedulable, priority: number, paused: boolean): void {
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }
        const hashElement = this._hashForUpdates[targetId];
        if (hashElement && hashElement.entry) {
            // check if priority has changed
            if (hashElement.entry.priority !== priority) {
                if (this._updateHashLocked) {
                    logID(1506);
                    hashElement.entry.markedForDeletion = false;
                    hashElement.entry.paused = paused;
                    return;
                } else {
                    // will be added again outside if (hashElement).
                    this.unscheduleUpdate(target);
                }
            } else {
                hashElement.entry.markedForDeletion = false;
                hashElement.entry.paused = paused;
                return;
            }
        }

        const listElement = ListEntry.get(target, priority, paused, false);
        let ppList: ListEntry[];

        // most of the updates are going to be 0, that's way there
        // is an special list for updates with priority 0
        if (priority === 0) {
            ppList = this._updates0List;
            this._appendIn(ppList, listElement);
        } else {
            ppList = priority < 0 ? this._updatesNegList : this._updatesPosList;
            this._priorityIn(ppList, listElement, priority);
        }

        // update hash entry for quick access
        this._hashForUpdates[targetId] = HashUpdateEntry.get(ppList, listElement, target, null);
    }

    /**
     * @en
     * Unschedule a callback for a callback and a given target.
     * If you want to unschedule the "update", use `unscheduleUpdate()`
     * @zh
     * 取消指定对象定时器。
     * 如果需要取消 update 定时器，请使用 unscheduleUpdate()。
     * @param callback @en The callback to be unscheduled @zh 被取消调度的回调。
     * @param target @en The target bound to the callback. @zh 回调所绑定的目标对象。
     */
    public unschedule (callback: AnyFunction, target: ISchedulable): void {
        // callback, target

        // explicity handle nil arguments when removing an object
        if (!target || !callback) {
            return;
        }
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }

        const element = this._hashForTimers[targetId];
        if (element) {
            const timers = element.timers;
            if (!timers) {
                return;
            }
            for (let i = 0, li = timers.length; i < li; i++) {
                const timer = timers[i];
                if (callback === timer.getCallback()) {
                    if ((timer === element.currentTimer) && (!element.currentTimerSalvaged)) {
                        element.currentTimerSalvaged = true;
                    }
                    timers.splice(i, 1);
                    CallbackTimer.put(timer);
                    // update timerIndex in case we are in tick;, looping over the actions
                    if (element.timerIndex >= i) {
                        element.timerIndex--;
                    }

                    if (timers.length === 0) {
                        if (this._currentTarget === element) {
                            this._currentTargetSalvaged = true;
                        } else {
                            this._removeHashElement(element);
                        }
                    }
                    return;
                }
            }
        }
    }

    /**
     * @en Unschedule a timer. It is invoked by CallbackTimer when a timer is finished.
     * @param timerToUnschedule The timer to be unscheduled.
     * @param target The target of the timer.
     * @engineInternal
     * @mangle
     */
    public unscheduleForTimer (timerToUnschedule: CallbackTimer, target: ISchedulable): void {
        const targetId = (target.uuid || target.id) as string;
        const element = this._hashForTimers[targetId];
        const timers = element.timers;
        if (!timers || timers.length === 0) {
            return;
        }

        for (let i = timers.length - 1; i >= 0; i--) {
            const timer = timers[i];
            if (timer === timerToUnschedule) {
                timers.splice(i, 1);
                CallbackTimer.put(timer);

                // update timerIndex in case we are in tick;, looping over the actions
                if (element.timerIndex >= i) {
                    element.timerIndex--;
                }

                if (timers.length === 0) {
                    this._currentTargetSalvaged = true;
                }
                return;
            }
        }
    }

    /**
     * @en Unschedule the update callback for a given target.
     * @zh 取消指定对象的 update 定时器。
     * @param target The target to be unscheduled.
     */
    public unscheduleUpdate (target: ISchedulable): void {
        if (!target) {
            return;
        }
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }

        const element = this._hashForUpdates[targetId];
        if (element?.entry) {
            if (this._updateHashLocked) {
                element.entry.markedForDeletion = true;
            } else {
                this._removeUpdateFromHash(element.entry);
            }
        }
    }

    /**
     * @en
     * Unschedule all scheduled callbacks for a given target.
     * This also includes the "update" callback.
     * @zh 取消指定对象的所有定时器，包括 update 定时器。
     * @param target The target to be unscheduled.
     */
    public unscheduleAllForTarget (target: ISchedulable): void {
        // explicit nullptr handling
        if (!target) {
            return;
        }
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }

        // Custom Selectors
        const element = this._hashForTimers[targetId];
        if (element?.timers) {
            const timers = element.timers;
            if (element.currentTimer && timers.indexOf(element.currentTimer) > -1
                && (!element.currentTimerSalvaged)) {
                element.currentTimerSalvaged = true;
            }
            for (let i = 0, l = timers.length; i < l; i++) {
                CallbackTimer.put(timers[i]);
            }
            timers.length = 0;

            if (this._currentTarget === element) {
                this._currentTargetSalvaged = true;
            } else {
                this._removeHashElement(element);
            }
        }

        // update selector
        this.unscheduleUpdate(target);
    }

    /**
     * @en
     * Unschedule all scheduled callbacks from all targets including the system callbacks.
     * You should NEVER call this method, unless you know what you are doing.
     * @zh
     * 取消所有对象的所有定时器，包括系统定时器。
     * 不要调用此函数，除非你确定你在做什么。
     */
    public unscheduleAll (): void {
        this.unscheduleAllWithMinPriority(SystemPriority.SCHEDULER);
    }

    /**
     * @en
     * Unschedule all callbacks from all targets with a minimum priority.
     * You should only call this with `PRIORITY_NON_SYSTEM_MIN` or higher.
     * @zh
     * 取消所有优先级的值大于指定优先级的定时器。
     * 你应该只取消优先级的值大于 PRIORITY_NON_SYSTEM_MIN 的定时器。
     * @param minPriority
     * @en The minimum priority of selector to be unscheduled.
     * Which means, all selectors which priority is higher than minPriority will be unscheduled.
     * @zh 要取消调度的选择器的最低优先级。
     * 这意味着，所有优先级高于 minPriority 的选择器将被取消调度。
     */
    public unscheduleAllWithMinPriority (minPriority: number): void {
        // Custom Selectors
        let i: number;
        let element: HashTimerEntry;
        const arr = this._arrayForTimers;
        for (i = arr.length - 1; i >= 0; i--) {
            element = arr[i];
            if (element.target) {
                this.unscheduleAllForTarget(element.target);
            }
        }

        // Updates selectors
        let entry: ListEntry;
        let temp_length = 0;
        if (minPriority < 0) {
            for (i = 0; i < this._updatesNegList.length;) {
                temp_length = this._updatesNegList.length;
                entry = this._updatesNegList[i];
                if (entry?.target && entry.priority >= minPriority) {
                    this.unscheduleUpdate(entry.target);
                }
                if (temp_length === this._updatesNegList.length) {
                    i++;
                }
            }
        }

        if (minPriority <= 0) {
            for (i = 0; i < this._updates0List.length;) {
                temp_length = this._updates0List.length;
                entry = this._updates0List[i];
                if (entry?.target) {
                    this.unscheduleUpdate(entry.target);
                }
                if (temp_length === this._updates0List.length) {
                    i++;
                }
            }
        }

        for (i = 0; i < this._updatesPosList.length;) {
            temp_length = this._updatesPosList.length;
            entry = this._updatesPosList[i];
            if (entry?.target && entry.priority >= minPriority) {
                this.unscheduleUpdate(entry.target);
            }
            if (temp_length === this._updatesPosList.length) {
                i++;
            }
        }
    }

    /**
     * @en Checks whether a callback for a given target is scheduled.
     * @zh 检查指定的回调函数和回调对象组合是否存在定时器。
     * @param callback @en The callback to check. @zh 指定检测的回调。
     * @param target @en The target of the callback. @zh 回调的目标对象。
     * @returns @en True if the specified callback is invoked, false if not. @zh 返回true如果指定回调被调用, 否则返回false。
     */
    public isScheduled (callback: AnyFunction, target: ISchedulable): boolean {
        // key, target
        // selector, target
        assertID(Boolean(callback), 1508);
        assertID(Boolean(target), 1509);
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return false;
        }

        const element = this._hashForTimers[targetId];

        if (!element) {
            return false;
        }

        if (element.timers == null) {
            return false;
        } else {
            const timers = element.timers;

            for (let i = 0; i < timers.length; ++i) {
                const timer =  timers[i];
                if (callback === timer.getCallback()) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * @en
     * Pause all selectors from all targets.
     * You should NEVER call this method, unless you know what you are doing.
     * @zh
     * 暂停所有对象的所有定时器。
     * 不要调用这个方法，除非你知道你正在做什么。
     */
    public pauseAllTargets (): ISchedulable[] {
        return this.pauseAllTargetsWithMinPriority(SystemPriority.SCHEDULER);
    }

    /**
     * @en
     * Pause all selectors from all targets with a minimum priority.
     * You should only call this with kCCPriorityNonSystemMin or higher.
     * @zh
     * 暂停所有优先级的值大于指定优先级的定时器。
     * 你应该只暂停优先级的值大于 PRIORITY_NON_SYSTEM_MIN 的定时器。
     * @param minPriority @en the minimum priority. @zn 最小优先级。
     */
    public pauseAllTargetsWithMinPriority (minPriority: number): ISchedulable[] {
        const idsWithSelectors: ISchedulable[] = [];

        let element: HashTimerEntry;
        const locArrayForTimers = this._arrayForTimers;
        let i;
        let li;
        // Custom Selectors
        for (i = 0, li = locArrayForTimers.length; i < li; i++) {
            element = locArrayForTimers[i];
            if (element?.target) {
                element.paused = true;
                idsWithSelectors.push(element.target);
            }
        }

        let entry: ListEntry;
        if (minPriority < 0) {
            for (i = 0; i < this._updatesNegList.length; i++) {
                entry = this._updatesNegList[i];
                if (entry?.target) {
                    if (entry.priority >= minPriority) {
                        entry.paused = true;
                        idsWithSelectors.push(entry.target);
                    }
                }
            }
        }

        if (minPriority <= 0) {
            for (i = 0; i < this._updates0List.length; i++) {
                entry = this._updates0List[i];
                if (entry?.target) {
                    entry.paused = true;
                    idsWithSelectors.push(entry.target);
                }
            }
        }

        for (i = 0; i < this._updatesPosList.length; i++) {
            entry = this._updatesPosList[i];
            if (entry?.target) {
                if (entry.priority >= minPriority) {
                    entry.paused = true;
                    idsWithSelectors.push(entry.target);
                }
            }
        }

        return idsWithSelectors;
    }

    /**
     * @en
     * Resume selectors on a set of targets.<br/>
     * This can be useful for undoing a call to pauseAllCallbacks.
     * @zh
     * 恢复指定数组中所有对象的定时器。<br/>
     * 这个函数是 pauseAllCallbacks 的逆操作。
     * @param targetsToResume
     */
    public resumeTargets (targetsToResume: ISchedulable[]): void {
        if (!targetsToResume) {
            return;
        }

        for (let i = 0; i < targetsToResume.length; i++) {
            this.resumeTarget(targetsToResume[i]);
        }
    }

    /**
     * @en
     * Pauses the target.<br/>
     * All scheduled selectors/update for a given target won't be 'ticked' until the target is resumed.<br/>
     * If the target is not present, nothing happens.
     * @zh
     * 暂停指定对象的定时器。<br/>
     * 指定对象的所有定时器都会被暂停。<br/>
     * 如果指定的对象没有定时器，什么也不会发生。
     * @param target
     */
    public pauseTarget (target: ISchedulable): void {
        assertID(Boolean(target), 1503);
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }

        // customer selectors
        const element = this._hashForTimers[targetId];
        if (element) {
            element.paused = true;
        }

        // update callback
        const elementUpdate = this._hashForUpdates[targetId];
        if (elementUpdate?.entry) {
            elementUpdate.entry.paused = true;
        }
    }

    /**
     * @en
     * Resumes the target.<br/>
     * The 'target' will be unpaused, so all schedule selectors/update will be 'ticked' again.<br/>
     * If the target is not present, nothing happens.
     * @zh
     * 恢复指定对象的所有定时器。<br/>
     * 指定对象的所有定时器将继续工作。<br/>
     * 如果指定的对象没有定时器，什么也不会发生。
     * @param target
     */
    public resumeTarget (target: ISchedulable): void {
        assertID(Boolean(target), 1504);
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return;
        }

        // custom selectors
        const element = this._hashForTimers[targetId];
        if (element) {
            element.paused = false;
        }

        // update callback
        const elementUpdate = this._hashForUpdates[targetId];
        if (elementUpdate?.entry) {
            elementUpdate.entry.paused = false;
        }
    }

    /**
     * @en Returns whether or not the target is paused.
     * @zh 返回指定对象的定时器是否处于暂停状态。
     * @param target
     */
    public isTargetPaused (target: ISchedulable): boolean {
        assertID(Boolean(target), 1505);
        const targetId = target.uuid || target.id;
        if (!targetId) {
            errorID(1510);
            return false;
        }

        // Custom selectors
        const element = this._hashForTimers[targetId];
        if (element) {
            return element.paused;
        }
        const elementUpdate = this._hashForUpdates[targetId];
        if (elementUpdate?.entry) {
            return elementUpdate.entry.paused;
        }
        return false;
    }

    // -----------------------private method----------------------
    private _removeHashElement (element: HashTimerEntry): void {
        if (!element.target) {
            return;
        }
        const targetId = element.target.uuid || element.target.id;
        if (typeof targetId === 'undefined') {
            return;
        }
        delete this._hashForTimers[targetId];
        const arr = this._arrayForTimers;
        for (let i = 0, l = arr.length; i < l; i++) {
            if (arr[i] === element) {
                arr.splice(i, 1);
                break;
            }
        }
        HashTimerEntry.put(element);
    }

    private _removeUpdateFromHash (entry: ListEntry): void {
        if (!entry.target) {
            return;
        }
        const targetId = entry.target.uuid || entry.target.id;
        if (typeof targetId === 'undefined') {
            return;
        }
        const element = this._hashForUpdates[targetId];
        if (element) {
            // Remove list entry from list
            const list = element.list;
            const listEntry = element.entry;
            if (list) {
                for (let i = 0, l = list.length; i < l; i++) {
                    if (list[i] === listEntry) {
                        list.splice(i, 1);
                        break;
                    }
                }
            }

            delete this._hashForUpdates[targetId];
            if (listEntry) {
                ListEntry.put(listEntry);
            }
            HashUpdateEntry.put(element);
        }
    }

    private _priorityIn (ppList: ListEntry[], listElement: ListEntry, priority: number): void {
        for (let i = 0; i < ppList.length; i++) {
            if (priority < ppList[i].priority) {
                ppList.splice(i, 0, listElement);
                return;
            }
        }
        ppList.push(listElement);
    }

    private _appendIn (ppList: ListEntry[], listElement: ListEntry): void {
        ppList.push(listElement);
    }
}

legacyCC.Scheduler = Scheduler;
