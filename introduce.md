Tôi muốn bạn chỉnh sửa project TTS hiện tại. 

QUAN TRỌNG:
- Trước khi code, hãy đọc và phân tích toàn bộ code hiện tại liên quan đến:
  + giao diện UI
  + chức năng chọn file
  + TTS/audio generation
  + TTS_FINAL_OUTPUT_DIR
  + progress/log
  + xử lý file và thư mục
- Không được tự ý viết lại toàn bộ project.
- Không thay đổi engine TTS, API, model, cấu hình hoặc logic xử lý audio hiện tại nếu không cần thiết.
- Ưu tiên tái sử dụng code hiện có và chỉ thay đổi phần input/output + UI + queue processing.
- Sau khi hiểu code, hãy mô tả ngắn gọn kiến trúc hiện tại và kế hoạch sửa, sau đó mới tiến hành code.

==================================================
1. MỤC TIÊU
==================================================

Hiện tại project đang có biến:

TTS_FINAL_OUTPUT_DIR=D:\Code\TTS\Youtube\Video\TruyenDichAI\Phàm Nhân Duyên Tiên

Biến này là thư mục output cuối cùng để lưu audio.

Tôi muốn bổ sung thêm một INPUT DIRECTORY để chương trình có thể xử lý hàng loạt file TXT trong một thư mục.

Ví dụ INPUT DIRECTORY:

D:\Code\TTS\cawl\truyendichAI\output\pham-nhan-tien-duyen\merge

Trong thư mục này có nhiều file TXT:

1-50.txt
51-100.txt
101-150.txt
151-200.txt
201-250.txt
251-300.txt
...
...

Các file này chính là các batch chương cần chuyển sang audio.

==================================================
2. THAY ĐỔI GIAO DIỆN
==================================================

Hiện tại có chức năng "Chọn file".

Tôi muốn bổ sung chức năng "Chọn thư mục" ngay bên dưới/nơi phù hợp với nút chọn file hiện tại.

UI mong muốn:

[ Chọn thư mục TXT đầu vào ]

[ D:\Code\TTS\cawl\truyendichAI\output\pham-nhan-tien-duyen\merge ]

[ Chọn thư mục ]

Sau đó vẫn sử dụng:

TTS_FINAL_OUTPUT_DIR

làm thư mục output audio.

Nếu UI hiện tại đã có trường chọn output directory thì giữ lại, không tạo duplicate.

Tôi muốn người dùng có thể chọn một thư mục chứa nhiều file TXT thay vì phải chọn từng file.

==================================================
3. XỬ LÝ FILE TRONG INPUT DIRECTORY
==================================================

Khi người dùng chọn INPUT DIRECTORY, chương trình phải:

- Đọc tất cả file .txt trực tiếp trong thư mục đó.
- Không cần quét đệ quy các thư mục con, trừ khi code hiện tại đã có cơ chế này và việc giữ lại không gây ảnh hưởng.
- Chỉ xử lý file TXT.
- Sắp xếp file theo thứ tự tự nhiên dựa trên tên file.

Ví dụ:

1-50.txt
51-100.txt
101-150.txt
1001-1050.txt

Không được sort kiểu alphabet khiến:

1001-1050.txt
101-150.txt
1-50.txt
...

Phải sort theo số đầu tiên/range số trong tên file.

==================================================
4. CƠ CHẾ RESUME / SKIP FILE ĐÃ XỬ LÝ
==================================================

Đây là phần QUAN TRỌNG NHẤT.

Mỗi file TXT có tên dạng:

1-50.txt
51-100.txt
101-150.txt
...

Tên folder output tương ứng phải lấy từ tên file TXT sau khi bỏ phần extension ".txt".

Ví dụ:

Input:
101-150.txt

Output folder tương ứng:

TTS_FINAL_OUTPUT_DIR\101-150\

Ví dụ output:

D:\Code\TTS\Youtube\Video\TruyenDichAI\Phàm Nhân Duyên Tiên\
├── 1-50\
├── 51-100\
├── 101-150\
├── 151-200\
└── ...

Khi bắt đầu chạy, với từng TXT:

Nếu folder tương ứng đã tồn tại:

TTS_FINAL_OUTPUT_DIR\101-150\

=> SKIP file:

101-150.txt

Không được TTS lại.

Nếu folder chưa tồn tại:

=> đưa file vào queue để xử lý.

Ví dụ:

Input:

1-50.txt
51-100.txt
101-150.txt
151-200.txt

Output hiện tại:

1-50/
51-100/
101-150/

Thì chương trình phải tự động:

1-50.txt       => SKIP
51-100.txt     => SKIP
101-150.txt    => SKIP
151-200.txt    => PROCESS

Mục đích là có thể dừng chương trình rồi chạy lại sau mà không phải xử lý lại những batch đã hoàn thành.

==================================================
5. KHÔNG CHỈ KIỂM TRA FOLDER TỒN TẠI MỘT CÁCH MÙ QUÁNG
==================================================

Hãy kiểm tra code TTS hiện tại để xác định thời điểm nào một batch thực sự được coi là "hoàn thành".

Nếu folder đã được tạo nhưng quá trình TTS trước đó bị crash giữa chừng thì không nên mặc định coi folder đó là hoàn thành nếu trong hệ thống hiện tại có thể xác định trạng thái hoàn thành bằng file output/metadata/status.

Ưu tiên thiết kế cơ chế:

- Processing
- Completed
- Failed

Nếu kiến trúc hiện tại đã có file audio hoặc marker để xác định hoàn thành thì tận dụng nó.

Nếu hiện tại chưa có cơ chế marker, hãy thiết kế cách kiểm tra an toàn nhất mà không phá workflow hiện tại.

Mục tiêu:

CHỈ SKIP những batch thực sự đã hoàn thành.

==================================================
6. QUEUE XỬ LÝ
==================================================

Các file chưa hoàn thành phải được đưa vào queue theo đúng thứ tự:

1-50.txt
51-100.txt
101-150.txt
...

Chương trình xử lý tuần tự từng file.

Không tự ý chạy song song nhiều batch nếu TTS hiện tại không hỗ trợ an toàn.

Khi một file hoàn thành:

- cập nhật trạng thái UI thành COMPLETED
- chuyển sang file tiếp theo.

Nếu một file lỗi:

- cập nhật trạng thái FAILED
- hiển thị lỗi phù hợp
- không làm crash toàn bộ chương trình nếu có thể xử lý an toàn.
- cho phép các file tiếp theo tiếp tục chạy nếu kiến trúc hiện tại phù hợp.

==================================================
7. THAY ĐỔI PROGRESS LOG
==================================================

Tôi KHÔNG muốn giao diện chính hiển thị Progress Log dạng log dài như hiện tại.

Hãy thay phần:

"Progress Log"

bằng một khu vực:

"TIẾN TRÌNH XỬ LÝ"

Hiển thị danh sách toàn bộ file TXT trong INPUT DIRECTORY.

Ví dụ:

TIẾN TRÌNH XỬ LÝ

┌─────────────────────────────────────────────┐
│ File              │ Trạng thái              │
├─────────────────────────────────────────────┤
│ 1-50.txt          │ ✓ Đã hoàn thành         │
│ 51-100.txt        │ ✓ Đã hoàn thành         │
│ 101-150.txt       │ ▶ Đang xử lý            │
│ 151-200.txt       │ ○ Chờ xử lý             │
│ 201-250.txt       │ ○ Chờ xử lý             │
└─────────────────────────────────────────────┘

Các trạng thái nên có:

- SKIPPED / Đã tồn tại
- QUEUED / Chờ xử lý
- PROCESSING / Đang xử lý
- COMPLETED / Đã hoàn thành
- FAILED / Lỗi

Có thể dùng icon hoặc badge để dễ nhìn.

Ví dụ:

✓ 101-150.txt       Đã hoàn thành
▶ 151-200.txt       Đang xử lý
○ 201-250.txt       Chờ xử lý
✕ 251-300.txt       Lỗi

==================================================
8. REAL-TIME UI
==================================================

Danh sách phải cập nhật realtime trong quá trình TTS.

Ví dụ ban đầu:

1-50.txt       ✓ Đã hoàn thành
51-100.txt     ✓ Đã hoàn thành
101-150.txt    ▶ Đang xử lý
151-200.txt    ○ Chờ xử lý

Sau khi 101-150.txt hoàn thành:

1-50.txt       ✓ Đã hoàn thành
51-100.txt     ✓ Đã hoàn thành
101-150.txt    ✓ Đã hoàn thành
151-200.txt    ▶ Đang xử lý

Không cần refresh ứng dụng.

Nếu frontend/backend đang giao tiếp bằng event, websocket, signal hoặc cơ chế tương tự thì tận dụng cơ chế hiện tại.

==================================================
9. THỐNG KÊ TỔNG QUAN
==================================================

Ở phía trên danh sách tiến trình, thêm thống kê đơn giản:

Tổng: 30
Đã hoàn thành: 15
Đang xử lý: 1
Chờ xử lý: 13
Lỗi: 1

Có thể có progress bar tổng:

████████████░░░░░░░░  75%

Progress tổng phải dựa trên số batch đã hoàn thành, không phải progress từng câu/chunk bên trong TTS.

Nếu TTS hiện tại đã có progress chi tiết cho từng file thì vẫn giữ cơ chế đó ở mức phù hợp, nhưng không biến nó thành Progress Log dài.

==================================================
10. HIỂN THỊ FILE HIỆN TẠI
==================================================

Phía trên danh sách nên có:

Đang xử lý:
101-150.txt

Tiếp theo:
151-200.txt

Nếu không còn file:

Đang xử lý:
Không có

Trạng thái:

✓ Đã hoàn thành tất cả file

==================================================
11. HÀNH VI KHI CHỌN THƯ MỤC MỚI
==================================================

Khi người dùng chọn một INPUT DIRECTORY mới:

- Clear danh sách cũ.
- Scan lại toàn bộ TXT.
- Kiểm tra output directory.
- Xác định file nào đã hoàn thành.
- Xác định file nào cần xử lý.
- Hiển thị toàn bộ danh sách ngay lập tức.

Không được bắt đầu TTS tự động chỉ vì người dùng chọn folder.

Chỉ bắt đầu khi người dùng nhấn nút:

"BẮT ĐẦU TTS"

==================================================
12. NÚT START / STOP
==================================================

Nếu project hiện tại đã có Start/Stop thì giữ lại và điều chỉnh cho phù hợp.

Khi nhấn START:

- scan input
- build queue
- skip các batch đã hoàn thành
- bắt đầu xử lý batch đầu tiên chưa hoàn thành.

Khi nhấn STOP:

- không nhận batch mới.
- nếu TTS engine hiện tại có cơ chế stop/cancel an toàn thì sử dụng nó.
- không làm hỏng output đã hoàn thành.
- sau khi chạy lại, hệ thống phải resume từ batch chưa hoàn thành.

==================================================
13. XỬ LÝ OUTPUT DIRECTORY
==================================================

Không hard-code:

D:\Code\TTS\Youtube\Video\TruyenDichAI\Phàm Nhân Duyên Tiên

Đây chỉ là ví dụ.

Phải tiếp tục sử dụng:

TTS_FINAL_OUTPUT_DIR

từ config/environment hiện tại.

Ví dụ:

TTS_FINAL_OUTPUT_DIR=D:\Code\TTS\Youtube\Video\TruyenDichAI\Phàm Nhân Duyên Tiên

Input directory phải là một giá trị riêng.

Có thể đặt tên:

TTS_INPUT_DIR

hoặc tên phù hợp với cấu trúc config hiện tại.

Không làm mất biến:

TTS_FINAL_OUTPUT_DIR

==================================================
14. TƯƠNG THÍCH VỚI CHỨC NĂNG CHỌN FILE CŨ
==================================================

Nếu project hiện tại đang hỗ trợ chọn một file TXT riêng lẻ, không được tự ý xóa chức năng đó nếu không cần thiết.

Có thể thiết kế:

Input:
[ Chọn file ] [ Chọn thư mục ]

- Chọn file => xử lý một file như workflow cũ.
- Chọn thư mục => batch processing theo yêu cầu mới.

Hai chế độ không được xung đột.

Nếu UI/architecture hiện tại không cần giữ "Chọn file", hãy kiểm tra trước và giải thích lý do rồi mới thay đổi.

==================================================
15. XỬ LÝ TÊN FILE
==================================================

Tên folder output phải được tạo an toàn từ tên file.

Ví dụ:

101-150.txt
=> 101-150/

Không được sử dụng toàn bộ đường dẫn làm tên folder.

Không được đổi tên batch.

Không được tự ý thêm timestamp vào tên folder.

==================================================
16. ERROR HANDLING
==================================================

Nếu file TXT lỗi:

101-150.txt => FAILED

Hiển thị:

✕ 101-150.txt    Lỗi

Có thể có tooltip/details hoặc khu vực error nhỏ để biết nguyên nhân.

Không để một file lỗi làm mất trạng thái các file trước đó.

Nếu có thể retry:

[ Retry ]

Nhưng không bắt buộc nếu việc này làm UI phức tạp.

==================================================
17. YÊU CẦU VỀ CODE
==================================================

Code phải production-friendly:

- Không duplicate logic TTS.
- Tách rõ:
  + input scanning
  + sorting
  + completed detection
  + queue
  + processing
  + UI state
- Không block UI thread.
- Không scan folder liên tục không cần thiết.
- Không tạo quá nhiều request/event.
- Xử lý Windows path đúng cách.
- Hỗ trợ đường dẫn có dấu tiếng Việt như:

D:\Code\TTS\Youtube\Video\TruyenDichAI\Phàm Nhân Duyên Tiên

- Không hard-code đường dẫn.
- Không phá API/model/TTS engine hiện tại.

==================================================
18. TRƯỚC KHI KẾT THÚC
==================================================

Sau khi sửa code:

1. Kiểm tra toàn bộ compile/runtime errors.
2. Kiểm tra các import/dependency.
3. Kiểm tra flow chọn file cũ.
4. Kiểm tra flow chọn folder mới.
5. Kiểm tra sorting:
   1-50.txt
   51-100.txt
   101-150.txt
   ...
6. Kiểm tra skip folder đã hoàn thành.
7. Kiểm tra resume sau khi restart.
8. Kiểm tra UI cập nhật realtime.
9. Kiểm tra STOP.
10. Kiểm tra FAILED.
11. Không để Progress Log cũ còn xuất hiện nếu đã thay thế bằng danh sách tiến trình.

==================================================
19. TIÊU CHÍ HOÀN THÀNH
==================================================

Tôi muốn workflow cuối cùng như sau:

Bước 1:
Người dùng chọn:

INPUT DIRECTORY
D:\Code\TTS\cawl\truyendichAI\output\pham-nhan-tien-duyen\merge

Bước 2:
App scan:

1-50.txt
51-100.txt
101-150.txt
151-200.txt
...

Bước 3:
App kiểm tra:

TTS_FINAL_OUTPUT_DIR

Ví dụ đã có:

1-50/
51-100/
101-150/

=> 3 file đầu tiên được đánh dấu:

✓ Đã hoàn thành / SKIPPED

Bước 4:
File đầu tiên chưa có output:

151-200.txt

được đánh dấu:

▶ Đang xử lý

Bước 5:
TTS tạo output:

TTS_FINAL_OUTPUT_DIR\151-200\

Bước 6:
Khi hoàn thành:

151-200.txt => ✓ Đã hoàn thành

Sau đó tự động:

201-250.txt => ▶ Đang xử lý

Bước 7:
Nếu app bị tắt ở 201-250:

Khi mở lại và chạy:

- các batch đã hoàn thành => SKIP
- batch chưa hoàn thành => tiếp tục xử lý
- không TTS lại những batch đã hoàn thành.

Đây là behavior quan trọng nhất.

==================================================

Hãy bắt đầu bằng việc đọc và phân tích code hiện tại.

KHÔNG code ngay lập tức.

Trước tiên hãy:
1. Xác định file nào đang quản lý UI.
2. Xác định file nào đang quản lý TTS.
3. Xác định file nào đang xử lý TTS_FINAL_OUTPUT_DIR.
4. Xác định Progress Log hiện tại nằm ở đâu.
5. Xác định flow xử lý một TXT hiện tại.
6. Đề xuất chính xác những file cần sửa.

Sau đó mới thực hiện thay đổi với phạm vi tối thiểu, giữ nguyên các chức năng đang hoạt động.