# AudioSpark TTS Studio - Tài liệu Chức năng

AudioSpark TTS Studio là ứng dụng chuyển đổi văn bản thành giọng nói (Text-to-Speech) chuyên nghiệp, sử dụng mô hình AI tiên tiến **Gemini 2.5 Flash** của Google. Ứng dụng được thiết kế tối ưu cho việc xử lý các văn bản dài, tự động hóa quy trình tạo giọng đọc và xử lý lỗi thông minh.

## 1. Quản lý API Key (Hệ thống Multi-Key)
Đây là tính năng cốt lõi giúp ứng dụng hoạt động liên tục mà không bị gián đoạn bởi giới hạn (Quota) của Google.

*   **Nhập nhiều API Key:** Người dùng có thể nhập danh sách không giới hạn các API Key (mỗi key một dòng).
*   **Lưu trữ cục bộ:** Key được lưu an toàn trong `localStorage` của trình duyệt, không cần nhập lại mỗi lần tải lại trang.
*   **Cơ chế Tự động Xoay vòng (Auto-Rotation):**
    *   Khi đang tạo giọng đọc, nếu một key gặp lỗi (429 Quota Exceeded, 503 Server Overload, hoặc 500 Internal Error), hệ thống sẽ **tự động** chuyển sang key tiếp theo trong danh sách và thử lại ngay lập tức.
    *   Quy trình này diễn ra trong vòng lặp vô tận cho đến khi thành công.
*   **Cơ chế "Làm nguội" (Cool-down):** Nếu tất cả các key trong danh sách đều bị lỗi trong một lượt quay vòng, hệ thống sẽ tự động tạm dừng 5 giây để chờ Google reset quota, sau đó mới tiếp tục thử lại.
*   **Hiển thị trạng thái:** Hiển thị key nào đang được sử dụng, key nào bị lỗi, và ẩn/hiện key để bảo mật.

## 2. Xử lý Văn bản Đầu vào (Input Processing)

*   **Hỗ trợ File:** Người dùng có thể tải lên file `.txt` thông qua nút bấm hoặc kéo thả (Drag & Drop) file vào giao diện.
*   **Tự động Phân đoạn (Smart Chunking):**
    *   Văn bản dài sẽ tự động được cắt thành các đoạn nhỏ (Chunks).
    *   **Giới hạn:** Tối đa 1500 ký tự mỗi đoạn (để phù hợp với giới hạn context của Gemini TTS).
    *   **Thông minh:** Thuật toán cắt dựa trên dấu câu (cắt hết câu) và khoảng trắng, tránh việc cắt giữa chừng từ ngữ gây gãy giọng.
*   **Chỉnh sửa trực tiếp:**
    *   Người dùng có thể xem và chỉnh sửa nội dung văn bản của từng đoạn (Chunk) ngay trên giao diện trước hoặc sau khi tạo audio.
    *   Có nút ẩn/hiện văn bản để giao diện gọn gàng.

## 3. Cấu hình Giọng đọc (Voice Configuration)

*   **Chọn Giọng (Voice Persona):** Hỗ trợ 5 giọng đọc chuẩn của Gemini:
    *   **Puck, Charon, Fenrir:** Giọng Nam (Male).
    *   **Kore, Zephyr:** Giọng Nữ (Female).
*   **Global Style Direction (Chỉ đạo phong cách):**
    *   Cho phép nhập một câu lệnh (Prompt) áp dụng cho toàn bộ các đoạn văn.
    *   *Ví dụ:* "Đọc với giọng trầm ấm, kể chuyện kinh dị" hoặc "Giọng vui tươi, hào hứng".
*   **Seed Control:**
    *   Cho phép nhập mã số `Seed`.
    *   **Tác dụng:** Giữ cho ngữ điệu và cách đọc ổn định, đồng nhất giữa các lần tạo khác nhau hoặc giữa các đoạn văn khác nhau (tránh trường hợp đoạn 1 giọng trầm, đoạn 2 lại giọng cao vút).

## 4. Quy trình Tạo Audio (Generation Process)

*   **Xử lý Hàng loạt (Batch Processing):**
    *   Nút "Generate Selected" cho phép tạo audio cho tất cả các đoạn đang được chọn cùng lúc.
    *   Có thanh trạng thái hiển thị tiến độ: Đang chạy đoạn nào, tổng số đoạn, trạng thái retry.
*   **Xử lý Đơn lẻ:** Có nút Refresh để tạo lại audio cho riêng từng đoạn nếu chưa ưng ý.
*   **Error Handling:**
    *   Hiển thị rõ ràng trạng thái: Đang chờ, Đang tạo, Thành công (xanh lá), Lỗi (đỏ).
    *   Nếu lỗi, hiển thị chi tiết mã lỗi (Quota, Safety, Network...).

## 5. Xuất và Nghe lại (Output & Export)

*   **Trình phát Audio (Player):**
    *   Nghe thử trực tiếp từng đoạn trên trình duyệt.
    *   Hiển thị thời lượng (duration) của đoạn audio.
*   **Tải xuống (Download):**
    *   Tải xuống từng đoạn riêng lẻ dưới dạng file `.wav`.
*   **Gộp Audio (Merge All):**
    *   Tính năng quan trọng cho phép nối tất cả các đoạn audio đã tạo thành công lại với nhau.
    *   Xuất ra **một file .wav duy nhất** chứa toàn bộ nội dung đọc liền mạch.
*   **Xử lý Audio (Audio Normalization):**
    *   Hệ thống tự động giải mã PCM và chuẩn hóa âm lượng (Normalize) để tránh bị rè (clipping) hoặc quá nhỏ trước khi xuất file.

## 6. Giao diện (UI/UX)

*   **Dark Mode:** Giao diện tối màu (Slate/Indigo theme) hiện đại, dịu mắt.
*   **Icons:** Sử dụng bộ icon Lucide trực quan.
*   **Responsive:** Tương thích tốt trên máy tính và máy tính bảng.
