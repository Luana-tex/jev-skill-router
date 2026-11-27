export class AnalyticsPersistenceError extends Error {
  constructor(readonly code: 'unsafe-storage' | 'schema-incompatible' | 'project-mismatch', message: string) {
    super(message);
  }
}

export function persistenceDiagnostic(error: unknown) {
  if (error instanceof AnalyticsPersistenceError) return error.code;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const sqlite = error && typeof error === 'object' && 'errcode' in error && typeof error.errcode === 'number'
    ? error.errcode & 0xff : undefined;
  if (code === 'EPERM' || code === 'EACCES' || code === 'EROFS' || sqlite === 3 || sqlite === 8) return 'write-denied';
  if (sqlite === 5 || sqlite === 6) return 'database-busy';
  if (sqlite === 11 || sqlite === 26) return 'database-invalid';
  if (code === 'ERR_UNKNOWN_BUILTIN_MODULE') return 'sqlite-unavailable';
  if (code === 'ELOOP' || code === 'EISDIR') return 'unsafe-storage';
  return 'storage-unavailable';
}
