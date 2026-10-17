(function () {
  "use strict";

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  const modesEl = document.getElementById("modes");
  const statusEl = document.getElementById("status");
  const boneReportEl = document.getElementById("boneReport");
  const filePickerEl = document.getElementById("filePicker");
  const verifyEl = document.getElementById("verify");
  const dryRunEl = document.getElementById("dryRun");
  const customFromEl = document.getElementById("customFrom");
  const customToEl = document.getElementById("customTo");
  const historyEl = document.getElementById("history");
  const checklistEl = document.getElementById("checklist");

  let state = {
    isZip: false,
    rawBuffer: null,
    targetFileBuffer: null,
    targetFileName: "",
    originalFullName: "",
    zipEntries: [],
    validEntries: [],
    lastScan: [],
    selectedNames: new Set(),
    dryRun: false,
    lastMode: "head"
  };

  const HISTORY_KEY = "ff_patcher_history_v1";
  const MAX_HISTORY = 5;

  const PATCHES = {
    head: [
      { from: "bone_Hips", to: "bone_Head" },
      { from: "bone_Root", to: "bone_Head" },
      { from: "Bone_Hips", to: "Bone_Head" },
      { from: "Bone_Root", to: "Bone_Head" },
      { from: "bone_Neck", to: "bone_Head" },
      { from: "Bone_Neck", to: "Bone_Head" },
      { from: "Bip001 Hips", to: "Bip001 Head" },
      { from: "Bip001 Root", to: "Bip001 Head" },
      { from: "Bip001 Neck", to: "Bip001 Head" }
    ],
    neck: [
      { from: "bone_Head", to: "bone_Neck" },
      { from: "bone_Hips", to: "bone_Neck" },
      { from: "bone_Root", to: "bone_Neck" },
      { from: "Bone_Head", to: "Bone_Neck" },
      { from: "Bone_Hips", to: "Bone_Neck" },
      { from: "Bone_Root", to: "Bone_Neck" },
      { from: "Bip001 Head", to: "Bip001 Neck" },
      { from: "Bip001 Hips", to: "Bip001 Neck" },
      { from: "Bip001 Root", to: "Bip001 Neck" }
    ],
    drag: [
      { from: "bone_Head", to: "bone_Root" },
      { from: "Bone_Head", to: "Bone_Root" },
      { from: "bone_Hips", to: "bone_Root" },
      { from: "Bone_Hips", to: "Bone_Root" },
      { from: "bone_Neck", to: "bone_Root" },
      { from: "Bone_Neck", to: "Bone_Root" },
      { from: "Bip001 Head", to: "Bip001 Root" },
      { from: "Bip001 Hips", to: "Bip001 Root" },
      { from: "Bip001 Neck", to: "Bip001 Root" }
    ],
    body: [
      { from: "bone_Head", to: "bone_Hips" },
      { from: "bone_Root", to: "bone_Hips" },
      { from: "Bone_Head", to: "Bone_Hips" },
      { from: "Bone_Root", to: "Bone_Hips" },
      { from: "bone_Neck", to: "bone_Hips" },
      { from: "Bone_Neck", to: "Bone_Hips" },
      { from: "Bip001 Head", to: "Bip001 Hips" },
      { from: "Bip001 Root", to: "Bip001 Hips" },
      { from: "Bip001 Neck", to: "Bip001 Hips" }
    ]
  };

  const SCAN_STRINGS = [
    "bone_Head", "bone_Neck", "bone_Spine", "bone_Spine1", "bone_Hips", "bone_Root",
    "Bone_Head", "Bone_Neck", "Bone_Spine", "Bone_Hips", "Bone_Root",
    "Bip001 Head", "Bip001 Neck", "Bip001 Spine", "Bip001 Pelvis", "Bip001 Hips", "Bip001 Root",
    "Head", "Neck", "Spine", "Hips", "Pelvis", "Root"
  ];

  function setStatus(msg, type) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "status" + (type ? " " + type : "");
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Không thể đọc tệp"));
      reader.readAsArrayBuffer(file);
    });
  }

  function encode(str) { return new TextEncoder().encode(str); }

  function findAll(haystack, needle) {
    const positions = [];
    const nLen = needle.length;
    if (nLen === 0 || haystack.length < nLen) return positions;
    outer: for (let i = 0; i <= haystack.length - nLen; i++) {
      for (let j = 0; j < nLen; j++) {
        if (haystack[i + j] !== needle[j]) continue outer;
      }
      positions.push(i);
    }
    return positions;
  }

  function scanBones(buffer) {
    const view = new Uint8Array(buffer);
    const found = [];
    for (const s of SCAN_STRINGS) {
      const count = findAll(view, encode(s)).length;
      if (count > 0) found.push({ name: s, count: count });
    }
    return found.sort((a, b) => b.count - a.count);
  }

  function boneScore(found) {
    let score = 0;
    for (const f of found) score += /bone_|Bip001/i.test(f.name) ? f.count * 10 : f.count;
    return score;
  }

  function hasAimBones(found) {
    return found.some(f =>
      /bone_Head|Bone_Head|Bip001 Head|bone_Neck|Bone_Neck|Bip001 Neck|bone_Hips|Bone_Hips|bone_Root|Bone_Root/i.test(f.name)
    );
  }

  function isUnityFS(u8) {
    return u8.length >= 7 && u8[0] === 0x55 && u8[1] === 0x6e && u8[2] === 0x69 &&
      u8[3] === 0x74 && u8[4] === 0x79 && u8[5] === 0x46 && u8[6] === 0x53;
  }

  const crcTable = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    return table;
  })();

  function calcCRC32(buf) {
    const u8 = new Uint8Array(buf);
    let crc = 0 ^ (-1);
    for (let i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ u8[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }

  async function parseZip(arrayBuffer) {
    const view = new Uint8Array(arrayBuffer);
    const entries = [];
    let i = 0;
    while (i < view.length - 30) {
      if (view[i] === 0x50 && view[i + 1] === 0x4b && view[i + 2] === 0x03 && view[i + 3] === 0x04) {
        const compMethod = view[i + 8] | (view[i + 9] << 8);
        const compSize = (view[i + 18] | (view[i + 19] << 8) | (view[i + 20] << 16) | (view[i + 21] << 24)) >>> 0;
        const uncompSize = (view[i + 22] | (view[i + 23] << 8) | (view[i + 24] << 16) | (view[i + 25] << 24)) >>> 0;
        const nameLen = view[i + 26] | (view[i + 27] << 8);
        const extraLen = view[i + 28] | (view[i + 29] << 8);
        const nameStart = i + 30;
        const name = new TextDecoder().decode(view.slice(nameStart, nameStart + nameLen));
        const dataStart = nameStart + nameLen + extraLen;
        let rawData = null;
        if (compMethod === 0) rawData = view.slice(dataStart, dataStart + uncompSize);
        else if (compMethod === 8 && typeof DecompressionStream !== "undefined") {
          try {
            const compressed = view.slice(dataStart, dataStart + compSize);
            const ds = new DecompressionStream("deflate-raw");
            const stream = new Blob([compressed]).stream().pipeThrough(ds);
            rawData = new Uint8Array(await new Response(stream).arrayBuffer());
          } catch (_) { rawData = null; }
        }
        entries.push({
          name, headerOffset: i, dataStart, compMethod, compSize, uncompSize,
          rawData: rawData ? rawData.buffer : null, isDir: name.endsWith("/")
        });
        i = compSize > 0 ? dataStart + compSize : i + 1;
      } else i++;
    }
    return entries;
  }

  function createZip(files) {
    const parts = [];
    const centralDir = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const data = new Uint8Array(f.buffer);
      const crc = calcCRC32(data);
      const size = data.length;
      const lh = new Uint8Array(30 + nameBytes.length);
      const lhView = new DataView(lh.buffer);
      lhView.setUint32(0, 0x04034b50, true);
      lhView.setUint16(4, 20, true);
      lhView.setUint16(8, 0, true);
      lhView.setUint32(14, crc, true);
      lhView.setUint32(18, size, true);
      lhView.setUint32(22, size, true);
      lhView.setUint16(26, nameBytes.length, true);
      lh.set(nameBytes, 30);
      parts.push(lh, data);
      const cd = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cd.buffer);
      cdView.setUint32(0, 0x02014b50, true);
      cdView.setUint16(4, 20, true);
      cdView.setUint16(6, 20, true);
      cdView.setUint32(16, crc, true);
      cdView.setUint32(20, size, true);
      cdView.setUint32(24, size, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      centralDir.push(cd);
      offset += lh.length + size;
    }
    const cdStart = offset;
    let cdSize = 0;
    for (const cd of centralDir) { parts.push(cd); cdSize += cd.length; }
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, files.length, true);
    eocdView.setUint16(10, files.length, true);
    eocdView.setUint32(12, cdSize, true);
    eocdView.setUint32(16, cdStart, true);
    parts.push(eocd);
    return new Blob(parts, { type: "application/zip" });
  }

  function getPatchList(mode) {
    const list = (PATCHES[mode] || []).slice();
    const cf = (customFromEl && customFromEl.value || "").trim();
    const ct = (customToEl && customToEl.value || "").trim();
    if (cf && ct) {
      if (cf.length !== ct.length) throw new Error("Custom pair: from/to cùng độ dài (" + cf.length + " vs " + ct.length + ")");
      list.push({ from: cf, to: ct });
    }
    return list;
  }

  function applyPatch(buffer, mode) {
    const view = new Uint8Array(buffer.slice(0));
    const list = getPatchList(mode);
    let totalReplaced = 0;
    const detail = {};
    for (const patch of list) {
      const fromBytes = encode(patch.from);
      const toBytes = encode(patch.to);
      if (fromBytes.length !== toBytes.length) continue;
      const positions = findAll(view, fromBytes);
      for (const pos of positions) { view.set(toBytes, pos); totalReplaced++; }
      if (positions.length) detail[patch.from + " → " + patch.to] = positions.length;
    }
    return { buffer: view.buffer, count: totalReplaced, detail };
  }

  function verifyPatch(buffer, mode) {
    const view = new Uint8Array(buffer);
    const list = getPatchList(mode);
    const remaining = {}, present = {};
    for (const patch of list) {
      const fromCount = findAll(view, encode(patch.from)).length;
      const toCount = findAll(view, encode(patch.to)).length;
      if (fromCount > 0) remaining[patch.from] = fromCount;
      if (toCount > 0) present[patch.to] = (present[patch.to] || 0) + toCount;
    }
    return { remaining, present };
  }

  function buildOutputFileName(originalName, mode) {
    const dotIndex = originalName.lastIndexOf(".");
    if (dotIndex === -1) return originalName + "_" + mode;
    const baseName = originalName.substring(0, dotIndex).replace(/_(head|neck|drag|body|lock|dry)$/i, "");
    return baseName + "_" + mode + (state.dryRun ? "_dry" : "") + originalName.substring(dotIndex);
  }

  function triggerDownload(blobOrBuffer, fileName) {
    const blob = blobOrBuffer instanceof Blob ? blobOrBuffer : new Blob([blobOrBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (_) { return []; }
  }

  function saveHistoryEntry(entry) {
    const list = loadHistory().filter(x => x.name !== entry.name);
    list.unshift(entry);
    while (list.length > MAX_HISTORY) list.pop();
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (_) {}
    renderHistory();
  }

  function renderHistory() {
    if (!historyEl) return;
    const list = loadHistory();
    if (!list.length) { historyEl.innerHTML = ""; historyEl.classList.remove("show"); return; }
    historyEl.innerHTML = '<div class="bone-title">Lịch sử</div>' +
      list.map(h => '<div class="hist-row"><span>' + h.name + '</span><span class="muted">' +
        (h.mode || "") + " · " + (h.hits || 0) + " hits</span></div>").join("");
    historyEl.classList.add("show");
  }

  function renderBoneReport(found) {
    if (!boneReportEl) return;
    if (!found.length) {
      boneReportEl.innerHTML = '<div class="warn">Không tìm thấy bone tiêu chuẩn.</div>';
      boneReportEl.classList.add("show"); return;
    }
    boneReportEl.innerHTML = '<div class="bone-title">Bone scan</div>' +
      found.map(f => '<div class="bone-row"><span class="bone-name">' + f.name +
        '</span><span class="bone-count">×' + f.count + "</span></div>").join("");
    boneReportEl.classList.add("show");
  }

  function renderFilePicker(entries, selectedName) {
    if (!filePickerEl || !entries || !entries.length) {
      if (filePickerEl) { filePickerEl.innerHTML = ""; filePickerEl.classList.remove("show"); }
      return;
    }
    state.selectedNames = new Set([selectedName]);
    filePickerEl.innerHTML = '<div class="picker-label">Chọn file trong ZIP</div>' +
      entries.map(e => {
        const sizeKb = e.rawData ? (e.rawData.byteLength / 1024).toFixed(1) : "?";
        const score = boneScore(scanBones(e.rawData));
        const checked = e.name === selectedName ? "checked" : "";
        return '<label class="file-check"><input type="checkbox" data-name="' +
          e.name.replace(/"/g, "&quot;") + '" ' + checked + '/><span class="fc-name">' +
          e.name + '</span><span class="fc-meta">' + sizeKb + " KB · " + score + "</span></label>";
      }).join("");
    filePickerEl.classList.add("show");
    filePickerEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", () => {
        const name = cb.getAttribute("data-name");
        if (cb.checked) state.selectedNames.add(name); else state.selectedNames.delete(name);
        if (state.selectedNames.size === 1) {
          const entry = state.validEntries.find(e => e.name === [...state.selectedNames][0]);
          if (entry && entry.rawData) {
            state.targetFileName = entry.name;
            state.targetFileBuffer = entry.rawData;
            renderBoneReport(scanBones(entry.rawData));
          }
        }
      });
    });
  }

  function renderVerify(result, mode, isDry) {
    if (!verifyEl) return;
    const v = verifyPatch(result.buffer, mode);
    let html = '<div class="verify-title">Verify ' + (isDry ? "(dry-run)" : "") + "</div>";
    html += '<div class="verify-line">Hits: <strong>' + result.count + "</strong></div>";
    if (Object.keys(result.detail).length) {
      html += '<div class="verify-detail">';
      for (const [k, c] of Object.entries(result.detail)) html += "<div>" + k + " ×" + c + "</div>";
      html += "</div>";
    }
    const rk = Object.keys(v.remaining);
    html += rk.length
      ? '<div class="verify-warn">Còn chuỗi cũ: ' + rk.map(k => k + "×" + v.remaining[k]).join(", ") + "</div>"
      : '<div class="verify-ok">Không còn chuỗi nguồn cũ</div>';
    if (isDry) html += '<div class="verify-warn">Dry-run — chưa tải file</div>';
    verifyEl.innerHTML = html;
    verifyEl.classList.add("show");
  }

  function checklistReady() {
    if (!checklistEl) return true;
    const boxes = checklistEl.querySelectorAll('input[type="checkbox"]');
    for (const b of boxes) if (!b.checked) return false;
    return true;
  }

  function buildProxyPinConfig(mode) {
    const modeLabel = mode || "head";
    return {
      name: "FF-Cache-Patcher-" + modeLabel,
      version: "1.2.1",
      enabled: true,
      description: "Template from FF Cache Aim Patcher. Mode: " + modeLabel,
      mode: modeLabel,
      proxyPin: {
        https: true,
        filterDomains: [],
        scripts: [{
          name: "ff-template-" + modeLabel,
          enabled: true,
          url: "*",
          type: "response",
          script: [
            "// ProxyPin template — mode: " + modeLabel,
            "// Edit URL match / body for your config source.",
            "function onResponse(context, url, response) {",
            "  return response;",
            "}"
          ].join("\n")
        }],
        rewrites: [],
        importGuide: [
          "1. Open ProxyPin",
          "2. Scripts / Import → this JSON",
          "3. Enable HTTPS + trust cert if asked",
          "4. Start proxy",
          "5. Open Free Fire"
        ]
      },
      warning: "Template only. Real aim depends on a working ProxyPin script for your FF build."
    };
  }

  function exportProxyPin() {
    let mode = state.lastMode || "head";
    try {
      const hist = loadHistory();
      if (hist[0] && hist[0].mode) mode = hist[0].mode;
    } catch (_) {}
    const cfg = buildProxyPinConfig(mode);
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const name = "proxypin_ff_" + mode + "_" + Date.now() + ".json";
    triggerDownload(blob, name);
    setStatus("Đã xuất ProxyPin: " + name + " · Import trong app ProxyPin", "ok");
  }

  async function handleFile(file) {
    try {
      setStatus("Đang phân tích…");
      [boneReportEl, filePickerEl, verifyEl].forEach(el => {
        if (el) { el.innerHTML = ""; el.classList.remove("show"); }
      });
      modesEl.classList.remove("show");
      if (checklistEl) checklistEl.classList.add("show");

      const buffer = await readFile(file);
      state.originalFullName = file.name;
      state.rawBuffer = buffer;
      const u8 = new Uint8Array(buffer);
      const looksZip = u8[0] === 0x50 && u8[1] === 0x4b;
      const unity = isUnityFS(u8);
      if (unity) setStatus("Cảnh báo: UnityFS", "err");

      if (looksZip && !unity) {
        const entries = await parseZip(buffer);
        const validEntries = entries.filter(e => !e.isDir && e.rawData);
        if (!validEntries.length) throw new Error("ZIP không giải nén được");
        let best = null, bestScore = -1;
        for (const entry of validEntries) {
          const found = scanBones(entry.rawData);
          const score = boneScore(found);
          if (score > bestScore) { bestScore = score; best = { entry, found }; }
        }
        if (!best) {
          validEntries.sort((a, b) => b.uncompSize - a.uncompSize);
          best = { entry: validEntries[0], found: scanBones(validEntries[0].rawData) };
        }
        state.isZip = true;
        state.zipEntries = entries;
        state.validEntries = validEntries;
        state.targetFileName = best.entry.name;
        state.targetFileBuffer = best.entry.rawData;
        state.selectedNames = new Set([best.entry.name]);
        fileNameEl.textContent = file.name + " ➔ [" + best.entry.name + "]";
        renderFilePicker(validEntries, best.entry.name);
        renderBoneReport(best.found);
        setStatus(hasAimBones(best.found) ? "Bone OK" : "Cảnh báo: thiếu bone aim", hasAimBones(best.found) ? "ok" : "err");
        modesEl.classList.add("show");
      } else {
        state.isZip = false;
        state.validEntries = [];
        state.selectedNames = new Set([file.name]);
        state.targetFileName = file.name;
        state.targetFileBuffer = buffer;
        fileNameEl.textContent = file.name + (unity ? " · UnityFS" : "");
        const found = scanBones(buffer);
        renderBoneReport(found);
        setStatus(hasAimBones(found) ? "Bone OK" : "Cảnh báo: thiếu bone", hasAimBones(found) ? "ok" : "err");
        modesEl.classList.add("show");
      }
    } catch (e) {
      setStatus(e.message || "Lỗi", "err");
      modesEl.classList.remove("show");
    }
  }

  async function runMode(mode) {
    if (!state.targetFileBuffer && !state.isZip) return;
    state.lastMode = mode;
    state.dryRun = !!(dryRunEl && dryRunEl.checked);
    if (!state.dryRun && !checklistReady()) {
      setStatus("Tick đủ checklist trước khi xuất cache.", "err");
      return;
    }
    try {
      setStatus(state.dryRun ? "Dry-run…" : "Đang patch…");
      if (state.isZip) {
        const names = state.selectedNames.size ? [...state.selectedNames] : [state.targetFileName];
        let totalHits = 0;
        const allDetail = {}, patchedMap = {};
        for (const name of names) {
          const entry = state.validEntries.find(e => e.name === name);
          if (!entry || !entry.rawData) continue;
          const result = applyPatch(entry.rawData, mode);
          totalHits += result.count;
          for (const [k, v] of Object.entries(result.detail)) allDetail[name + ": " + k] = v;
          patchedMap[name] = result.buffer;
          if (names.length === 1) renderVerify(result, mode, state.dryRun);
        }
        if (totalHits === 0) {
          setStatus('Không có hit cho mode "' + mode + '".', "err");
          return;
        }
        if (names.length > 1) renderVerify({ buffer: state.targetFileBuffer, count: totalHits, detail: allDetail }, mode, state.dryRun);
        if (state.dryRun) {
          setStatus("Dry-run: " + totalHits + " hits", "ok");
          return;
        }
        const packList = [];
        for (const entry of state.zipEntries) {
          if (entry.isDir) continue;
          if (patchedMap[entry.name]) packList.push({ name: entry.name, buffer: patchedMap[entry.name] });
          else if (entry.rawData) packList.push({ name: entry.name, buffer: entry.rawData });
        }
        const outName = buildOutputFileName(state.originalFullName, mode);
        triggerDownload(createZip(packList), outName);
        saveHistoryEntry({ name: state.originalFullName, mode: mode, hits: totalHits, at: new Date().toISOString().slice(0, 16) });
        setStatus("Patch " + totalHits + " ➔ " + outName, "ok");
      } else {
        const result = applyPatch(state.targetFileBuffer, mode);
        renderVerify(result, mode, state.dryRun);
        if (result.count === 0) { setStatus("Không có hit", "err"); return; }
        if (state.dryRun) { setStatus("Dry-run: " + result.count + " hits", "ok"); return; }
        const outName = buildOutputFileName(state.originalFullName, mode);
        triggerDownload(result.buffer, outName);
        saveHistoryEntry({ name: state.originalFullName, mode: mode, hits: result.count, at: new Date().toISOString().slice(0, 16) });
        setStatus("Patch " + result.count + " ➔ " + outName, "ok");
      }
    } catch (err) {
      setStatus(err.message || "Lỗi patch", "err");
    }
  }

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  modesEl.addEventListener("click", e => {
    const btn = e.target.closest(".mode-btn");
    if (!btn) return;
    runMode(btn.dataset.mode);
  });

  const exportBtn = document.getElementById("exportProxyPinBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportProxyPin);

  renderHistory();
})();
