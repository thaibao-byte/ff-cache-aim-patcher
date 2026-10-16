# FF Cache Aim Patcher

Client-side Free Fire / Free Fire Max cache editor.

Drop cache file → scan bone → (nếu ZIP) chọn file con → chọn **Aim Head / Neck / Drag / Body** → verify → tải file đã patch.

## Live

**https://thaibao-byte.github.io/ff-cache-aim-patcher/**

## v1.1

- Bone scan rõ ràng (tên + số lần xuất hiện)
- Chọn file con trong ZIP (không còn auto-only)
- Thêm biến thể `Bip001 *`
- Verify sau patch: còn chuỗi cũ không, chuỗi đích có bao nhiêu
- Cảnh báo khi không thấy bone aim tiêu chuẩn

## Bật Pages (1 lần)

1. Repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / folder: `/ (root)`
4. Save

## Cách dùng

1. Lấy file cache gốc từ máy (cache_res / gameassetbundles…)
2. Mở web → kéo thả file
3. Xem bone scan + (nếu ZIP) chọn file score cao / có bone
4. Chọn mode
5. Xem verify → file tải về → copy lại đúng path game

Toàn bộ xử lý trên trình duyệt, không upload server.
