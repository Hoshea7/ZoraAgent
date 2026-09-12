import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { beforeEach, vi } from "vitest";

type StoreOptions<T> = {
  name?: string;
  defaults?: T;
};

const createBrowserWindowInstance = () => ({
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  close: vi.fn(),
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  webContents: {
    send: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    openDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  },
});

const BrowserWindow = vi.fn(() => createBrowserWindowInstance()) as unknown as {
  (...args: unknown[]): ReturnType<typeof createBrowserWindowInstance>;
  getAllWindows: ReturnType<typeof vi.fn>;
};

BrowserWindow.getAllWindows = vi.fn(() => []);

const app = {
  getPath: vi.fn(() => tmpdir()),
  getAppPath: vi.fn(() => process.cwd()),
  getName: vi.fn(() => "zora-test"),
  getVersion: vi.fn(() => "0.0.0-test"),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  once: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
  setAppUserModelId: vi.fn(),
  commandLine: {
    appendSwitch: vi.fn(),
  },
  dock: {
    setIcon: vi.fn(),
  },
  isPackaged: false,
};

const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
};

const dialog = {
  showErrorBox: vi.fn(),
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
};

const shell = {
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
};

const safeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) =>
    Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8")
  ),
  decryptString: vi.fn((value: Uint8Array) =>
    Buffer.from(Buffer.from(value).toString("utf8"), "base64").toString("utf8")
  ),
};

const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: "system",
  on: vi.fn(),
};

vi.mock("electron", () => ({
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  nativeTheme,
}));

const stores = new Map<string, Map<string, unknown>>();

class MockStore<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly backingStore: Map<string, unknown>;

  constructor(options?: StoreOptions<T>) {
    const key = options?.name ?? "default";
    const existingStore = stores.get(key);
    const nextStore = existingStore ?? new Map<string, unknown>();

    if (!existingStore) {
      if (options?.defaults) {
        for (const [field, value] of Object.entries(options.defaults)) {
          nextStore.set(field, value);
        }
      }
      stores.set(key, nextStore);
    }

    this.backingStore = nextStore;
  }

  get<Value = unknown>(key: string, fallback?: Value): Value | undefined {
    return this.backingStore.has(key)
      ? (this.backingStore.get(key) as Value)
      : fallback;
  }

  set(key: string, value: unknown): void {
    this.backingStore.set(key, value);
  }

  has(key: string): boolean {
    return this.backingStore.has(key);
  }

  delete(key: string): void {
    this.backingStore.delete(key);
  }

  clear(): void {
    this.backingStore.clear();
  }

  get store(): Record<string, unknown> {
    return Object.fromEntries(this.backingStore.entries());
  }
}

vi.mock("electron-store", () => ({
  default: MockStore,
}));

beforeEach(() => {
  stores.clear();
  vi.clearAllMocks();
});
