# IELSTDIARYS

Sổ theo dõi lộ trình IELTS: mục tiêu và vườn phần thưởng, việc cần làm, luyện Reading / Listening / Speaking / Writing, ngữ pháp, flashcard lặp lại ngắt quãng, lịch ôn bài tập và AI chấm điểm. Đăng nhập để dùng chung dữ liệu trên máy tính và điện thoại.

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html` | Toàn bộ giao diện (một file, không cần build) |
| `api/config.js` | Trả địa chỉ Supabase cho trình duyệt |
| `api/ai.js` | Cổng AI chung: Claude, Gemini, ChatGPT, OpenRouter |
| `supabase/schema.sql` | Tạo bảng dữ liệu, phân quyền, kho file — chạy một lần |
| `vercel.json` | Cho hàm AI chạy tối đa 60 giây |

## 1. Tạo database + đăng nhập (Supabase, gói Free)

1. Vào supabase.com → **New project** (chọn region Singapore). Lưu lại mật khẩu database.
2. **SQL Editor → New query** → dán toàn bộ `supabase/schema.sql` → **Run**.
3. **Authentication → URL Configuration**: *Site URL* = địa chỉ Vercel của bạn (ví dụ `https://ielstdiarys.vercel.app`); thêm cùng địa chỉ vào *Redirect URLs*.
4. **Project Settings → API** (hoặc *API Keys*): chép **Project URL** và **anon / publishable key**.

## 2. Biến môi trường trên Vercel

Project → Settings → Environment Variables:

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SUPABASE_URL` | Có (để đăng nhập) | Supabase → Project URL |
| `SUPABASE_ANON_KEY` | Có (để đăng nhập) | anon / publishable key — không dùng service_role |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | Không | Chỉ cần nếu muốn đặt key trên server thay vì nhập trong trang |
| `APP_PASSWORD` | Nên có nếu đặt key trên server | Mở `https://<địa-chỉ>/#ai=<mật-khẩu>` một lần trên mỗi máy |

Thêm xong → **Deployments → Redeploy**.

## 3. Dùng

- Mở trang → **Tạo tài khoản** bằng email + mật khẩu → bấm link xác nhận trong email → đăng nhập.
- Lần đầu đăng nhập trên máy đã có dữ liệu cũ, trang hỏi **Tải lên tài khoản**.
- Trên điện thoại: mở cùng địa chỉ, đăng nhập cùng tài khoản.
- Chuyển dữ liệu từ bản trong Claude: bản Claude → Tổng quan → **Sao lưu / khôi phục → Tải bản sao lưu**; website → **Khôi phục từ file**.
- **Cài đặt AI**: bấm nút **AI** ở góc trên (hoặc menu tài khoản → Cài đặt AI). Chọn AI chính và AI dự phòng, dán API key, chọn model, bấm **Kiểm tra kết nối** rồi **Lưu**. Khi đã đăng nhập, cài đặt và key được lưu vào tài khoản nên điện thoại dùng luôn. Nếu AI chính lỗi hoặc hết hạn mức, trang tự dùng AI dự phòng.
  - Gemini: aistudio.google.com/apikey (có hạn mức miễn phí)
  - Claude: console.anthropic.com/settings/keys
  - ChatGPT: platform.openai.com/api-keys
  - OpenRouter: openrouter.ai/keys (một key dùng nhiều hãng)

## Ghi chú

- Mỗi tài khoản chỉ xem được dữ liệu và cài đặt của chính mình (Row Level Security).
- API key nhập trong trang được lưu trong tài khoản Supabase của bạn (dạng văn bản, chỉ tài khoản của bạn đọc được) và chỉ gửi tới `/api/ai` khi gọi AI.
- File audio/PDF/ảnh lưu ở bucket `media` với đường dẫn ngẫu nhiên khó đoán; ai có đúng đường dẫn thì mở được file.
- Chưa cấu hình Supabase thì trang vẫn chạy và lưu dữ liệu trong trình duyệt.
- Gói Free của Supabase tạm dừng project nếu 7 ngày không có ai dùng; vào dashboard bấm *Restore* là chạy lại, dữ liệu không mất.
