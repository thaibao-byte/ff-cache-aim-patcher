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

  let state = {
    isZip: false,
    rawBuffer: null,
    targetFileBuffer: null,
    targetFileName: "",
    originalFullName: "",
    zipEntries: [],
    validEntries: [],
    lastScan: []
  };

  // QUY TẮC CỐT LÕI: from.length PHẢI BẰNG to.length
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

  function encode(str) {
    return new TextEncoder().encode(str);
  }

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
      const bytes = encode(s);
      const count = findAll(view, bytes).length;
      if (count > 0) found.push({ name: s, count: count });
    }
    return found.sort((a, b) => b.count - a.count);
  }

  function boneScore(found) {
    let score = 0;
    for (const f of found) {
      if (/bone_|Bip001/i.test(f.name)) score += f.count * 10;
      else score += f.count;
    }
    return score;
  }

  function hasAimBones(found) {
    const names = found.map(f => f.name);
    return names.some(n =>
      /bone_Head|Bone_Head|Bip001 Head|bone_Neck|Bone_Neck|Bip001 Neck|bone_Hips|Bone_Hips|bone_Root|Bone_Root/i.test(n)
    );
  }

  function isUnityFS(u8) {
    return u8.length >= 7 &&
      u8[0] === 0x55 && u8[1] === 0x6e && u8[2] === 0x69 &&
      u8[3] === 0x74 && u8[4] === 0x79 && u8[5] === 0x46 && u8[6] === 0x53;
  }

  // --- ZIP ENGINE ---

  const crcTable = (function () {
    let c;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[n] = c;
    }
    return table;
  })();

  function calcCRC32(buf) {
    const u8 = new Uint8Array(buf);
    let crc = 0 ^ (-1);
    for (let i = 0; i < u8.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ u8[i]) & 0xFF];
    }
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
        const nameBytes = view.slice(nameStart, nameStart + nameLen);
        const name = new TextDecoder().decode(nameBytes);
        const dataStart = nameStart + nameLen + extraLen;

        let rawData = null;
        let isDeflated = false;

        if (compMethod === 0) {
          rawData = view.slice(dataStart, dataStart + uncompSize);
        } else if (compMethod === 8 && typeof DecompressionStream !== "undefined") {
          try {
            const compressed = view.slice(dataStart, dataStart + compSize);
            const ds = new DecompressionStream("deflate-raw");
            const stream = new Blob([compressed]).stream().pipeThrough(ds);
            const ab = await new Response(stream).arrayBuffer();
            rawData = new Uint8Array(ab);
            isDeflated = true;
          } catch (_) {
            rawData = null;
          }
        }

        entries.push({
          name: name,
          headerOffset: i,
          dataStart: dataStart,
          compMethod: compMethod,
          compSize: compSize,
          uncompSize: uncompSize,
          rawData: rawData ? rawData.buffer : null,
          isDir: name.endsWith("/"),
          isDeflated: isDeflated
        });

        if (compSize > 0) {
          i = dataStart + compSize;
        } else {
          i++;
        }
      } else {
        i++;
      }
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
      lhView.setUint16(6, 0, true);
      lhView.setUint16(8, 0, true);
      lhView.setUint16(10, 0, true);
      lhView.setUint16(12, 0, true);
      lhView.setUint32(14, crc, true);
      lhView.setUint32(18, size, true);
      lhView.setUint32(22, size, true);
      lhView.setUint16(26, nameBytes.length, true);
      lhView.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      parts.push(lh);
      parts.push(data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cd.buffer);
      cdView.setUint32(0, 0x02014b50, true);
      cdView.setUint16(4, 20, true);
      cdView.setUint16(6, 20, true);
      cdView.setUint16(8, 0, true);
      cdView.setUint16(10, 0, true);
      cdView.setUint16(12, 0, true);
      cdView.setUint16(14, 0, true);
      cdView.setUint32(16, crc, true);
      cdView.setUint32(20, size, true);
      cdView.setUint32(24, size, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint16(30, 0, true);
      cdView.setUint16(32, 0, true);
      cdView.setUint16(34, 0, true);
      cdView.setUint16(36, 0, true);
      cdView.setUint32(38, 0, true);
      cdView.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      centralDir.push(cd);
      offset += lh.length + size;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const cd of centralDir) {
      parts.push(cd);
      cdSize += cd.length;
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, files.length, true);
    eocdView.setUint16(10, files.length, true);
    eocdView.setUint32(12, cdSize, true);
    eocdView.setUint32(16, cdStart, true);
    eocdView.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }

  // --- CORE ---

  function applyPatch(buffer, mode) {
    const view = new Uint8Array(buffer.slice(0));
    const list = PATCHES[mode];
    if (!list) throw new Error("Chế độ patch không hợp lệ");

    let totalReplaced = 0;
    const detail = {};

    for (const patch of list) {
      const fromBytes = encode(patch.from);
      const toBytes = encode(patch.to);
      if (fromBytes.length !== toBytes.length) continue;

      const positions = findAll(view, fromBytes);
      for (const pos of positions) {
        view.set(toBytes, pos);
        totalReplaced++;
      }
      if (positions.length) {
        detail[patch.from + " → " + patch.to] = positions.length;
      }
    }

    return { buffer: view.buffer, count: totalReplaced, detail: detail };
  }

  function verifyPatch(buffer, mode) {
    const view = new Uint8Array(buffer);
    const list = PATCHES[mode];
    const remaining = {};
    const present = {};

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
    if (dotIndex === -1) return `${originalName}_${mode}`;
    const baseName = originalName.substring(0, dotIndex);
    const ext = originalName.substring(dotIndex);
    const cleanBase = baseName.replace(/_(head|neck|drag|body|lock)$/i, "");
    return `${cleanBase}_${mode}${ext}`;
  }

  function triggerDownload(blobOrBuffer, fileName) {
    const blob = (blobOrBuffer instanceof Blob) ? blobOrBuffer : new Blob([blobOrBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function renderBoneReport(found) {
    if (!boneReportEl) return;
    if (!found.length) {
      boneReportEl.innerHTML = '<div class="warn">Không tìm thấy bone tiêu chuẩn. File có thể mã hóa / sai cấu trúc / version mới.</div>';
      boneReportEl.classList.add("show");
      return;
    }
    const rows = found.map(f =>
      `<div class="bone-row"><span class="bone-name">${f.name}</span><span class="bone-count">×${f.count}</span></div>`
    ).join("");
    boneReportEl.innerHTML = `<div class="bone-title">Bone scan</div>${rows}`;
    boneReportEl.classList.add("show");
  }

  function renderFilePicker(entries, selectedName) {
    if (!filePickerEl) return;
    if (!entries || entries.length <= 1) {
      filePickerEl.innerHTML = "";
      filePickerEl.classList.remove("show");
      return;
    }
    const options = entries.map(e => {
      const sizeKb = e.rawData ? (e.rawData.byteLength / 1024).toFixed(1) : "?";
      const found = scanBones(e.rawData);
      const score = boneScore(found);
      const selected = e.name === selectedName ? "selected" : "";
      return `<option value="${e.name}" ${selected}>${e.name} (${sizeKb} KB · score ${score})</option>`;
    }).join("");
    filePickerEl.innerHTML = `
      <label class="picker-label">Chọn file trong ZIP (nên chọn file score cao nhất có bone):</label>
      <select id="targetSelect">${options}</select>
    `;
    filePickerEl.classList.add("show");

    const sel = document.getElementById("targetSelect");
    if (sel) {
      sel.addEventListener("change", () => {
        const name = sel.value;
        const entry = state.validEntries.find(e => e.name === name);
        if (!entry || !entry.rawData) return;
        state.targetFileName = entry.name;
        state.targetFileBuffer = entry.rawData;
        const found = scanBones(entry.rawData);
        state.lastScan = found;
        renderBoneReport(found);
        if (hasAimBones(found)) {
          setStatus("Đã chọn file · bone OK · sẵn sàng patch", "ok");
          modesEl.classList.add("show");
        } else {
          setStatus("File này không có bone aim tiêu chuẩn. Chọn file khác hoặc vẫn thử.", "err");
          modesEl.classList.add("show");
        }
        if (verifyEl) {
          verifyEl.innerHTML = "";
          verifyEl.classList.remove("show");
        }
      });
    }
  }

  function renderVerify(result, mode) {
    if (!verifyEl) return;
    const v = verifyPatch(result.buffer, mode);
    const remainingKeys = Object.keys(v.remaining);
    const presentKeys = Object.keys(v.present);

    let html = `<div class="verify-title">Verify sau patch</div>`;
    html += `<div class="verify-line">Đã thay: <strong>${result.count}</strong> vị trí</div>`;

    if (Object.keys(result.detail).length) {
      html += `<div class="verify-detail">`;
      for (const [k, c] of Object.entries(result.detail)) {
        html += `<div>${k} ×${c}</div>`;
      }
      html += `</div>`;
    }

    if (remainingKeys.length) {
      html += `<div class="verify-warn">Còn chuỗi cũ: ${remainingKeys.map(k => k + "×" + v.remaining[k]).join(", ")}</div>`;
    } else {
      html += `<div class="verify-ok">Không còn chuỗi nguồn cũ trong file target</div>`;
    }

    if (presentKeys.length) {
      html += `<div class="verify-ok">Chuỗi đích hiện có: ${presentKeys.map(k => k + "×" + v.present[k]).join(", ")}</div>`;
    }

    verifyEl.innerHTML = html;
    verifyEl.classList.add("show");
  }

  async function handleFile(file) {
    try {
      setStatus("Đang phân tích tệp…");
      if (boneReportEl) { boneReportEl.innerHTML = ""; boneReportEl.classList.remove("show"); }
      if (filePickerEl) { filePickerEl.innerHTML = ""; filePickerEl.classList.remove("show"); }
      if (verifyEl) { verifyEl.innerHTML = ""; verifyEl.classList.remove("show"); }
      modesEl.classList.remove("show");

      const buffer = await readFile(file);
      state.originalFullName = file.name;
      state.rawBuffer = buffer;

      const u8 = new Uint8Array(buffer);
      const looksZip = u8[0] === 0x50 && u8[1] === 0x4b;
      const unity = isUnityFS(u8);

      if (looksZip && !unity) {
        setStatus("Phát hiện ZIP, đang quét file con…");
        const entries = await parseZip(buffer);
        const validEntries = entries.filter(e => !e.isDir && e.rawData);

        if (!validEntries.length) {
          throw new Error("Không giải nén được file bên trong hoặc ZIP bị mã hóa/hỏng");
        }

        let best = null;
        let bestScore = -1;
        for (const entry of validEntries) {
          const found = scanBones(entry.rawData);
          const score = boneScore(found);
          if (score > bestScore) {
            bestScore = score;
            best = { entry: entry, found: found };
          }
        }

        if (!best || bestScore <= 0) {
          validEntries.sort((a, b) => b.uncompSize - a.uncompSize);
          best = { entry: validEntries[0], found: scanBones(validEntries[0].rawData) };
        }

        state.isZip = true;
        state.zipEntries = entries;
        state.validEntries = validEntries;
        state.targetFileName = best.entry.name;
        state.targetFileBuffer = best.entry.rawData;
        state.lastScan = best.found;

        fileNameEl.textContent = `${file.name} ➔ [Target: ${best.entry.name}] (${(best.entry.rawData.byteLength / 1024).toFixed(1)} KB)`;

        renderFilePicker(validEntries, best.entry.name);
        renderBoneReport(best.found);

        if (hasAimBones(best.found)) {
          setStatus("Khớp bone aim · chọn mode bên dưới (hoặc đổi file trong ZIP)", "ok");
          modesEl.classList.add("show");
        } else {
          setStatus("Cảnh báo: không thấy bone aim tiêu chuẩn. Có thể version mới / mã hóa. Vẫn có thể thử.", "err");
          modesEl.classList.add("show");
        }
      } else {
        state.isZip = false;
        state.validEntries = [];
        state.targetFileName = file.name;
        state.targetFileBuffer = buffer;
        fileNameEl.textContent = `${file.name} (${(buffer.byteLength / 1024).toFixed(1)} KB)${unity ? " · UnityFS" : ""}`;

        const found = scanBones(buffer);
        state.lastScan = found;
        renderBoneReport(found);

        if (hasAimBones(found)) {
          setStatus("Khớp bone aim · sẵn sàng patch", "ok");
        } else {
          setStatus("Cảnh báo: Không tìm thấy Bone tiêu chuẩn. File có thể bị mã hóa / sai cấu trúc.", "err");
        }
        modesEl.classList.add("show");
      }
    } catch (e) {
      setStatus(e.message || "Lỗi đọc tệp", "err");
      modesEl.classList.remove("show");
    }
  }

  // --- EVENTS ---

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  modesEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn || !state.targetFileBuffer) return;
    const mode = btn.dataset.mode;

    try {
      setStatus("Đang áp dụng bản vá…");
      const result = applyPatch(state.targetFileBuffer, mode);

      if (result.count === 0) {
        setStatus(`Không có chuỗi bone nào được thay thế cho chế độ "${mode}". Có thể file đã patch hoặc tên bone khác version.`, "err");
        renderVerify(result, mode);
        return;
      }

      const outName = buildOutputFileName(state.originalFullName, mode);

      if (state.isZip) {
        setStatus("Đang đóng gói lại ZIP…");
        const packList = [];
        for (const entry of state.zipEntries) {
          if (entry.isDir) continue;
          if (entry.name === state.targetFileName) {
            packList.push({ name: entry.name, buffer: result.buffer });
          } else if (entry.rawData) {
            packList.push({ name: entry.name, buffer: entry.rawData });
          }
        }
        const zipBlob = createZip(packList);
        triggerDownload(zipBlob, outName);
      } else {
        triggerDownload(result.buffer, outName);
      }

      renderVerify(result, mode);
      setStatus(`Đã patch ${result.count} vị trí ➔ Tải về: ${outName}`, "ok");
    } catch (err) {
      setStatus(err.message || "Lỗi trong quá trình patch và xuất file", "err");
    }
  });
})();
