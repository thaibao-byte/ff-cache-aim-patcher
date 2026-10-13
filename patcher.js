(function () {
  "use strict";

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  const modesEl = document.getElementById("modes");
  const statusEl = document.getElementById("status");

  let state = {
    isZip: false,
    rawBuffer: null,
    targetFileBuffer: null,
    targetFileName: "",
    originalFullName: "",
    zipEntries: [] // Lưu lại danh sách file để pack lại nguyên vẹn
  };

  // QUY TẮC CỐT LÕI: from.length PHẢI BẰNG to.length ĐỂ KHÔNG PHÁ VỠ STRUCTURE/OFFSETS
  const PATCHES = {
    head: [
      { from: "bone_Hips", to: "bone_Head" }, // 9 -> 9
      { from: "bone_Root", to: "bone_Head" }, // 9 -> 9
      { from: "Bone_Hips", to: "Bone_Head" }, // 9 -> 9
      { from: "Bone_Root", to: "Bone_Head" }  // 9 -> 9
    ],
    neck: [
      { from: "bone_Head", to: "bone_Neck" }, // 9 -> 9
      { from: "bone_Hips", to: "bone_Neck" }, // 9 -> 9
      { from: "bone_Root", to: "bone_Neck" }, // 9 -> 9
      { from: "Bone_Head", to: "Bone_Neck" }, // 9 -> 9
      { from: "Bone_Hips", to: "Bone_Neck" }, // 9 -> 9
      { from: "Bone_Root", to: "Bone_Neck" }  // 9 -> 9
    ],
    drag: [
      { from: "bone_Head", to: "bone_Root" }, // 9 -> 9
      { from: "Bone_Head", to: "Bone_Root" }, // 9 -> 9
      { from: "bone_Hips", to: "bone_Root" }, // 9 -> 9
      { from: "Bone_Hips", to: "Bone_Root" }  // 9 -> 9
    ],
    body: [
      { from: "bone_Head", to: "bone_Hips" }, // 9 -> 9
      { from: "bone_Root", to: "bone_Hips" }, // 9 -> 9
      { from: "Bone_Head", to: "Bone_Hips" }, // 9 -> 9
      { from: "Bone_Root", to: "Bone_Hips" }  // 9 -> 9
    ]
  };

  const SCAN_STRINGS = [
    "bone_Head", "bone_Neck", "bone_Spine", "bone_Spine1", "bone_Hips", "bone_Root",
    "Bone_Head", "Bone_Neck", "Bone_Spine", "Bone_Hips", "Bone_Root",
    "Bip001 Head", "Bip001 Neck", "Bip001 Spine", "Bip001 Pelvis",
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
    return found;
  }

  function boneScore(found) {
    let score = 0;
    for (const f of found) {
      if (/bone_|Bip001/i.test(f.name)) score += f.count * 10;
      else score += f.count;
    }
    return score;
  }

  function isUnityFS(u8) {
    return u8.length >= 7 &&
      u8[0] === 0x55 && u8[1] === 0x6e && u8[2] === 0x69 &&
      u8[3] === 0x74 && u8[4] === 0x79 && u8[5] === 0x46 && u8[6] === 0x53;
  }

  // --- ZIP ENGINE: PARSE & REPACK (KHÔNG CẦN THƯ VIỆN NGOÀI) ---

  // Bảng tính CRC32 chuẩn cho ZIP
  const crcTable = (function() {
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
      if (view[i] === 0x50 && view[i+1] === 0x4b && view[i+2] === 0x03 && view[i+3] === 0x04) {
        const compMethod = view[i+8] | (view[i+9] << 8);
        const compSize = (view[i+18] | (view[i+19]<<8) | (view[i+20]<<16) | (view[i+21]<<24)) >>> 0;
        const uncompSize = (view[i+22] | (view[i+23]<<8) | (view[i+24]<<16) | (view[i+25]<<24)) >>> 0;
        const nameLen = view[i+26] | (view[i+27] << 8);
        const extraLen = view[i+28] | (view[i+29] << 8);

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

        // Nhảy tới mục tiếp theo nếu có compSize
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

  // Tạo lại file Zip chuẩn (Store mode 0) để tương thích 100% mọi trình giải nén
  function createZip(files) {
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const data = new Uint8Array(f.buffer);
      const crc = calcCRC32(data);
      const size = data.length;

      // Local Header
      const lh = new Uint8Array(30 + nameBytes.length);
      const lhView = new DataView(lh.buffer);
      lhView.setUint32(0, 0x04034b50, true);
      lhView.setUint16(4, 20, true);  // Version needed
      lhView.setUint16(6, 0, true);   // General flags
      lhView.setUint16(8, 0, true);   // Method: 0 (Stored)
      lhView.setUint16(10, 0, true);  // Mod time
      lhView.setUint16(12, 0, true);  // Mod date
      lhView.setUint32(14, crc, true);
      lhView.setUint32(18, size, true); // Comp size
      lhView.setUint32(22, size, true); // Uncomp size
      lhView.setUint16(26, nameBytes.length, true);
      lhView.setUint16(28, 0, true);  // Extra len
      lh.set(nameBytes, 30);

      parts.push(lh);
      parts.push(data);

      // Central Directory Record
      const cd = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cd.buffer);
      cdView.setUint32(0, 0x02014b50, true);
      cdView.setUint16(4, 20, true);  // Version made by
      cdView.setUint16(6, 20, true);  // Version needed
      cdView.setUint16(8, 0, true);
      cdView.setUint16(10, 0, true);
      cdView.setUint16(12, 0, true);
      cdView.setUint16(14, 0, true);
      cdView.setUint32(16, crc, true);
      cdView.setUint32(20, size, true);
      cdView.setUint32(24, size, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint16(30, 0, true); // Extra len
      cdView.setUint16(32, 0, true); // Comment len
      cdView.setUint16(34, 0, true); // Disk start
      cdView.setUint16(36, 0, true); // Internal attr
      cdView.setUint32(38, 0, true); // External attr
      cdView.setUint32(42, offset, true); // Local header offset
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

    // End of Central Directory (EOCD)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true); // Disk number
    eocdView.setUint16(6, 0, true); // Start disk
    eocdView.setUint16(8, files.length, true); // Total entries on disk
    eocdView.setUint16(10, files.length, true); // Total entries
    eocdView.setUint32(12, cdSize, true); // CD size
    eocdView.setUint32(16, cdStart, true); // CD offset
    eocdView.setUint16(20, 0, true); // Comment len
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }

  // --- CORE LOGIC ---

  function applyPatch(buffer, mode) {
    const view = new Uint8Array(buffer.slice(0));
    const list = PATCHES[mode];
    if (!list) throw new Error("Chế độ patch không hợp lệ");

    let totalReplaced = 0;

    for (const patch of list) {
      const fromBytes = encode(patch.from);
      const toBytes = encode(patch.to);
      if (fromBytes.length !== toBytes.length) continue;

      const positions = findAll(view, fromBytes);
      for (const pos of positions) {
        view.set(toBytes, pos);
        totalReplaced++;
      }
    }

    return { buffer: view.buffer, count: totalReplaced };
  }

  function buildOutputFileName(originalName, mode) {
    const dotIndex = originalName.lastIndexOf(".");
    if (dotIndex === -1) {
      return `${originalName}_${mode}`;
    }
    const baseName = originalName.substring(0, dotIndex);
    const ext = originalName.substring(dotIndex); // Giữ nguyên .zip, .bundle, etc.
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

  async function handleFile(file) {
    try {
      setStatus("Đang phân tích tệp…");
      const buffer = await readFile(file);
      state.originalFullName = file.name;
      state.rawBuffer = buffer;

      const u8 = new Uint8Array(buffer);
      const looksZip = u8[0] === 0x50 && u8[1] === 0x4b;
      const unity = isUnityFS(u8);

      if (looksZip && !unity) {
        setStatus("Phát hiện tệp nén (ZIP), đang quét file con…");
        const entries = await parseZip(buffer);
        const validEntries = entries.filter(e => !e.isDir && e.rawData);

        if (!validEntries.length) {
          throw new Error("Không giải nén được file bên trong hoặc ZIP bị mã hóa/hỏng");
        }

        // Tìm file chứa nhiều bone nhất
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
        state.targetFileName = best.entry.name;
        state.targetFileBuffer = best.entry.rawData;

        fileNameEl.textContent = `${file.name} ➔ [Target: ${best.entry.name}] (${(best.entry.rawData.byteLength / 1024).toFixed(1)} KB)`;
      } else {
        state.isZip = false;
        state.targetFileName = file.name;
        state.targetFileBuffer = buffer;
        fileNameEl.textContent = `${file.name} (${(buffer.byteLength / 1024).toFixed(1)} KB)${unity ? " · UnityFS" : ""}`;
      }

      const found = scanBones(state.targetFileBuffer);
      if (found.length) {
        setStatus("Khớp bone: " + found.slice(0, 8).map(x => `${x.name}×${x.count}`).join(", "), "ok");
      } else {
        setStatus("Cảnh báo: Không tìm thấy Bone tiêu chuẩn. File có thể bị mã hóa / sai cấu trúc.", "err");
      }

      modesEl.classList.add("show");
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
        setStatus(`Không có chuỗi bone nào được thay thế cho chế độ "${mode}".`, "err");
        return;
      }

      const outName = buildOutputFileName(state.originalFullName, mode);

      if (state.isZip) {
        setStatus("Đang đóng gói lại tệp ZIP hoàn chỉnh…");
        // Giữ lại tất cả các file khác trong zip, chỉ thay đổi target file đã patch
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

      setStatus(`Đã patch ${result.count} điểm vị trí ➔ Tải về thành công: ${outName}`, "ok");
    } catch (err) {
      setStatus(err.message || "Lỗi trong quá trình patch và xuất file", "err");
    }
  });
})();
