# VN-Stock – hệ thống phân tích cổ phiếu Việt Nam

Hệ thống tự chạy mỗi chiều sau 15h35. Nó tải giá toàn bộ HOSE, HNX và UPCOM, phân tích cơ bản, dự phóng, định giá và phân tích kỹ thuật, rồi đăng kết quả lên một trang web riêng tư mở được trên điện thoại. Khi có việc cần làm (mua, bán, cắt lỗ, luận điểm gãy), hệ thống nhắn anh qua Telegram.

Toàn bộ chạy miễn phí: GitHub Actions để chạy máy, Cloudflare Pages để chứa web và lưu danh mục, Telegram để nhắn tin. Không cần API trả phí. Dữ liệu lấy từ các API công khai mà web của Vietcap và TCBS đang dùng, có Yahoo Finance làm nguồn dự phòng giá.

> Đây là công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư có giấy phép. Hệ thống không đảm bảo lợi nhuận. Tab **Kiểm chứng** cho anh thấy các quy tắc này từng lãi, lỗ bao nhiêu trong quá khứ.

---

## Cài đặt lần đầu (khoảng 45 phút, làm một lần)

### Bước 1. Kiểm tra nguồn dữ liệu có chạy được từ GitHub không

Máy chủ GitHub đặt ở Mỹ, mà một số nguồn dữ liệu Việt Nam có thể chặn IP nước ngoài. Cần thử trước:

1. Vào repo trên GitHub, bấm tab **Actions**.
2. Nếu GitHub hỏi, bấm **I understand my workflows, go ahead and enable them**.
3. Cột trái chọn **Kiểm tra nguồn dữ liệu**, bấm **Run workflow**, rồi bấm nút **Run workflow** màu xanh.
4. Chờ khoảng 2 phút, bấm vào lượt chạy, mở bước **Thử từng nguồn**. Mỗi dòng sẽ là `OK` hoặc `FAIL`.
5. Gửi Claude ảnh chụp màn hình bước này, hoặc tải file **probe-report** ở cuối trang. Claude sẽ chỉnh code theo kết quả thật.

Nếu mọi nguồn đều `FAIL` do bị chặn, xem mục **Phương án dự phòng** ở cuối.

### Bước 2. Tạo bot Telegram

1. Mở Telegram, tìm **@BotFather**, gõ `/newbot`.
2. Đặt tên, ví dụ `VN Stock của Jason`, rồi đặt username kết thúc bằng `bot`, ví dụ `jason_vnstock_bot`.
3. BotFather gửi lại một **token** dạng `123456789:AAH...`. Chép token này.
4. Tìm bot vừa tạo, bấm **Start** và gửi một tin bất kỳ, ví dụ `hi`.
5. Mở trình duyệt, vào địa chỉ sau, thay `<TOKEN>` bằng token của anh:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
6. Tìm đoạn `"chat":{"id":123456789`. Con số đó là **chat id**.

### Bước 3. Tạo tài khoản Cloudflare (web riêng tư + lưu danh mục)

1. Đăng ký miễn phí ở **dash.cloudflare.com/sign-up**.
2. **Account ID:** sau khi đăng nhập, bấm **Workers & Pages** ở cột trái. Account ID nằm ở cột phải. Chép lại.
3. **API Token:**
   - Bấm biểu tượng người ở góc phải trên, chọn **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**.
   - Đặt tên `vn-stock`.
   - Thêm 2 dòng quyền:
     - `Account` – `Cloudflare Pages` – `Edit`
     - `Account` – `Workers KV Storage` – `Edit`
   - Bấm **Continue to summary** → **Create Token**. Chép token này lại (chỉ hiện một lần).

### Bước 4. Nhập các "chìa khoá" vào GitHub

Trong repo, vào **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Tạo lần lượt:

| Tên (gõ chính xác) | Giá trị |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token ở Bước 2 |
| `TELEGRAM_CHAT_ID` | chat id ở Bước 2 |
| `CF_ACCOUNT_ID` | Account ID ở Bước 3 |
| `CF_API_TOKEN` | API Token ở Bước 3 |
| `OWNER_EMAIL` | email anh dùng để đăng nhập web |

### Bước 5. Chạy lần đầu

1. Tab **Actions** → **Cập nhật hằng ngày** → **Run workflow**.
2. Tick **Tải lại toàn bộ báo cáo tài chính** và **Chạy lại backtest**, rồi bấm **Run workflow**.
3. Lần đầu mất 1–3 tiếng vì phải tải 10 năm giá và báo cáo tài chính của khoảng 1.600 mã. Các lần sau chỉ mất 10–20 phút.
4. Chạy xong, trang web có địa chỉ **https://vn-stock.pages.dev** (Cloudflare có thể thêm vài ký tự nếu tên đã có người dùng; xem ở **Workers & Pages** → **vn-stock**).

### Bước 6. Khoá trang web, chỉ anh đăng nhập được

1. Ở Cloudflare, cột trái chọn **Zero Trust**. Lần đầu sẽ được hỏi tên nhóm, đặt tuỳ ý, rồi chọn gói **Free** (có thể phải nhập thẻ nhưng không bị trừ tiền).
2. Vào **Access** → **Applications** → **Add an application** → **Self-hosted**.
3. Điền:
   - Application name: `VN-Stock`
   - Domain: `vn-stock.pages.dev`
4. Bấm tiếp sang phần Policy:
   - Policy name: `Chi minh toi`
   - Action: **Allow**
   - Include → **Emails** → nhập email của anh
5. Lưu lại.
6. Làm thêm một application thứ hai y hệt, nhưng Domain là `*.vn-stock.pages.dev` (để khoá cả các bản xem trước).

Từ giờ, mỗi lần mở web, anh nhập email, Cloudflare gửi mã 6 số, nhập mã là vào được. Trên mỗi thiết bị, mỗi lần đăng nhập giữ được khoảng 24 giờ.

### Bước 7 (tuỳ chọn). Nút "Chạy lại phân tích ngay" trên web

1. GitHub → ảnh đại diện → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Cấu hình token:
   - Repository access: chỉ chọn repo `vn-stock`
   - Permissions → **Actions**: `Read and write`
3. Tạo token, rồi thêm vào secrets của repo với tên `GH_DISPATCH_TOKEN`.

Chưa làm bước này thì nút trên web sẽ dẫn anh sang trang GitHub Actions để bấm chạy.

---

## Dùng hằng ngày

- **Mở web trên điện thoại.** Trên iPhone: Safari → nút Chia sẻ → **Thêm vào MH chính**, web sẽ hiện như một ứng dụng.
- **Trang Hôm nay:**
  - Đèn thị trường, và số % vốn được phép nắm cổ phiếu.
  - Danh sách MUA, mỗi mã có vùng giá mua, điểm cắt lỗ, mục tiêu và số cổ phiếu.
  - Việc cần làm với danh mục đang nắm.
- **Danh mục:** nhập số vốn và các mã đang nắm (mã, khối lượng, giá vốn). Dữ liệu đồng bộ giữa mọi thiết bị.
- **Telegram:** chỉ nhắn khi có việc. Ngày nào không có tin nghĩa là không cần làm gì.
- **Bấm vào một mã** để xem biểu đồ, toàn bộ chỉ báo, sóng Elliott/Wyckoff, báo cáo tài chính, dự phóng 5 năm, định giá và so sánh cùng ngành.
- **Sửa giả định dự phóng:** trong trang mã → tab **Dự phóng & định giá**, sửa tăng trưởng, biên lợi nhuận… Giá trị hợp lý tính lại ngay. Bấm **Lưu giả định** thì từ lần chạy sau, tín hiệu mua/bán sẽ dùng giả định của anh.

## Chỉnh cách hệ thống chọn mã

Mở file **config.yaml** trên GitHub, bấm biểu tượng bút chì, sửa số, rồi bấm **Commit changes**. Các mục quan trọng:

- `allocation`: tỷ lệ vốn cho từng rổ. Đang dùng: GARP 40, Tăng trưởng 30, Phòng thủ 30 (chọn theo backtest 2020–2026).
- `strategy`: quy tắc chọn mã đã kiểm chứng: chỉ mua khi giá đang trong xu hướng tăng (giá > MA50 > MA200), vốn hoá từ 1.000 tỷ, chặn "bẫy giá trị".
- `methods`: trọng số 9 phương pháp chấm điểm.
- `risk`:
  - số mã tối đa
  - tỷ trọng tối đa mỗi mã, mỗi ngành
  - mức cắt lỗ tối đa (mặc định 20%; backtest cho thấy 12% làm giảm lợi nhuận)
  - biên an toàn khi mua
- `valuation`: lãi suất phi rủi ro, phần bù rủi ro, tăng trưởng dài hạn.

## Chạy trên máy tính của anh (tuỳ chọn)

Cài Python 3.11 trở lên từ python.org, mở Terminal (macOS) hoặc PowerShell (Windows) trong thư mục code, rồi chạy:

```
pip install -r requirements.txt
python run.py all            # tải dữ liệu + phân tích (lần đầu lâu)
python run.py serve          # mở http://localhost:8000 để xem web
python run.py stock FPT      # in nhanh phân tích 1 mã
python run.py all --only FPT,VCB,HPG   # chỉ chạy vài mã cho nhanh
python run.py demo           # dữ liệu GIẢ LẬP để xem thử giao diện
```

## Phương án dự phòng nếu nguồn dữ liệu chặn máy chủ GitHub

Cho máy tính của anh (đặt ở Việt Nam) làm máy chạy:

1. GitHub repo → **Settings** → **Actions** → **Runners** → **New self-hosted runner**, rồi làm theo 3–4 lệnh GitHub hiển thị cho đúng hệ điều hành của anh.
2. Trong file `.github/workflows/daily.yml`, đổi `runs-on: ubuntu-latest` thành `runs-on: self-hosted`.

Mọi thứ khác giữ nguyên. Máy tính chỉ cần bật lúc 15h35 các ngày giao dịch.

## Cấu trúc code

```
config.yaml            cài đặt (anh sửa ở đây)
run.py                 lệnh chạy
app/data/              tải dữ liệu: vci.py, tcbs.py, yahoo.py, update.py, normalize.py
app/analysis/
  indicators.py        hơn 30 chỉ báo kỹ thuật
  patterns.py          Elliott, Wyckoff, Dow, mô hình giá, Harmonic, Fibonacci, hỗ trợ/kháng cự
  technical.py         tổng hợp tín hiệu kỹ thuật
  fundamentals.py      chỉ số tài chính, Piotroski, cổ tức, so sánh ngành
  forecast.py          dự phóng 5 năm 3 kịch bản, DCF, DDM
  valuation.py         định giá đa phương pháp, biên an toàn
  strategy.py          9 phương pháp chấm điểm, 5 rổ, tín hiệu mua/bán, cỡ vị thế
  portfolio.py         tư vấn danh mục đang nắm
  backtest.py          kiểm chứng quá khứ + đo độ tin cậy mô hình sóng
  market.py            đèn thị trường, độ rộng, bản đồ ngành
app/build.py           chạy toàn bộ, xuất dữ liệu cho web
app/notify.py          Telegram
site/                  trang web
functions/api/         API lưu danh mục (Cloudflare)
```
