/**
 * 网络同步基础工具
 * 1. 属性复制相关
 *  基础属性复制
 *  数组复制
 *  对象复制
 */

/** 属性变化回调 */
export type ReplicateNotify = (target: any, key: string, value: any) => boolean;
const IsSupportGetSet = false;

/**
 * 属性同步选项
 */
export interface ReplicatedOption {
    /** 要同步的属性名 */
    Name: string;
    /** 应用同步的方法，默认为Name */
    Setter?: string;
    /** 属性同步条件 */
    Condiction?: number;
    /** 同步回调 */
    Notify?: ReplicateNotify;
}

/**
 * 对象属性同步配置
 */
export interface ObjectReplicatedOption {
    /** 指定同步哪些属性 */
    SyncProperty?: ReplicatedOption[];
    /** 指定跳过哪些属性的同步 */
    SkipProperty?: string[];
}

export const REPLICATE_OBJECT_INDEX = "__repObj__";
export const REPLICATE_MARK_INDEX = "__repMrk__";

/**
 * 查询对象的ReplicateObject，检查对象的target.__repObj__字段
 * @param target 要查询的对象
 * @param autoCreator 找不到是否自动创建一个？
 * @returns 返回找到的ReplicateOBject
 */
export function getReplicateObject(target: any, autoCreator: boolean = false): ReplicateObject {
    let ret: ReplicateObject = target[REPLICATE_OBJECT_INDEX];
    if (!ret && autoCreator) {
        ret = new ReplicateObject();
        target[REPLICATE_OBJECT_INDEX] = ret;
    }
    return ret;
}

export function getReplicateMark(target: any): ReplicateMark {
    let ret: ReplicateMark = target[REPLICATE_MARK_INDEX];
    if (!ret) {
        ret = new ReplicateMark();
        target[REPLICATE_MARK_INDEX] = ret;
    }
    return ret;
}

export function makePropertyDescriptor(target: any, propertyKey: string, descriptor: PropertyDescriptor, option?: ReplicatedOption): PropertyDescriptor {
    // 在不影响原来set方法的基础上自动跟踪属性变化
    let realProperty: string;
    if (option && option.Setter) {
        realProperty = option.Setter;
    } else {
        realProperty = propertyKey;
    }
    delete descriptor.value;
    delete descriptor.writable;
    let oldSet = descriptor.set;
    descriptor.set = (v: any) => {
        let repObj = getReplicateObject(target, true);
        // 标记属性发生变化
        repObj.propertyChanged(realProperty, v);
        if (oldSet) {
            oldSet(v);
        }
    }
    // 在不影响原来get方法的基础上，实现set方法的对应操作
    let oldGet = descriptor.get;
    if (!oldGet) {
        descriptor.get = () => {
            let repObj = getReplicateObject(target, true);
            return repObj.getProperty(realProperty);
        }
    }
    return descriptor;
}

/**
 * 将一个对象的指定属性设置为可复制，为对象自动添加__repObj__属性，同时跟踪该属性的变化
 * @param target 要指定的对象
 * @param propertyKey 对象的属性名
 * @param descriptor 属性的描述符
 * @param option 自定义同步选项
 */
export function makePropertyReplicated(target: any, propertyKey: string, descriptor?: PropertyDescriptor, option?: ReplicatedOption) {
    if (!descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
    }
    if (descriptor) {
        // 在不影响原来set方法的基础上自动跟踪属性变化
        let oldValue = descriptor.value;
        if (IsSupportGetSet) {
            descriptor = makePropertyDescriptor(target, propertyKey, descriptor, option);
            Object.defineProperty(target, propertyKey, descriptor);
            // 设置默认值
            if (oldValue !== undefined) {
                target[propertyKey] = oldValue;
            }
        } else {
            getReplicateMark(target).addMark(propertyKey, oldValue, option);
        }
    }
}

/**
 * 将一个对象的所有成员设置为可复制，为对象自动添加__repObj__属性，同时跟踪该属性的变化
 * @param target 
 * @param option 
 */
export function makeObjectReplicated(target: any, option?: ObjectReplicatedOption) {
    if (option && option.SyncProperty) {
        option.SyncProperty.forEach((pOpt) => {
            let descriptor = Object.getOwnPropertyDescriptor(target, pOpt.Name);
            if (descriptor) {
                makePropertyReplicated(target, pOpt.Name, descriptor, pOpt);
            }
        });
    } else {
        let keys = Object.keys(target);
        keys.forEach((key) => {
            if (!(option?.SkipProperty && option.SkipProperty.indexOf(key) >= 0)) {
                makePropertyReplicated(target, key, Object.getOwnPropertyDescriptor(target, key));
            }
        })
    }
}

/**
 * 应用变化
 * @param diff 
 * @param target 
 */
export function applyDiff(diff: any, target: any) {
    let keys = Object.keys(diff);
    keys.forEach((propertyName) => {
        if (typeof target[propertyName] == "function") {
            target[propertyName](diff[propertyName]);
        } else if (diff[propertyName] instanceof Object) {
            if (target[propertyName] instanceof Object) {
                let prop = target[propertyName];
                applyDiff(diff[propertyName], prop);
                target[propertyName] = prop;
            } else {
                console.warn(`apply diff error: ${propertyName}, 
                target.propertyName is ${target[propertyName]} diff ${diff[propertyName]}`);
            }
        } else {
            target[propertyName] = diff[propertyName];
        }
    });
}

export function genDiff(target: any, from: number, to: number): any {
    let repObj = getReplicateObject(target);
    if (!IsSupportGetSet && repObj.getLastVersion() == 0) {
        let markObj = getReplicateMark(target);
        let objOption = markObj.getObjMark();
        if (objOption) {
            makeObjectReplicated(target, objOption);
        }
        let keys = Object.keys(target);
        keys.forEach((propertyName) => {
            let option = markObj.getMark(propertyName);
            if (option) {
                makePropertyReplicated(target, propertyName,
                    Object.getOwnPropertyDescriptor(target, propertyName), option.option);
                // TODO: 比对初值
            }
        });
    }

    return repObj.genDiff(from, to);
}

/**
 * 属性同步装饰器，只能用于修饰属性，不能用于修饰方法
 * @param option 同步选项
 */
export function replicated(option?: ReplicatedOption) {
    // 真正的装饰器
    return (target: any, propertyKey: string, descriptor?: PropertyDescriptor) => {
        makePropertyReplicated(target, propertyKey, descriptor, option);
    };
}

type ClassDecorator = <TFunction extends Function>
    (target: TFunction) => TFunction | void;

type Consturctor = { new(...args: any[]): any };

export function replicatedClass<T extends Consturctor>(option?: ObjectReplicatedOption) {
    return (target: T) => {
        makeObjectReplicated(target, option);
    }
}

interface ReplicateMarkInfo {
    def?: any,
    option?: ReplicatedOption,
}

class ReplicateMark {
    private markMap: Map<string, ReplicateMarkInfo> = new Map<string, ReplicateMarkInfo>();
    private objMark?: ObjectReplicatedOption;

    public addMark(key: string, def?: any, option?: ReplicatedOption) {
        this.markMap.set(key, { def, option });
    }

    public getMark(key: string): ReplicateMarkInfo | undefined {
        return this.markMap.get(key);
    }

    public setObjMark(objMark: ObjectReplicatedOption) {
        this.objMark = objMark;
    }

    public getObjMark(): ObjectReplicatedOption | undefined {
        return this.objMark;
    }
}

/**
 * 一个属性的变化信息
 * changed : 是否有发生过变化
 * version : 该属性的最新版本号
 * data : 该属性的最新数据
 * 
 * 当属性为 :
 * 基础类型 - data为最新的值
 * 结构对象类型 - data为ReplicateObject
 * 数组类型 - data为整个数组对象（每次变化都会全量更新数组）
 * 节点类型 - data为节点的网络唯一ID
 * 组件类型 - data为组件的网络唯一ID
 */
interface ReplicateProperty {
    changed: boolean;
    version: number;
    data: any;
}

/**
 * 负责一个类中所有被标记为replicate的属性的复制和赋值
 * 收集所有增量的变化，并标记版本号
 */
class ReplicateObject {
    private static IsServer: boolean = false;
    /** 最后一个有数据变化的版本号 */
    private lastVersion: number = 0;
    /** 所有发生过变化的数据，属性名 : 变化参数 */
    private dataMap: Map<string, ReplicateProperty> = new Map<string, ReplicateProperty>();
    /** 自上次同步后有无属性发生过变化 */
    private hasNewChange: boolean = false;
    /** outter的ReplicateObject */
    private outter: ReplicateObject | null = null;
    /** 在outter中的属性名 */
    private outterKey: string = "";

    public genProperty(outObject: any, key: string, data: any) {
        outObject[key] = data;
    }

    public getLastVersion(): number {
        return this.lastVersion;
    }

    /**
     * 当一个属性被重新赋值时回调，即 target.key = v时
     * 1. 对比数值是否有发生变化，有则更新dataMap
     * 2. 如果要赋值的是一个可复制对象 v intanceof Rep，设置当前target为v的outter
     * 3. 当属性变化时存在outer
     * 
     * PS: 初始化赋值是否可以跳过？是否可以存着多个outer？
     * @param key 
     * @param v 
     */
    public propertyChanged(key: string, v?: any): void {
        let repPro = this.dataMap.get(key);
        if (repPro) {
            if (v === repPro.data) {
                // 实际的数值并没有发生改变
                return;
            }
            repPro.changed = true;
            if (!(v === undefined && repPro.data instanceof ReplicateObject)) {
                repPro.data = v;
            }
        } else {
            repPro = { version: 0, data: v, changed: false };
            this.dataMap.set(key, repPro);
        }

        // 如果设置了新的对象成员
        if (repPro.data instanceof ReplicateObject) {
            repPro.data.setOutter(this, key);
        }

        // 如果有outter，需要通知，但只通知一次就够了
        // 首次赋值时（初始值，无需通知outter）
        if (!this.hasNewChange && repPro.changed) {
            if (this.outter) {
                this.outter.propertyChanged(this.outterKey);
            }
            this.hasNewChange = true;
        }
    }

    public getProperty(key: string): any {
        let repPro = this.dataMap.get(key);
        return repPro ? repPro.data : repPro;
    }

    public setOutter(outter: ReplicateObject, key: string) {
        this.outter = outter;
        this.outterKey = key;
    }

    /**
     * 生成从fromVersion到toVersion的增量差异包，如果新的变化产生，则最新的变化会标记为toVersion
     * @param fromVersion 
     * @param toVersion 必须是最新的版本号
     */
    public genDiff(fromVersion: number, toVersion: number): any {
        if (toVersion < fromVersion) {
            return false;
        }

        // 没有差异
        if (fromVersion > this.lastVersion && !this.hasNewChange) {
            return false;
        }

        let outObject = {};
        for (let [key, property] of this.dataMap) {
            if (property.changed) {
                property.changed = false;
                property.version = toVersion;
            } else if (property.version < fromVersion) {
                continue;
            }
            if (property.data instanceof ReplicateObject) {
                let diff = property.data.genDiff(fromVersion, toVersion);
                if (diff != false) {
                    this.genProperty(outObject, key, diff);
                }
            } else {
                this.genProperty(outObject, key, property.data);
            }
        }

        this.lastVersion = toVersion;

        return outObject;
    }

    /**
     * 应用差异数据，更新到最新状态
     * @param diff 
     */
    public applyDiff(diff: any) {
        applyDiff(diff, this.outter);
    }
}
