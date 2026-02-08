/**
 * Adapter interfaces for platform-agnostic filesystem, git, and locking operations.
 */

export type {
  FileSystemAdapter,
  FilesystemAdapter,
  GitAdapter,
  WorktreeInfo,
  PathLock,
  LockInfo,
  AcquireOptions,
} from './types';

export { AsyncFileSystemAdapter } from './async-wrapper';

export { NodeFileSystemAdapter } from './node/fs-adapter';
