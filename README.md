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

Chưa làm bước này thì nút trên web sẽ dẫn anh sang trang GitHub Actions để bấm chạy, và lịch chạy 11:35 / 14:35 / 15:35 chỉ dựa vào lịch của GitHub (hay trễ vài tiếng). Làm xong, lượt đầy đủ kế tiếp tự cài hẹn giờ Cloudflare để chạy đúng giờ.

---

## Nhiều người dùng & gói hội viên

Khi gắn cơ sở dữ liệu Cloudflare D1, trang chuyển sang chế độ nhiều người dùng. Chưa gắn D1 thì trang chạy như cũ: một chủ sở hữu, đăng nhập qua Cloudflare Access.

**Bật lần đầu (làm một lần):**
1. Cloudflare → My Profile → API Tokens → sửa token đang dùng cho GitHub (`CF_API_TOKEN`) → thêm quyền **Account · D1 · Edit** → Save. Lượt chạy kế tiếp tự tạo D1 `vnstock`, gắn vào trang, tự tạo bảng, khoá phiên và khoá thông báo đẩy.
2. Mở trang → bị chuyển sang `/login` → **Đăng ký** bằng email trong `OWNER_EMAIL` (nếu chưa đặt `OWNER_EMAIL` thì người đăng ký đầu tiên). Người này thành quản trị viên, không cần mã mời. Danh mục, theo dõi, khẩu vị đang có trong KV được chép sang tài khoản này.
3. Kiểm tra mọi thứ chạy đúng (đăng nhập, Danh mục, chuông thông báo), rồi Cloudflare Zero Trust → Access → Applications → **xoá ứng dụng bảo vệ vn-stock.pages.dev**, để người khác vào được trang đăng nhập.
4. (Tuỳ chọn) Quản trị → Cấu hình:
   - Google Client ID: Google Cloud Console → Credentials → OAuth client ID (Web), thêm địa chỉ trang vào *Authorized JavaScript origins*.
   - SMTP Gmail để gửi email: mật khẩu ứng dụng tạo ở myaccount.google.com/apppasswords.

**Hằng ngày:**
- **Mời người dùng**: Quản trị → Mã mời → tạo mã, chọn gói và số ngày dùng gói → gửi liên kết `…/login#invite=MÃ`. Ai đăng ký không có mã sẽ ở trạng thái *chờ duyệt*; anh nhận thông báo và duyệt ở Quản trị → Người dùng. Ở đó anh cũng đổi gói, ngày hết hạn, khoá tài khoản và tạo liên kết đặt lại mật khẩu.
- **Gói Miễn phí / Pro**: bảng quyền lợi nằm ở `functions/_lib/plans.json`. Server tự chặn dữ liệu theo gói:
  - tệp `swing`, `flow`, `pairs`, kiểm chứng: trả lỗi 402 với gói Miễn phí;
  - trang mã và danh sách MUA: lược bỏ các phần chuyên sâu.

  Gói hết hạn tự về Miễn phí. Chưa có thanh toán tự động: anh bật gói bằng tay.
- **Mỗi người có dữ liệu riêng**: danh mục, theo dõi, cảnh báo, khẩu vị, nhật ký. Các lượt 11:35 / 14:35 / 15:35 tính tư vấn mức thoát, cảnh báo giá và mã đồng pha cho từng người (`app/personal.py`, `app/users.py`), rồi tạo thông báo:
  - **chuông trên web**: mọi gói;
  - **thông báo đẩy** điện thoại / máy tính: Pro (`app/webpush.py`, iPhone cần "Thêm vào Màn hình chính");
  - **email**: Pro.

  Mỗi người tự chọn mức gửi ở trang Tài khoản. Telegram vẫn chỉ gửi cho chủ sở hữu.
- **Bản tin thị trường** (`#/digest`, trang chủ của gói Miễn phí): chỉ số, độ rộng, thanh khoản, ngành, mã kéo / đè chỉ số, tăng / giảm mạnh, khối lượng đột biến, dòng tiền lớn, tâm lý, phiên bất thường, sự kiện 7 ngày tới, tin tức. Mỗi phiên một bản, có lưu trữ (`app/digest.py`).
- **Bảo mật**:
  - mật khẩu băm PBKDF2;
  - cookie phiên HttpOnly ký HMAC, tự kiểm tra lại tài khoản 10 phút / lần;
  - chặn dò mật khẩu: 8 lần sai thì khoá 15 phút;
  - chặn gửi yêu cầu từ trang khác;
  - "Đăng xuất mọi thiết bị";
  - nhật ký quản trị.

⚖️ Trước khi thu phí: dịch vụ tư vấn đầu tư chứng khoán ở Việt Nam là ngành nghề kinh doanh có điều kiện (Luật Chứng khoán 2019). Ngoài ra cần xem lại điều khoản dùng lại dữ liệu giá của nguồn và quy định bảo vệ dữ liệu cá nhân. Nên hỏi luật sư.

## Dùng hằng ngày

- **Mở web trên điện thoại.** Trên iPhone: Safari → nút Chia sẻ → **Thêm vào MH chính**, web sẽ hiện như một ứng dụng.
- **Trang Hôm nay:**
  - Đèn thị trường, và số % vốn được phép nắm cổ phiếu.
  - Danh sách MUA, mỗi mã có vùng giá mua, điểm cắt lỗ, mục tiêu và số cổ phiếu.
  - Việc cần làm với danh mục đang nắm.
- **Ngành → Toàn cảnh:** mọi ngành trên một trang – P/E, P/B gia quyền và trung vị của từng ngành so với toàn thị trường và với lịch sử 6 năm của chính ngành, bản đồ P/B–ROE, P/E–tăng trưởng, bảng so sánh đầy đủ và biểu đồ P/E từng ngành theo quý. P/E của mỗi mã luôn hiện kèm P/E ngành và P/E thị trường (trang mã, Bộ lọc, Hôm nay).
- **Ngành:** chọn một ngành (hoặc nhóm ngành con) bên trái, rồi chọn **phương án**: Tốt nhất ngành (đã kiểm chứng), GARP, Tăng trưởng, Giá trị, Chất lượng, Cổ tức, Phòng thủ, Dòng tiền thông minh, Động lượng, hoặc Tuỳ chỉnh. Mã được xếp hạng so với chính các mã cùng ngành. Bấm **＋ Tự nhóm ngành / mã** để tự gộp nhiều ngành, nhóm ngành con và mã lẻ thành một nhóm riêng (ví dụ "Đầu tư công") rồi chạy các phương án trên nhóm đó; ở Bộ lọc có nút **Lưu thành nhóm** để biến kết quả lọc thành nhóm. Trang còn có biểu đồ xoay vòng ngành (RRG), P/E ngành so với lịch sử và kết quả backtest chọn mã trong ngành đó.
- **Triển vọng ngành** (đầu trang Ngành, trang Hôm nay, từng trang ngành): ngành **đáng đầu tư / trung tính / nên tránh** cho 3–6 tháng và 12 tháng tới. 3–6 tháng: độ rộng (% mã trên MA200), tăng trưởng lợi nhuận, đà giá 6 và 3 tháng so với VN-Index; 12 tháng: ngành tụt mạnh 12 tháng qua (thường hồi), tăng trưởng lợi nhuận, P/E rẻ so với lịch sử ngành. Mục "Dự báo này đúng đến đâu?" cho kết quả kiểm chứng từng tháng từ 2014/2020: chênh lệch nhóm điểm cao – thấp, tỷ lệ đúng từng nửa giai đoạn, tương quan từng yếu tố (`app/analysis/sector_outlook.py`).
- **Đa khung thời gian:** biểu đồ mã, VN-Index, chỉ số ngành đổi được nến **ngày / tuần / tháng / quý / năm** (dữ liệu từ 2014); bảng xu hướng, cấu trúc đỉnh–đáy, RSI, MACD, động lượng cho từng khung và câu kết luận đồng thuận / mâu thuẫn (ví dụ "điều chỉnh ngắn hạn trong xu hướng tăng dài hạn"). Bộ lọc có chiều nhìn "Đa khung" và mẫu "Tăng đồng thuận mọi khung", "Tháng tăng, ngày điều chỉnh" (`app/analysis/mtf.py`).
- **Mùa vụ:** "Ngày dd/mm các năm trước" – mua đúng ngày này mỗi năm rồi giữ 1/2/3 tháng thì lãi bao nhiêu, mấy năm lãi, hơn VN-Index bao nhiêu; bảng 12 tháng mạnh/yếu cho mã, ngành và VN-Index; lợi nhuận theo tháng/năm. Trang Hôm nay có dải **Mùa vụ đang tới**: ngành/mã vào mùa mạnh (≥ 8 năm dữ liệu, ≥ 75% số năm hơn VN-Index, trung bình hơn ≥ 3%) chia làm "năm nay ủng hộ – nên để ý" và "năm nay chưa ủng hộ – chờ" (dựa trên triển vọng ngành, đa khung, lợi nhuận). Kèm kiểm chứng ngoài mẫu: mỗi năm chỉ dùng các năm trước để đoán (`app/analysis/seasonal.py`).
- **Cách định giá (đã rà soát và kiểm chứng lại 10/2026):**
  - Giá trị hợp lý = trung bình có trọng số của P/E mục tiêu × EPS 12 tháng (35%), P/B mục tiêu × BVPS (15%), DCF dòng tiền tự do (25%), DDM (20%, chỉ DN trả ≥ 60% lợi nhuận làm cổ tức); ngân hàng/CTCK/bảo hiểm thêm P/B hợp lý theo ROE. Phương pháp càng lệch xa trung vị càng ít trọng số.
  - P/E, P/B mục tiêu = mặt bằng **ngành** điều chỉnh theo ROE của mã so với ngành (P/E ±30%, P/B 0,5–2,5 lần). Không dùng P/E/P/B lịch sử của chính mã làm mục tiêu: kiểm chứng 2019–2026 cho thấy "rẻ so với lịch sử của chính mã" không dự báo được lợi nhuận (IC −0,02), còn "rẻ so với ngành có tính ROE" thì có (IC 0,035, t 2,2).
  - Chi phí vốn ke = max(3,2% + max(beta; 1) × 8% + phần bù quy mô 1–2%; 12%).
  - **DCF dự phóng rõ vay nợ và đầu tư** (`app/analysis/forecast.py`, bản JS giống hệt trong tab Dự phóng): EBIT − lãi vay (lãi suất = chi phí lãi 12 tháng ÷ dư nợ vay bình quân, 3–15%; dư nợ = nợ/vốn chủ × vốn chủ) → lợi nhuận; FCFE = lợi nhuận + khấu hao − đầu tư TSCĐ − tăng vốn lưu động + vay ròng. Đầu tư TSCĐ đi từ nhịp 2 năm gần nhất về mức duy trì (khấu hao + tăng trưởng × TSCĐ/doanh thu). Mục **Kế hoạch đầu tư mới** cho nhập dự án chưa có trong BCTC (tổng vốn, số năm, % vay, doanh thu và biên EBIT khi chạy đủ – vd. PVT đóng tàu, DN vay xây nhà máy); DN đầu tư TSCĐ ≥ 1,8 lần khấu hao được cảnh báo "đang trong chu kỳ đầu tư lớn". Kiểm tra chéo FCFF chiết khấu theo WACC rồi trừ nợ ròng; kịch bản Xấu/Tốt đổi cả lãi suất vay (+1,5 / −1 điểm %). DCF **bị tắt** khi > 90% giá trị nằm ở cuối kỳ (hoặc > 85% và FCFE 5 năm âm); giảm ½ trọng số khi kịch bản tốt/xấu chênh > 2,5 lần hoặc FCFF lệch FCFE > 2 lần.
  - Mua an toàn dưới = thấp hơn của (hợp lý × 80%) và (trung vị các phương pháp × 90%).
- **Lợi nhuận chuẩn hoá (mọi mã):** lợi nhuận 12 tháng lệch quá 60% so với mức bình thường (trung vị 20 quý) – đỉnh/đáy chu kỳ, lãi bất thường – thì định giá dùng ½ hiện tại + ½ bình thường (cả P/E lẫn biên gộp khởi điểm của DCF; ngân hàng/CTCK dùng lợi nhuận chuẩn hoá). Trang mã hiện **mục tiêu có điều kiện**: nếu lợi nhuận giữ mức 12 tháng / đang dùng / nếu về mức bình thường, kèm quý tăng vọt và tỷ lệ lợi nhuận thành tiền. Kiểm chứng: dự báo ngang/nhỉnh hơn P/E 12 tháng (IC 0,038 so với 0,036) nhưng không bị lợi nhuận đỉnh chu kỳ đánh lừa.
- **Rổ Phòng thủ:** điểm "ít biến động" tính cả biến động 3 tháng gần nhất; mã tăng > 20%/tháng hoặc RSI > 75 không vào rổ.
- **Dòng tiền lớn** (Biến động → Dòng tiền lớn): mỗi ngày quét mã thanh khoản tìm *gom âm thầm* (KL ≥ 1,5 lần bình thường nhiều phiên, giá đi ngang, đóng cửa cao, KL phiên tăng > phiên giảm), *xả âm thầm* (ngược lại) và *bứt phá có KL*; kèm số phiên liên tiếp, mua − bán chủ động 10 phiên (khớp lệnh theo bước giá), lệnh cá mập (mã anh nắm/theo dõi). Kiểm chứng từ 2016: xả âm thầm → 20 phiên sau kém VN-Index; gom âm thầm đơn thuần không dự báo được "game"; bứt phá có KL tăng xác suất có nhịp +20% trong 60 phiên. Telegram nhắn khi mã của anh bắt đầu gom/xả/bứt phá (`app/analysis/flow.py`).
- **Hôm nay nên làm gì** (đầu trang Hôm nay; gói Miễn phí: đầu Bản tin, chỉ phần bán/giảm tỷ trọng): so tỷ trọng cổ phiếu đang nắm với mức đèn cho phép rồi ra danh sách lệnh cụ thể – bán mã chạm mức thoát, bán bớt nếu nắm quá nhiều (khi đó không mua mới), mua mã trong vùng mua với khối lượng giới hạn bởi tỷ trọng/mã và rủi ro ≈ 1,5% tổng tài sản, cơ hội sau sự kiện tỷ trọng nhỏ; nút sao chép lệnh. Kèm kiểm chứng đèn thị trường 2015–2026 (`app/analysis/stance.py`): đèn không đoán được hướng VN-Index (60 phiên sau đèn Đỏ TB +2,8% như mọi lúc) nhưng đo được rủi ro sụt sâu (xác suất sụt ≥ 20% trong 60 phiên 9% so với 4% khi đèn Xanh) → giữ tỷ trọng thấp chứ không đứng ngoài hẳn. Trang mã có dòng "Vào bao nhiêu?" theo cùng công thức.
- **Mã liên quan & chiến thuật** (trang mã, ngay dưới phần tín hiệu; toàn thị trường ở Biến động → Mã liên quan): mở mã X là thấy các mã Y đi cùng nhịp (tương quan lợi nhuận *vượt VN-Index* theo tuần, 2 năm và dài hạn), beta, xác suất cùng sụt ≥ 10% trong cùng 4 tuần, biểu đồ tương quan lệch −8…+8 tuần, trạng thái vào lệnh và vùng mua/cắt lỗ của Y, và chiến thuật: né cả nhóm khi né X vì lý do ngành, mã cùng nhịp vào được thay X (khi X đắt/nóng/chưa vào được), mã gần vùng mua nhất để đặt cảnh báo, cảnh báo bẫy "mã kia đã chạy thì mã này sẽ bắt kịp". Quan hệ "X chạy trước Y L tuần" chỉ được công nhận khi tìm thấy trên 2016–2022 **và** còn đúng trên 2023–nay; hệ thống so số cặp tìm được với số cặp kỳ vọng do may rủi. Kết quả hiện tại: ~2 cặp trên ~43.000 phép thử (may rủi đã cho ~0,7) → thị trường VN gần như không có quan hệ dẫn dắt vài tuần đủ tin cậy; các mã liên quan đi **cùng lúc**. Telegram nhắn khi anh nắm hai mã đồng pha mạnh, hoặc có cặp dẫn dắt đã kiểm chứng chạm mã của anh (`app/analysis/pairs.py`, `app/pairs_build.py`).
- **Tâm lý thị trường 0–100** (Hôm nay và Biến động → Tâm lý): độ rộng, tỷ lệ phiên tăng, đỉnh mới − đáy mới, thanh khoản, đà VN-Index, xếp hạng so với 2 năm; kèm lịch sử và kiểm chứng theo nhóm điểm.
- **Điều kiện "Mua được"**: đúng xu hướng (giá > MA50 > MA200) + giá ≤ mua an toàn (hoặc rổ không cần định giá) + **nằm trong danh sách MUA**. Mã đang kéo giãn (cách EMA20 > 2,5 ATR hoặc tăng > 25%/tháng) → chia 2 lệnh: 1/2 ngay, 1/2 LO ở giá −1 ATR trong 10 phiên. Kiểm chứng 2016–2026 trên mã xu hướng tăng: RSI cao, giá sát dải Bollinger trên, MACD co lại **không** làm lợi nhuận 5–60 phiên sau kém đi (RSI > 75: +2,4% so với VN-Index sau 20 phiên), nhưng mức sụt sau khi mua sâu hơn – nên chia lệnh thay vì cấm mua.
- **Giả định dự phóng riêng từng công ty:** tăng trưởng năm 1 / năm 3 / dài hạn, biên gộp và chi phí hiện tại → dài hạn, tỷ lệ lợi nhuận thành tiền, ROE – đều suy ra từ lịch sử 8 năm của chính doanh nghiệp (kéo về ngành khi lịch sử thất thường), mỗi ô ghi rõ nguồn và có bảng lịch sử để đối chiếu.
- **Chỉ số hướng tương lai / quá khứ** (trang mã, Bộ lọc → chiều nhìn "Tương lai/Quá khứ", Kiểm chứng): 15 chỉ số được chia nhóm theo mức "nhìn về phía trước" – P/E dự phóng, triển vọng ngành, mùa vụ, tăng tốc lợi nhuận, PEG, dòng tiền CMF, P/E so với lịch sử là nhóm tương lai; đà giá, P/E hiện tại, MA200, tăng trưởng đã báo cáo, ROE, biên lãi, nợ vay là nhóm quá khứ (chỉ số lai được chia tỷ lệ cho cả hai nhóm). Mỗi mã có **điểm tương lai**, **điểm quá khứ** và **điểm tổng** sau khi áp trọng số, kèm khuyến nghị riêng cho từng kiểu. Trọng số từng chỉ số lấy từ tương quan với lợi nhuận 3 tháng sau (từ 2019, chỉ dùng dữ liệu đã công bố tại thời điểm đó); chỉ số không có tác dụng nhận trọng số 0.
  - Giả thuyết "mỗi mã cần tỷ trọng tương lai/quá khứ khác nhau" được kiểm định bằng cách ước lượng trọng số riêng của từng mã ở nửa đầu giai đoạn rồi xem nửa sau có lặp lại không. Nếu không lặp lại (khác biệt chỉ là nhiễu), cả thị trường dùng trọng số chung; trang mã vẫn hiện tỷ trọng riêng mà lịch sử mã đó gợi ý. Kiểm định chạy lại hằng tuần, đạt thì tự chuyển sang trọng số riêng (`app/analysis/fwdback.py`).
- **Việc anh nên làm – từng bước** (trang mã và từng mã MUA ở Hôm nay): kết luận, số tiền / số cổ phiếu, chia lệnh, giá không mua đuổi, điểm dừng lỗ và số tiền mất nếu chạm, chốt lời từng phần, ngày hàng về, mốc xem lại (hạn BCTC, sau 20 phiên) và điều kiện bỏ kế hoạch. Mã đang nắm thì hiện mức thoát gần nhất và việc cần làm ngay.
- **Lịch chạy – 3 lượt mỗi ngày giao dịch:** **11:35** và **14:35** (lượt trong phiên, ~1–2 phút: giá trực tiếp, cảnh báo, Telegram) và **15:35** (lượt đầy đủ sau đóng cửa); 8:00 thứ 7 tải lại BCTC, cổ tức, backtest. Giờ chạy do một Cloudflare Worker hẹn giờ (`worker/`) kích hoạt đúng giờ; lịch của GitHub vẫn giữ làm dự phòng (GitHub hay trễ vài tiếng) và lượt nào đã chạy rồi sẽ tự bỏ qua (`scripts/slot.py`). Cần secret `GH_DISPATCH_TOKEN` (Bước 7) – có rồi thì lượt đầy đủ kế tiếp tự cài Worker.
- **Biến động & đảo chiều** (tab Biến động, `#/swing`):
  - *Trong phiên* (11:35, 14:35): việc của anh ngay bây giờ – mức thoát hàng đã chạm/sắp chạm theo giá cao/thấp trong phiên, cảnh báo giá, mã mua đang trong vùng mua hoặc đã vượt giá không nên mua đuổi; bảng giá trong phiên với cao/thấp, cách đỉnh phiên, sáng/chiều, **KL so với cùng giờ** các phiên trước, khối ngoại ròng và các dấu hiệu: xả từ đỉnh phiên, kéo từ đáy, chạm trần rồi rời, chạm sàn rồi kéo, sáng tăng ở mã hay bị xả buổi chiều, sáng đẩy – chiều xả, KL bất thường.
  - *Phiên gần nhất*: mã có phiên đẩy rồi xả + KL lớn (phân phối), đạp rồi kéo + KL lớn, chạm trần/sàn rồi rời, sáng đẩy – chiều xả, kéo/đạp ATC… mỗi mã kèm **kết quả lịch sử** của đúng kiểu phiên đó (từ 2016, 5 phiên sau so với VN-Index, có ổn định qua 2 giai đoạn không), "nên làm" suy ra từ kết quả đó, và tin CafeF/VnExpress nhắc mã trong 3 ngày.
  - *Bảng hành vi giá*: điểm bất thường 0–100 và **kiểu chơi** của từng mã (đẩy sáng – xả chiều, đạp sáng – kéo chiều, hay kéo/đạp ATC, kéo trần rồi xả, nhiều phiên phân phối, biên độ rộng giằng co…) từ nến ngày 120 phiên, nến giờ ~3 năm và nến phút ~6 tháng (tải dần mỗi lượt).
  - *Kiểm chứng*: mỗi kiểu phiên sau đó giá đi đâu; điểm bất thường dự báo rất tốt **độ biến động** 20 phiên sau nhưng không dự báo được lãi/lỗ – dùng để chọn cách vào lệnh (dừng rộng hơn, không mua đuổi), không dùng để chọn mã.
  - Trang mã có khung **Hành vi giá & tay chơi lớn**: đường đi trung bình trong phiên của mã so với thị trường (và hôm nay), 10 phiên gần nhất sáng/chiều/ATC, lệnh **Cá mập / Sói / Cừu** mua − bán ròng (mã anh nắm/theo dõi) (`app/analysis/swing.py`, `app/live.py`, `app/data/intraday.py`).
- **Bộ lọc:** nút "chiều nhìn" (Tổng quan, Định giá, Chất lượng, Tăng trưởng, Cổ tức, Kỹ thuật, Tạo lập & dòng tiền, Điểm phương pháp) đổi bộ cột; có nút tải CSV. Hàng **Bộ lọc mẫu** (Rẻ + chất lượng, Cổ tức cao, Xu hướng tăng…) lọc bằng một chạm; **＋ Lưu bộ lọc hiện tại** để lưu bộ lọc + chiều nhìn của riêng anh (đồng bộ mọi thiết bị). Tick ô đầu dòng để chọn nhiều mã → **So sánh** hoặc **Theo dõi tất cả**.
- **Theo dõi:** bấm ☆ ở bất kỳ đâu (trang mã, Hôm nay, Bộ lọc) để đưa mã vào danh sách theo dõi; mỗi mã có ghi chú riêng và **🔔 cảnh báo giá** (giá giảm tới ≤, tăng tới ≥, biến động trong phiên ≥ %, hoặc khi mã vào danh sách MUA). Sau mỗi phiên hệ thống kiểm tra và nhắn Telegram một lần khi điều kiện xảy ra. Tab **Lịch sự kiện**: chốt quyền cổ tức đã công bố, hạn BCTC, ngày hàng về T+2 và hạn xem lại vị thế của mã anh đang nắm/theo dõi.
- **So sánh 2–4 mã:** bảng đặt cạnh nhau (P/E, P/E ngành, P/B, ROE, tăng trưởng, cổ tức, kỹ thuật, điểm từng phương pháp, kế hoạch từng phong cách), ô xanh là tốt nhất; biểu đồ giá cùng gốc 100 so với VN-Index và P/E theo quý.
- **Giải thích chỉ số:** mọi chữ viết tắt / ký hiệu có gạch chấm bên dưới (P/E GQ, TV, vs LS, ROE, PEG, RRG, F-Score, SMC, Sharpe, 3R, T+2…) – rê chuột (máy tính) hoặc chạm (điện thoại) để xem nghĩa, công thức, cao nghĩa là gì, thấp nghĩa là gì. Toàn bộ từ điển ở trang Hướng dẫn, tìm được cả trong ô tìm nhanh. Nội dung nằm trong `site/glossary.js`.
- **Xuất PDF** (nút PDF trên thanh đầu trang): *Trang đang xem → PDF* hoặc *Báo cáo tổng hợp* (chọn các trang: Hôm nay, Danh mục, Trong phiên, Biến động, Thị trường, Ngành, từng mã đang nắm / trong danh sách mua) – có bìa, mục lục, số trang; giữ nguyên giao diện như trên web, mở hết các phần thu gọn, bảng rộng được thu cho vừa khung, cắt trang ở mép khung. Mỗi trang ghi dữ liệu phiên nào, phân tích lúc nào, giá trong phiên lúc nào.
- **Thời điểm cập nhật** hiện cạnh logo: lần cập nhật gần nhất (chấm đỏ = giá trong phiên hôm nay, vàng = dữ liệu cũ hơn 30 giờ); rê chuột để xem chi tiết.
- **Tìm nhanh:** Ctrl/⌘ + K hoặc phím **/** – gõ mã, tên công ty, ngành, tên trang, hoặc lệnh như "so sánh FPT HPG", "mua VNM", "cảnh báo HPG". Phím tắt **g** rồi **h** (Hôm nay), **n** (Ngành), **l** (Lọc), **t** (Theo dõi), **d** (Danh mục), **c** (So sánh), **k** (Kiểm chứng).
- **Danh mục → Đang nắm:** mỗi mã có thước giá (dừng lỗ – giá vốn – giá – giá trị hợp lý), giá hoà vốn sau phí, sụt từ đỉnh kể từ khi mua, số phiên đã nắm, ngày được bán (T+2), và nút **Mua thêm / Bán một phần / Bán hết**. Mỗi lần bán, lãi/lỗ đã chốt (theo giá vốn bình quân như CTCK, trừ phí + thuế) được ghi lại; khung **Kế hoạch cơ cấu** gợi ý bán bớt / mua thêm bao nhiêu cổ phiếu theo tư vấn, trần tỷ trọng và đèn thị trường.
- **Kế hoạch thoát hàng** (trong mỗi thẻ mã đang nắm): bảng các mức bán định sẵn theo phong cách đã mua – giá, bán bao nhiêu (1/2, 1/3, 2/3, hết), số cổ phiếu, tiền về sau phí + thuế và lãi/lỗ của phần đó; trạng thái *còn x% / sắp chạm / ĐÃ CHẠM / đã làm*. Bấm **Bán** ở một mức để ghi lệnh đúng khối lượng; mức đó được đánh dấu đã làm.
  - Trung hạn: dừng = max(giá vốn − 20%, đỉnh sau mua − 3×ATR) → bán hết; giá trị hợp lý +10% → bán 1/2; vùng giá trị cao → bán phần còn lại; xem lại sau 60 phiên chưa lãi.
  - Lướt sóng: dừng 2,5×ATR (5–10%) dời theo đỉnh, về hoà vốn khi lãi 1,5R; 3R → bán 2/3; 4R → bán hết; hết 20 phiên hoặc đóng cửa dưới EMA20 2 phiên → bán hết.
  - Dài hạn: không cắt lỗ theo giá (xem lại khi −25%); giá trị hợp lý +20% → bán 1/3; +40% → bán thêm 1/2 phần còn lại, giữ 1/3.
  - Cổ tức: xem lại khi −20%; lợi suất còn 3,5% → bán 1/2; còn 3% → bán hết.
  - Đổi phong cách cho từng mã, hoặc đặt **mức riêng** (dừng lỗ, chốt lời + % bán) thay cho mức hệ thống. Telegram nhắn khi giá cách một mức ≤ 3% (⏳ SẮP CHẠM) và khi chạm.
- **Phong cách đầu tư** (Danh mục → Khẩu vị → 1. Chọn phong cách): Lướt sóng (1–4 tuần, thuần kỹ thuật, cắt lỗ theo ATR), Trung hạn theo xu hướng (cấu hình gốc), Đầu tư dài hạn (doanh nghiệp chất lượng, mua dần 3 lần, không cắt lỗ theo giá), Cổ tức (mua ở lợi suất ≥ 6%). Mỗi phong cách có danh sách mã, vùng mua, điểm dừng, mục tiêu riêng và kết quả kiểm chứng riêng; trang Hôm nay và trang mã có nút chuyển giữa các phong cách.
- **Danh mục → Khẩu vị đầu tư:** kéo phân bổ rổ, % cổ phiếu theo từng màu đèn, mức cắt lỗ, số mã… và thấy ngay lãi/năm, mức sụt, từng năm nếu đã làm như vậy từ 2020. Nút **Tự tìm phương án tốt nhất trong giới hạn sụt** thử hàng chục nghìn tổ hợp. Bấm **Lưu** thì lượt chạy kế tiếp dùng khẩu vị này thay cho config.yaml (có thể loại trừ ngành/mã không muốn mua).
- **Danh mục → Nhật ký giao dịch:** ghi mỗi lệnh mua/bán kèm lý do; hệ thống tự lưu nó đang khuyên gì lúc đó và tự cập nhật danh mục. Sau vài tháng sẽ thấy lệnh "theo hệ thống" và "tự quyết" cái nào tốt hơn, và có hay bán non không.
- **Kiểm tra lệnh trước khi đặt** (hộp Mua ở mọi trang và khung Ghi lệnh): tiền mặt, tỷ trọng mã và ngành sau lệnh, tổng cổ phiếu so với đèn, số tiền mất nếu chạm cắt lỗ so với rủi ro/lệnh, mã có trong danh sách MUA / đang có sự kiện / lợi nhuận xấu đi / hệ thống đang khuyên bán, lệnh bằng bao nhiêu % GTGD một phiên, đồng pha với mã đang nắm → kết luận Đạt / Lưu ý / Không nên và khối lượng lớn nhất hợp lệ (bấm để dùng).
- **Nếu làm theo hệ thống** (Nhật ký, gói Pro): lãi/lỗ thực tế từng tháng dựng lại từ nhật ký + danh mục theo giá đóng cửa (gồm phí), so với cùng tổng vốn đi theo danh mục mẫu của phong cách đang chọn (mô phỏng cho các tháng trước khi có theo dõi thực tế, số thật sau đó) và VN-Index; biểu đồ cộng dồn, số lệnh theo/tự/ngược hệ thống, mã hệ thống chọn mà anh không mua (`app/report.py`).
- **Báo cáo tuần** (sáng thứ 7, `#/report`, gói Pro): thị trường tuần qua, danh mục, lệnh trong tuần, rủi ro (tỷ trọng, ngành, sát mức dừng, đồng pha, sụt từ đỉnh), kế hoạch tuần tới và tháng này so với hệ thống – in hoặc lưu PDF; nhiều người dùng: email + thông báo; một người dùng: Telegram. Chạy thử ngày thường: `VNSTOCK_WEEKLY=1`.
- **Kiểm chứng → Theo dõi thực tế:** mỗi ngày hệ thống ghi lại danh sách MUA rồi đo kết quả sau 5/20/60 phiên và chạy một danh mục giấy làm đúng theo hệ thống – kết quả không thể "tối ưu ngược" như backtest.
- **Danh mục:** nhập số vốn và các mã đang nắm (mã, khối lượng, giá vốn). Dữ liệu đồng bộ giữa mọi thiết bị.
- **Telegram:** chỉ nhắn khi có việc. Ngày nào không có tin nghĩa là không cần làm gì.
- **Bấm vào một mã** để xem biểu đồ, toàn bộ chỉ báo, sóng Elliott/Wyckoff, SMC (BOS/CHoCH, Order Block, FVG), VSA, Order Flow (footprint), báo cáo tài chính, dự phóng 5 năm, định giá và so sánh cùng ngành.
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
