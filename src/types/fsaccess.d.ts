/**
 * FSA 权限 API 类型补充（TS lib.dom 尚未收录 queryPermission/requestPermission）。
 * Chrome 109+ 恒定提供，声明为必有方法。
 */
export {};

declare global {
  interface FileSystemHandle {
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}
