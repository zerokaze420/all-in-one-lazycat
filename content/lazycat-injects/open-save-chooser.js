(function () {
  // SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  // SPDX-License-Identifier: AGPL-3.0-or-later

  // - diskRoot: "/_lzc/files/home"
  //   定义懒猫网盘在当前站点下的文件根路径。脚本读文件和写文件时，最终都是往 fetch(${diskRoot}${path}) 发请求。
  // - pickerTag: "lzc-file-picker"
  //   定义要创建的自定义元素标签名。脚本在需要打开懒猫文件选择器时，会 document.createElement(pickerTag)。
  // - fallbackMime: "application/octet-stream"
  //   当文件类型推断不出来时使用的兜底 MIME type，避免写文件或构造 File 对象时类型为空。
  // - hooks.fileSystemAccess: true
  //   控制是否接管浏览器的 showOpenFilePicker() / showSaveFilePicker()。开着时，会弹“本地 / 懒猫”选择。
  // - hooks.fileInput: true
  //   控制是否接管 <input type="file">。开着时，点文件上传输入框也会走这个桥接逻辑。
  const CONFIG = {
    diskRoot: "/_lzc/files/home",
    pickerTag: "lzc-file-picker",
    fallbackMime: "application/octet-stream",
    hooks: {
      fileSystemAccess: true,
      fileInput: true,
    },
  };

  const HOOK_STATE_KEY = "__lzcOpenSaveChooserHooks";
  const HOOK_STATE = (() => {
    const existing = window[HOOK_STATE_KEY];
    if (existing) {
      existing.choosing ??= false;
      existing.inputChoosing ??= false;
      existing.anchorChoosing ??= false;
      existing.bypassInputClick ??= false;
      existing.bypassAnchorClick ??= false;
      existing.originalShowOpenFilePicker ??=
        window.showOpenFilePicker?.bind(window);
      existing.originalShowSaveFilePicker ??=
        window.showSaveFilePicker?.bind(window);
      existing.originalInputClick ??= HTMLInputElement.prototype.click;
      existing.originalAnchorClick ??= HTMLAnchorElement.prototype.click;
      return existing;
    }

    const state = {
      choosing: false,
      inputChoosing: false,
      anchorChoosing: false,
      bypassInputClick: false,
      bypassAnchorClick: false,
      originalShowOpenFilePicker: window.showOpenFilePicker?.bind(window),
      originalShowSaveFilePicker: window.showSaveFilePicker?.bind(window),
      originalInputClick: HTMLInputElement.prototype.click,
      originalAnchorClick: HTMLAnchorElement.prototype.click,
    };
    window[HOOK_STATE_KEY] = state;
    return state;
  })();

  const STATE = {
    modal: null,
    modalAbort: null,
    hooks: HOOK_STATE,
  };

  const TEXT = {
    openTitle: "打开",
    saveTitle: "保存",
    openLocal: "从本地打开",
    openLazyCat: "从懒猫打开",
    saveLocal: "保存至本地",
    saveLazyCat: "保存至懒猫",
    cancel: "取消",
  };

  const MIME_BY_EXTENSION = {
    avif: "image/avif",
    bmp: "image/bmp",
    csv: "text/csv",
    gif: "image/gif",
    htm: "text/html",
    html: "text/html",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript",
    json: "application/json",
    md: "text/markdown",
    mjs: "text/javascript",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
    webp: "image/webp",
    xml: "application/xml",
    zip: "application/zip",
  };

  const ensureStyles = () => {
    if (document.getElementById("lzc-open-save-chooser-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "lzc-open-save-chooser-style";
    style.textContent = `
      .lzc-open-save-chooser {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.36);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .lzc-open-save-chooser__dialog {
        width: min(360px, calc(100vw - 32px));
        padding: 16px;
        color: #1f2937;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
      }

      .lzc-open-save-chooser__title {
        margin: 0 0 12px;
        font-size: 16px;
        font-weight: 600;
        line-height: 1.4;
      }

      .lzc-open-save-chooser__actions {
        display: grid;
        gap: 8px;
      }

      .lzc-open-save-chooser__button {
        width: 100%;
        min-height: 40px;
        padding: 9px 12px;
        color: #111827;
        background: #f8fafc;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
      }

      .lzc-open-save-chooser__button:hover,
      .lzc-open-save-chooser__button:focus-visible {
        background: #eef2ff;
        border-color: #6366f1;
        outline: none;
      }

      .lzc-open-save-chooser__cancel {
        margin-top: 10px;
        width: 100%;
        min-height: 36px;
        padding: 8px 12px;
        color: #4b5563;
        background: transparent;
        border: 0;
        border-radius: 6px;
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }

      .lzc-open-save-chooser__cancel:hover,
      .lzc-open-save-chooser__cancel:focus-visible {
        background: #f3f4f6;
        outline: none;
      }
    `;
    document.head.appendChild(style);
  };

  const closeModal = () => {
    if (!STATE.modal) {
      return;
    }

    STATE.modal.remove();
    STATE.modal = null;
    STATE.modalAbort = null;
    document.removeEventListener("keydown", onModalKeydown, true);
  };

  function onModalKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      STATE.modalAbort?.();
    }
  }

  const showChoiceModal = ({ title, choices }) =>
    new Promise((resolve, reject) => {
      closeModal();
      ensureStyles();

      const abort = () => {
        closeModal();
        reject(createAbortError());
      };

      const overlay = document.createElement("div");
      overlay.className = "lzc-open-save-chooser";
      overlay.setAttribute("role", "presentation");

      const dialog = document.createElement("div");
      dialog.className = "lzc-open-save-chooser__dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", title);

      const heading = document.createElement("h2");
      heading.className = "lzc-open-save-chooser__title";
      heading.textContent = title;
      dialog.appendChild(heading);

      const actions = document.createElement("div");
      actions.className = "lzc-open-save-chooser__actions";

      for (const choice of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lzc-open-save-chooser__button";
        button.textContent = choice.label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeModal();
          try {
            resolve(choice.onSelect());
          } catch (error) {
            reject(error);
          }
        });
        actions.appendChild(button);
      }

      dialog.appendChild(actions);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "lzc-open-save-chooser__cancel";
      cancel.textContent = TEXT.cancel;
      cancel.addEventListener("click", abort);
      dialog.appendChild(cancel);

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          abort();
        }
      });

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      STATE.modal = overlay;
      STATE.modalAbort = abort;
      document.addEventListener("keydown", onModalKeydown, true);

      const firstAction = overlay.querySelector(
        ".lzc-open-save-chooser__button",
      );
      if (firstAction) {
        firstAction.focus();
      }
    });

  const createAbortError = () => {
    try {
      return new DOMException("The user aborted a request.", "AbortError");
    } catch (error) {
      const abortError = new Error("The user aborted a request.");
      abortError.name = "AbortError";
      return abortError;
    }
  };

  const waitForLazyCatPicker = async () => {
    if (!customElements.get(CONFIG.pickerTag)) {
      await customElements.whenDefined(CONFIG.pickerTag);
    }
  };

  const hasLazyCatPicker = () => Boolean(customElements.get(CONFIG.pickerTag));

  const setPickerProp = (picker, key, value) => {
    if (value !== undefined) {
      picker[key] = value;
    }
  };

  const parsePickerEventDetail = (event) => {
    const detail = Array.isArray(event?.detail)
      ? event.detail
      : [event?.detail];
    return {
      fileList: detail[0],
      source: detail[1],
    };
  };

  const parsePickerStats = (rawFileList) => {
    let fileList = rawFileList;
    if (typeof fileList === "string") {
      try {
        fileList = JSON.parse(fileList);
      } catch (error) {
        throw new Error("Failed to parse LazyCat picker result.");
      }
    }

    if (Array.isArray(fileList)) {
      return fileList.filter(Boolean);
    }

    return [fileList].filter(Boolean);
  };

  const createPicker = async (props = {}) => {
    await waitForLazyCatPicker();

    const picker = document.createElement(CONFIG.pickerTag);
    for (const [key, value] of Object.entries(props)) {
      setPickerProp(picker, key, value);
    }
    picker.style.position = "fixed";
    picker.style.inset = "0";
    picker.style.zIndex = "2147483647";
    document.body.appendChild(picker);

    return picker;
  };

  const statToPath = (stat) => stat?.filename || stat?.basename || "";

  const statToName = (stat) => {
    const filename = statToPath(stat);
    const parts = filename.split("/");
    return parts[parts.length - 1] || stat?.basename || "untitled";
  };

  const getExtension = (name) => {
    const baseName = name.split("/").pop() || name;
    const dotIndex = baseName.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
      return "";
    }
    return baseName.slice(dotIndex + 1).toLowerCase();
  };

  const normalizeExtension = (extension) =>
    String(extension || "")
      .trim()
      .replace(/^\./, "")
      .toLowerCase();

  const joinLazyCatPath = (directoryPath, fileName) => {
    const normalizedDirectory = String(directoryPath || "").trim();
    const normalizedFileName = String(fileName || "")
      .trim()
      .replace(/^\/+/, "");

    if (!normalizedFileName) {
      return normalizedDirectory || "/";
    }
    if (!normalizedDirectory || normalizedDirectory === "/") {
      return `/${normalizedFileName}`;
    }
    return `${normalizedDirectory.replace(/\/+$/, "")}/${normalizedFileName}`;
  };

  const inferAcceptDetails = (options = {}) => {
    const details = {
      mimeTypes: [],
      extensions: [],
      preferredMime: "",
      preferredExtension: "",
    };

    for (const type of options.types || []) {
      for (const [mimeType, extensions] of Object.entries(type.accept || {})) {
        if (mimeType && mimeType !== "*/*" && !mimeType.endsWith("/*")) {
          details.mimeTypes.push(mimeType);
        }

        for (const extension of extensions || []) {
          const normalized = normalizeExtension(extension);
          if (normalized) {
            details.extensions.push(normalized);
          }
        }
      }
    }

    details.preferredMime = details.mimeTypes[0] || "";
    details.preferredExtension = details.extensions[0] || "";
    return details;
  };

  const toPickerFilterString = (values) => {
    const seen = new Set();
    const normalizedValues = [];

    for (const value of values) {
      const normalized = String(value || "").trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      normalizedValues.push(normalized);
    }

    return normalizedValues.length ? normalizedValues.join(",") : undefined;
  };

  const pickerFiltersFromOptions = (options = {}) => {
    const mimeTypes = [];
    const extensions = [];

    for (const type of options.types || []) {
      for (const [mimeType, acceptedExtensions] of Object.entries(
        type.accept || {},
      )) {
        if (mimeType && mimeType !== "*/*") {
          mimeTypes.push(mimeType);
        }

        for (const extension of acceptedExtensions || []) {
          const normalized = normalizeExtension(extension);
          if (normalized) {
            extensions.push(normalized);
          }
        }
      }
    }

    return {
      accept: toPickerFilterString(mimeTypes),
      extname: toPickerFilterString(extensions),
    };
  };

  const optionsFromInputAccept = (accept) => {
    const mimeAccept = {};
    const extensionAccept = [];

    for (const value of accept
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      if (value.startsWith(".")) {
        extensionAccept.push(value);
        continue;
      }

      mimeAccept[value] = [];
    }

    if (extensionAccept.length) {
      mimeAccept["*/*"] = extensionAccept;
    }

    return Object.keys(mimeAccept).length
      ? {
          types: [
            {
              accept: mimeAccept,
            },
          ],
        }
      : {};
  };

  const pickerFiltersFromInputAccept = (accept) => {
    const mimeTypes = [];
    const extensions = [];

    for (const value of String(accept || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      if (value.startsWith(".")) {
        const normalized = normalizeExtension(value);
        if (normalized) {
          extensions.push(normalized);
        }
        continue;
      }

      mimeTypes.push(value);
    }

    return {
      accept: toPickerFilterString(mimeTypes),
      extname: toPickerFilterString(extensions),
    };
  };

  const inferMimeFromFileName = (name, acceptDetails = {}) => {
    const extension = getExtension(name);
    if (!extension) {
      return "";
    }

    for (const type of acceptDetails.mimeTypes || []) {
      const accept = (acceptDetails.options?.types || []).find(
        (item) => item.accept?.[type],
      );
      const extensions = accept?.accept?.[type] || [];
      if (
        extensions.some(
          (candidate) => normalizeExtension(candidate) === extension,
        )
      ) {
        return type;
      }
    }

    return MIME_BY_EXTENSION[extension] || "";
  };

  const chooseMimeType = ({ blob, fileName, options }) => {
    const acceptDetails = inferAcceptDetails(options);
    return (
      blob?.type ||
      inferMimeFromFileName(fileName, {
        ...acceptDetails,
        options,
      }) ||
      acceptDetails.preferredMime ||
      CONFIG.fallbackMime
    );
  };

  const removeTrailingDot = (value) =>
    typeof value === "string" && value.endsWith(".")
      ? value.slice(0, -1)
      : value;

  const normalizeLazyCatSaveStat = (stat) => {
    if (!stat || typeof stat !== "object") {
      return stat;
    }

    return {
      ...stat,
      filename: removeTrailingDot(stat.filename),
      basename: removeTrailingDot(stat.basename),
    };
  };

  const readLazyCatFile = async (path) => {
    const response = await fetch(`${CONFIG.diskRoot}${path}`);
    if (!response.ok) {
      throw new Error(`Failed to read LazyCat file: ${response.status}`);
    }
    return response.blob();
  };

  const writeLazyCatFile = async ({ path, chunks, mimeType }) => {
    const blob = new Blob(chunks, {
      type: mimeType || CONFIG.fallbackMime,
    });
    const response = await fetch(`${CONFIG.diskRoot}${path}`, {
      method: "PUT",
      headers: {
        "content-type": blob.type || CONFIG.fallbackMime,
      },
      body: blob,
    });
    if (!response.ok) {
      throw new Error(`Failed to write LazyCat file: ${response.status}`);
    }
  };

  const createLazyCatOpenHandle = (stat, options) => {
    const path = statToPath(stat);
    const name = statToName(stat);

    return {
      kind: "file",
      name,
      async getFile() {
        const blob = await readLazyCatFile(path);
        return new File([blob], name, {
          type: chooseMimeType({ blob, fileName: name, options }),
          lastModified: Date.now(),
        });
      },
      async isSameEntry(other) {
        return Boolean(other && other.__lazyCatPath === path);
      },
      __lazyCatPath: path,
    };
  };

  const createLazyCatSaveHandle = (stat, options) => {
    const path = statToPath(stat);
    const name = statToName(stat);

    return {
      kind: "file",
      name,
      async getFile() {
        const blob = await readLazyCatFile(path);
        return new File([blob], name, {
          type: chooseMimeType({ blob, fileName: name, options }),
          lastModified: Date.now(),
        });
      },
      async createWritable() {
        const chunks = [];
        let writtenMimeType = "";

        const writeChunk = async (data) => {
          if (data && typeof data === "object" && "type" in data) {
            if (data.type === "seek") {
              return;
            }
            if (data.type === "truncate") {
              chunks.length = 0;
              return;
            }
            if (data.type === "write") {
              data = data.data;
            }
          }

          if (data?.type) {
            writtenMimeType = data.type;
          }
          chunks.push(data);
        };

        const stream = new WritableStream({
          write: writeChunk,
          async close() {
            await writeLazyCatFile({
              path,
              chunks,
              mimeType: chooseMimeType({
                blob: writtenMimeType ? { type: writtenMimeType } : null,
                fileName: name,
                options,
              }),
            });
          },
          async abort() {
            chunks.length = 0;
          },
        });

        stream.write = async (data) => {
          const writer = stream.getWriter();
          try {
            await writer.write(data);
          } finally {
            writer.releaseLock();
          }
        };
        stream.close = async () => {
          const writer = stream.getWriter();
          try {
            await writer.close();
          } finally {
            writer.releaseLock();
          }
        };
        stream.abort = async (reason) => {
          const writer = stream.getWriter();
          try {
            await writer.abort(reason);
          } finally {
            writer.releaseLock();
          }
        };

        return stream;
      },
      async isSameEntry(other) {
        return Boolean(other && other.__lazyCatPath === path);
      },
      __lazyCatPath: path,
    };
  };

  const runLazyCatPicker = async (props = {}) => {
    if (!hasLazyCatPicker()) {
      throw new Error("LazyCat picker is unavailable.");
    }

    const picker = await createPicker({
      isModal: true,
      ...props,
    });

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        picker.remove();
      };

      picker.addEventListener(
        "submit",
        (event) => {
          try {
            const { fileList, source } = parsePickerEventDetail(event);
            const stats = parsePickerStats(fileList);
            cleanup();
            resolve({ stats, source });
          } catch (error) {
            cleanup();
            reject(error);
          }
        },
        { once: true },
      );

      picker.addEventListener(
        "close",
        () => {
          cleanup();
          reject(createAbortError());
        },
        { once: true },
      );
    });
  };

  const openLazyCatFilePicker = async (options = {}) => {
    const { stats } = await runLazyCatPicker({
      type: "file",
      title: TEXT.openLazyCat,
      multiple: !!options.multiple,
      choiceFileOnly: true,
      ...pickerFiltersFromOptions(options),
    });
    const handles = stats.map((stat) => createLazyCatOpenHandle(stat, options));
    return options?.multiple ? handles : [handles[0]].filter(Boolean);
  };

  const openLazyCatSavePicker = async (options = {}) => {
    const { stats } = await runLazyCatPicker({
      type: "saveAs",
      title: TEXT.saveLazyCat,
      choiceDirOnly: true,
    });
    const rawStat = stats[0];
    if (!rawStat) {
      throw createAbortError();
    }

    const targetPath = statToPath(rawStat);
    const saveName = removeTrailingDot(rawStat.saveName);
    const stat = normalizeLazyCatSaveStat({
      ...rawStat,
      basename: saveName || rawStat.basename,
      filename: saveName ? joinLazyCatPath(targetPath, saveName) : targetPath,
      type: "file",
    });

    return createLazyCatSaveHandle(stat, options);
  };

  const chooseOpenTarget = (options) =>
    hasLazyCatPicker()
      ? showChoiceModal({
          title: TEXT.openTitle,
          choices: [
            {
              label: TEXT.openLocal,
              onSelect: () => STATE.hooks.originalShowOpenFilePicker(options),
            },
            {
              label: TEXT.openLazyCat,
              onSelect: () => openLazyCatFilePicker(options),
            },
          ],
        })
      : STATE.hooks.originalShowOpenFilePicker(options);

  const chooseSaveTarget = (options) =>
    hasLazyCatPicker()
      ? showChoiceModal({
          title: TEXT.saveTitle,
          choices: [
            {
              label: TEXT.saveLocal,
              onSelect: () => STATE.hooks.originalShowSaveFilePicker(options),
            },
            {
              label: TEXT.saveLazyCat,
              onSelect: () => openLazyCatSavePicker(options),
            },
          ],
        })
      : STATE.hooks.originalShowSaveFilePicker(options);

  const isDownloadAnchor = (anchor) =>
    anchor instanceof HTMLAnchorElement &&
    Boolean(anchor.download) &&
    anchor.href.startsWith("blob:");

  const saveDownloadAnchorToLazyCat = async (anchor) => {
    const response = await fetch(anchor.href);
    if (!response.ok) {
      throw new Error(`Failed to read download blob: ${response.status}`);
    }

    const blob = await response.blob();
    const handle = await openLazyCatSavePicker();
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    URL.revokeObjectURL(anchor.href);
  };

  const chooseDownloadTarget = (anchor) =>
    hasLazyCatPicker()
      ? showChoiceModal({
          title: TEXT.saveTitle,
          choices: [
            {
              label: TEXT.saveLocal,
              onSelect: () => STATE.hooks.originalAnchorClick.call(anchor),
            },
            {
              label: TEXT.saveLazyCat,
              onSelect: () => saveDownloadAnchorToLazyCat(anchor),
            },
          ],
        })
      : STATE.hooks.originalAnchorClick.call(anchor);

  const getFileInputFromEventTarget = (target) => {
    const element = target instanceof Element ? target : null;
    if (!element) {
      return null;
    }

    const input = element.closest?.("input[type='file']");
    if (input instanceof HTMLInputElement) {
      return input;
    }

    const label = element.closest?.("label");
    if (!label) {
      return null;
    }

    if (
      label.control instanceof HTMLInputElement &&
      label.control.type === "file"
    ) {
      return label.control;
    }

    return null;
  };

  const createInputFiles = async (stats, input) => {
    const dataTransfer = new DataTransfer();
    const selectedStats = input.multiple ? stats : stats.slice(0, 1);
    const options = input.accept ? optionsFromInputAccept(input.accept) : {};

    for (const stat of selectedStats) {
      const path = statToPath(stat);
      const name = statToName(stat);
      const blob = await readLazyCatFile(path);
      dataTransfer.items.add(
        new File([blob], name, {
          type: chooseMimeType({ blob, fileName: name, options }),
          lastModified: Date.now(),
        }),
      );
    }

    return dataTransfer.files;
  };

  const openLazyCatInputPicker = async (input) => {
    const { stats } = await runLazyCatPicker({
      type: "file",
      title: TEXT.openLazyCat,
      multiple: !!input.multiple,
      choiceFileOnly: true,
      ...pickerFiltersFromInputAccept(input.accept),
    });
    input.files = await createInputFiles(stats, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const chooseInputTarget = (input) =>
    hasLazyCatPicker()
      ? showChoiceModal({
          title: TEXT.openTitle,
          choices: [
            {
              label: TEXT.openLocal,
              onSelect: () => {
                STATE.hooks.bypassInputClick = true;
                try {
                  STATE.hooks.originalInputClick.call(input);
                } finally {
                  STATE.hooks.bypassInputClick = false;
                }
              },
            },
            {
              label: TEXT.openLazyCat,
              onSelect: () => openLazyCatInputPicker(input),
            },
          ],
        })
      : (() => {
          STATE.hooks.bypassInputClick = true;
          try {
            return STATE.hooks.originalInputClick.call(input);
          } finally {
            STATE.hooks.bypassInputClick = false;
          }
        })();

  const shouldUseNativeFileInput = (input) =>
    STATE.hooks.bypassInputClick ||
    input.type !== "file" ||
    input.webkitdirectory ||
    !hasLazyCatPicker();

  const shouldUseNativeDownloadAnchor = (anchor) =>
    STATE.hooks.bypassAnchorClick || !isDownloadAnchor(anchor) || !hasLazyCatPicker();

  const interceptFileInput = async (input) => {
    if (shouldUseNativeFileInput(input)) {
      return false;
    }
    if (STATE.hooks.inputChoosing) {
      return true;
    }

    STATE.hooks.inputChoosing = true;
    try {
      await chooseInputTarget(input);
    } catch (error) {
      if (error?.name !== "AbortError") {
        throw error;
      }
    } finally {
      STATE.hooks.inputChoosing = false;
    }
    return true;
  };

  const interceptFileInputSilently = (input) => {
    interceptFileInput(input).catch((error) => {
      if (error?.name !== "AbortError") {
        console.error("LazyCat file input picker failed.", error);
      }
    });
  };

  const interceptDownloadAnchor = async (anchor) => {
    if (shouldUseNativeDownloadAnchor(anchor)) {
      return false;
    }
    if (STATE.hooks.anchorChoosing) {
      return true;
    }

    STATE.hooks.anchorChoosing = true;
    try {
      await chooseDownloadTarget(anchor);
    } catch (error) {
      if (error?.name !== "AbortError") {
        throw error;
      }
    } finally {
      STATE.hooks.anchorChoosing = false;
    }
    return true;
  };

  const interceptDownloadAnchorSilently = (anchor) => {
    interceptDownloadAnchor(anchor).catch((error) => {
      if (error?.name !== "AbortError") {
        console.error("LazyCat download picker failed.", error);
      }
    });
  };

  const installFilePickerHooks = () => {
    if (
      CONFIG.hooks.fileSystemAccess &&
      STATE.hooks.originalShowOpenFilePicker &&
      !window.showOpenFilePicker?.__lzcHooked
    ) {
      const hookedShowOpenFilePicker = async (options) => {
        if (STATE.hooks.choosing) {
          return STATE.hooks.originalShowOpenFilePicker(options);
        }

        STATE.hooks.choosing = true;
        try {
          return await chooseOpenTarget(options);
        } finally {
          STATE.hooks.choosing = false;
        }
      };
      hookedShowOpenFilePicker.__lzcHooked = true;
      window.showOpenFilePicker = hookedShowOpenFilePicker;
    }

    if (
      CONFIG.hooks.fileSystemAccess &&
      STATE.hooks.originalShowSaveFilePicker &&
      !window.showSaveFilePicker?.__lzcHooked
    ) {
      const hookedShowSaveFilePicker = async (options) => {
        if (STATE.hooks.choosing) {
          return STATE.hooks.originalShowSaveFilePicker(options);
        }

        STATE.hooks.choosing = true;
        try {
          return await chooseSaveTarget(options);
        } finally {
          STATE.hooks.choosing = false;
        }
      };
      hookedShowSaveFilePicker.__lzcHooked = true;
      window.showSaveFilePicker = hookedShowSaveFilePicker;
    }
  };

  const installFileInputHooks = () => {
    if (
      !CONFIG.hooks.fileInput ||
      HTMLInputElement.prototype.click.__lzcHooked
    ) {
      return;
    }

    const hookedClick = function () {
      if (this instanceof HTMLInputElement && this.type === "file") {
        if (shouldUseNativeFileInput(this)) {
          return STATE.hooks.originalInputClick.call(this);
        }
        interceptFileInputSilently(this);
        return;
      }

      return STATE.hooks.originalInputClick.call(this);
    };
    hookedClick.__lzcHooked = true;
    HTMLInputElement.prototype.click = hookedClick;

    document.addEventListener(
      "click",
      (event) => {
        const input = getFileInputFromEventTarget(event.target);
        if (!input || shouldUseNativeFileInput(input)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        interceptFileInputSilently(input);
      },
      true,
    );
  };

  const installDownloadAnchorHooks = () => {
    if (HTMLAnchorElement.prototype.click.__lzcHooked) {
      return;
    }

    const hookedClick = function () {
      if (isDownloadAnchor(this)) {
        if (shouldUseNativeDownloadAnchor(this)) {
          return STATE.hooks.originalAnchorClick.call(this);
        }
        interceptDownloadAnchorSilently(this);
        return;
      }

      return STATE.hooks.originalAnchorClick.call(this);
    };
    hookedClick.__lzcHooked = true;
    HTMLAnchorElement.prototype.click = hookedClick;
  };

  installFilePickerHooks();
  installFileInputHooks();
  installDownloadAnchorHooks();
})();
