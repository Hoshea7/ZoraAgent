export const SESSION_IPC = {
  LIST: "session:list",
  LIST_ARCHIVED: "session:list-archived",
  CREATE: "session:create",
  FORK: "session:fork",
  DELETE: "session:delete",
  ARCHIVE: "session:archive",
  RESTORE: "session:restore",
  RENAME: "session:rename",
  LOAD_MESSAGES: "session:load-messages",
  LOCK_MODEL: "session:lock-model",
  SWITCH_MODEL: "session:switch-model",
  SET_RUNTIME: "session:set-runtime",
} as const;
