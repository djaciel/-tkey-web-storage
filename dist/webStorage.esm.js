import _defineProperty from '@babel/runtime/helpers/defineProperty';
import { TkeyError, ShareStore, prettyPrintError } from '@tkey/common-types';
import BN from 'bn.js';

class WebStorageError extends TkeyError {
  constructor(code, message) {
    // takes care of stack and proto
    super(code, message);
    // Set name explicitly as minification can mangle class names
    Object.defineProperty(this, "name", {
      value: "WebStorageError"
    });
  }
  static fromCode(code) {
    let extraMessage = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : "";
    return new WebStorageError(code, `${WebStorageError.messages[code]}${extraMessage}`);
  }
  static default() {
    let extraMessage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : "";
    return new WebStorageError(3000, `${WebStorageError.messages[3000]}${extraMessage}`);
  }
  // Custom methods
  static unableToReadFromStorage() {
    let extraMessage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : "";
    return WebStorageError.fromCode(3101, extraMessage);
  }
  static shareUnavailableInFileStorage() {
    let extraMessage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : "";
    return WebStorageError.fromCode(3201, extraMessage);
  }
  static fileStorageUnavailable() {
    let extraMessage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : "";
    return WebStorageError.fromCode(3202, extraMessage);
  }
  static localStorageUnavailable() {
    let extraMessage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : "";
    return WebStorageError.fromCode(3301, extraMessage);
  }
  static shareUnavailableInLocalStorage() {
    let extraMessage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : "";
    return WebStorageError.fromCode(3302, extraMessage);
  }
}
_defineProperty(WebStorageError, "messages", {
  3000: "default",
  // module
  3101: "unableToReadFromStorage",
  // fileStorage
  3201: "No Share exists in file system",
  3202: "No requestFileSystem",
  // localstorage
  3301: "Local storage is not enabled",
  3302: "No share exists in localstorage"
});

function getWindow() {
  if (typeof window !== "undefined") return window;
  if (typeof self !== "undefined") return self;
  throw new Error("Unable to locate window object.");
}

// Web Specific declarations
const requestedBytes = 1024 * 1024 * 10; // 10MB
function download(filename, text) {
  const element = document.createElement("a");
  element.setAttribute("href", `data:application/json;charset=utf-8,${encodeURIComponent(text)}`);
  element.setAttribute("download", filename);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}
async function requestQuota() {
  return new Promise((resolve, reject) => {
    navigator.webkitPersistentStorage.requestQuota(requestedBytes, resolve, reject);
  });
}
async function browserRequestFileSystem(grantedBytes) {
  return new Promise((resolve, reject) => {
    const win = getWindow();
    win.requestFileSystem = win.requestFileSystem || win.webkitRequestFileSystem;
    win.requestFileSystem(win.PERSISTENT, grantedBytes, resolve, reject);
  });
}
async function getFile(fs, path, create) {
  return new Promise((resolve, reject) => {
    fs.root.getFile(path, {
      create
    }, data => resolve(data), reject);
  });
}
async function readFile(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}
const getShareFromFileStorage = async key => {
  const win = getWindow();
  win.requestFileSystem = win.requestFileSystem || win.webkitRequestFileSystem;
  if (win.requestFileSystem) {
    const fs = await browserRequestFileSystem(requestedBytes);
    const fileEntry = await getFile(fs, key, false);
    const file = await readFile(fileEntry);
    const fileStr = await file.text();
    if (!fileStr) {
      throw WebStorageError.shareUnavailableInFileStorage();
    }
    return ShareStore.fromJSON(JSON.parse(fileStr));
  }
  throw WebStorageError.fileStorageUnavailable();
};
const storeShareOnFileStorage = async (share, key) => {
  // if we're on chrome (thus window.requestFileSystem exists) we use it
  const fileName = `${key}.json`;
  const fileStr = JSON.stringify(share);
  const win = getWindow();
  win.requestFileSystem = win.requestFileSystem || win.webkitRequestFileSystem;
  if (win.requestFileSystem) {
    const grantedBytes = await requestQuota();
    const fs = await browserRequestFileSystem(grantedBytes);
    const fileEntry = await getFile(fs, key, true);
    await new Promise((resolve, reject) => {
      fileEntry.createWriter(fileWriter => {
        fileWriter.onwriteend = resolve;
        fileWriter.onerror = reject;
        const bb = new Blob([fileStr], {
          type: "application/json"
        });
        fileWriter.write(bb);
      }, reject);
    });
  } else {
    // we make the user download a file
    download(fileName, fileStr);
  }
};
const canAccessFileStorage = async () => navigator.permissions.query({
  name: "persistent-storage"
});

const win = getWindow();
function storageAvailable(type) {
  let storage;
  try {
    storage = win[type];
    const x = "__storage_test__";
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return e instanceof DOMException && (
    // everything except Firefox
    e.code === 22 ||
    // Firefox
    e.code === 1014 ||
    // test name field too, because code might not be present
    // everything except Firefox
    e.name === "QuotaExceededError" ||
    // Firefox
    e.name === "NS_ERROR_DOM_QUOTA_REACHED") &&
    // acknowledge QuotaExceededError only if there's something already stored
    storage && storage.length !== 0;
  }
}
const storeShareOnLocalStorage = async (share, key) => {
  const fileStr = JSON.stringify(share);
  if (!storageAvailable("localStorage")) {
    throw WebStorageError.localStorageUnavailable();
  }
  win.localStorage.setItem(key, fileStr);
};
const getShareFromLocalStorage = async key => {
  if (!storageAvailable("localStorage")) {
    throw WebStorageError.localStorageUnavailable();
  }
  const foundFile = win.localStorage.getItem(key);
  if (!foundFile) throw WebStorageError.shareUnavailableInLocalStorage();
  return ShareStore.fromJSON(JSON.parse(foundFile));
};

const WEB_STORAGE_MODULE_NAME = "webStorage";
class WebStorageModule {
  constructor() {
    let canUseFileStorage = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
    _defineProperty(this, "moduleName", void 0);
    _defineProperty(this, "tbSDK", void 0);
    _defineProperty(this, "canUseFileStorage", void 0);
    this.moduleName = WEB_STORAGE_MODULE_NAME;
    this.canUseFileStorage = canUseFileStorage;
    this.setFileStorageAccess();
  }
  async setFileStorageAccess() {
    try {
      const result = await canAccessFileStorage();
      if (result.state === "denied") {
        this.canUseFileStorage = false;
      } else if (result.state === "granted") {
        this.canUseFileStorage = true;
      }
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      result.onchange = function permissionChange() {
        if (this.state === "denied") {
          self.canUseFileStorage = false;
        } else if (this.state === "granted") {
          self.canUseFileStorage = true;
        }
      };
    } catch (error) {}
  }
  setModuleReferences(tbSDK) {
    this.tbSDK = tbSDK;
    this.tbSDK._setDeviceStorage(this.storeDeviceShare.bind(this));
  }
  // eslint-disable-next-line
  async initialize() {}
  async storeDeviceShare(deviceShareStore, customDeviceInfo) {
    const metadata = this.tbSDK.getMetadata();
    const tkeypubx = metadata.pubKey.x.toString("hex");
    await storeShareOnLocalStorage(deviceShareStore, tkeypubx);
    const shareDescription = {
      module: this.moduleName,
      userAgent: navigator.userAgent,
      dateAdded: Date.now()
    };
    if (customDeviceInfo) {
      shareDescription.customDeviceInfo = JSON.stringify(customDeviceInfo);
    }
    await this.tbSDK.addShareDescription(deviceShareStore.share.shareIndex.toString("hex"), JSON.stringify(shareDescription), true);
  }
  async storeDeviceShareOnFileStorage(shareIndex) {
    const metadata = this.tbSDK.getMetadata();
    const tkeypubx = metadata.pubKey.x.toString("hex");
    const shareStore = this.tbSDK.outputShareStore(new BN(shareIndex));
    return storeShareOnFileStorage(shareStore, tkeypubx);
  }
  async getDeviceShare() {
    const metadata = this.tbSDK.getMetadata();
    const tkeypubx = metadata.pubKey.x.toString("hex");
    let shareStore;
    try {
      shareStore = await getShareFromLocalStorage(tkeypubx);
    } catch (localErr) {
      if (this.canUseFileStorage) {
        try {
          shareStore = await getShareFromFileStorage(tkeypubx);
        } catch (fileErr) {
          var _fileErr$message;
          if (fileErr !== null && fileErr !== void 0 && (_fileErr$message = fileErr.message) !== null && _fileErr$message !== void 0 && _fileErr$message.includes("storage quota")) {
            // User has denied access to storage. stop asking for every share
            this.canUseFileStorage = false;
          }
          throw WebStorageError.unableToReadFromStorage(`Error inputShareFromWebStorage: ${prettyPrintError(localErr)} and ${prettyPrintError(fileErr)}`);
        }
      }
      throw WebStorageError.unableToReadFromStorage(`Error inputShareFromWebStorage: ${prettyPrintError(localErr)}`);
    }
    return shareStore;
  }
  async inputShareFromWebStorage() {
    const shareStore = await this.getDeviceShare();
    let latestShareStore = shareStore;
    const metadata = this.tbSDK.getMetadata();
    if (metadata.getLatestPublicPolynomial().getPolynomialID() !== shareStore.polynomialID) {
      latestShareStore = (await this.tbSDK.catchupToLatestShare({
        shareStore,
        includeLocalMetadataTransitions: true
      })).latestShare;
      const tkeypubx = metadata.pubKey.x.toString("hex");
      await storeShareOnLocalStorage(latestShareStore, tkeypubx);
    }
    this.tbSDK.inputShareStore(latestShareStore);
  }
}

export { WEB_STORAGE_MODULE_NAME, WebStorageError, WebStorageModule, canAccessFileStorage, WebStorageModule as default, getShareFromFileStorage, getShareFromLocalStorage, storeShareOnFileStorage, storeShareOnLocalStorage };
//# sourceMappingURL=webStorage.esm.js.map
