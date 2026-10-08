/* Từ điển chỉ số – rê chuột (hoặc chạm) vào chữ viết tắt / ký hiệu ở bất kỳ đâu để xem:
   nghĩa là gì, công thức, cao nghĩa là gì, thấp nghĩa là gì.
   t: tên đầy đủ · d: nghĩa · f: công thức · hi: khi cao · lo: khi thấp · n: lưu ý  */
const GLOSS = {
  // ---------------- định giá
  pe: { t: "P/E – Giá trên lợi nhuận", d: "Nhà đầu tư đang trả bao nhiêu đồng cho 1 đồng lợi nhuận một năm của doanh nghiệp.", f: "Giá ÷ EPS 4 quý gần nhất = Vốn hoá ÷ Lợi nhuận sau thuế cổ đông mẹ 12 tháng", hi: "Đắt, hoặc thị trường kỳ vọng lợi nhuận còn tăng mạnh.", lo: "Rẻ, hoặc thị trường nghi lợi nhuận không bền (lãi đột biến, ngành chu kỳ đang đỉnh).", n: "Doanh nghiệp đang lỗ thì không có P/E (hiện —). Luôn so với P/E ngành, thị trường và lịch sử của chính mã." },
  pe_w: { t: "P/E gia quyền (GQ)", d: "P/E của cả nhóm như thể là một công ty: mã vốn hoá lớn ảnh hưởng nhiều hơn – cùng cách tính P/E của chỉ số.", f: "Tổng vốn hoá ÷ Tổng lợi nhuận 12 tháng của các doanh nghiệp có lãi trong nhóm", hi: "Cả nhóm (hoặc vài mã lớn) đang được định giá cao.", lo: "Nhóm đang rẻ – thường kéo bởi các mã lớn.", n: "Vài mã vốn hoá lớn có thể chi phối – xem thêm P/E trung vị." },
  pe_med: { t: "P/E trung vị (TV)", d: "P/E của doanh nghiệp \"điển hình\" trong nhóm – không bị vài mã lớn kéo lệch.", f: "Xếp P/E các doanh nghiệp có lãi từ thấp đến cao, lấy giá trị đứng giữa", hi: "Phần lớn doanh nghiệp trong nhóm đang đắt.", lo: "Phần lớn doanh nghiệp trong nhóm đang rẻ.", n: "GQ thấp mà TV cao = vài mã lớn rẻ, còn số đông vẫn đắt (và ngược lại)." },
  pe_ind: { t: "P/E ngành", d: "P/E trung vị của các doanh nghiệp cùng ngành – mốc để so mã này đắt hay rẻ trong ngành.", f: "Trung vị P/E các doanh nghiệp có lãi cùng ngành (cấp 2)", hi: "Cả ngành đang được trả giá cao.", lo: "Cả ngành đang rẻ hoặc bị né tránh." },
  pe_mkt: { t: "P/E thị trường (TT)", d: "P/E của toàn bộ HOSE + HNX + UPCoM (các mã có báo cáo tài chính).", f: "Gia quyền: tổng vốn hoá ÷ tổng lợi nhuận 12 tháng · Trung vị: P/E đứng giữa của mọi doanh nghiệp có lãi", hi: "Thị trường chung đắt – kỳ vọng sinh lời thấp hơn, rủi ro điều chỉnh cao hơn.", lo: "Thị trường chung rẻ – thường là vùng tích sản tốt nếu lợi nhuận không sụt." },
  vs_ind: { t: "So với ngành", d: "Chỉ số của mã cao/thấp hơn mức chung của ngành bao nhiêu %.", f: "Chỉ số của mã ÷ chỉ số ngành − 1", hi: "Dương (đỏ): đắt hơn ngành.", lo: "Âm (xanh): rẻ hơn ngành – cần xem vì sao (chất lượng kém hơn? hay bị bỏ quên?)." },
  vs_mkt: { t: "So với thị trường (vs TT)", d: "Chỉ số của dòng này cao/thấp hơn toàn thị trường bao nhiêu %.", f: "Chỉ số của dòng ÷ chỉ số toàn thị trường − 1", hi: "Dương (đỏ): đắt hơn thị trường chung.", lo: "Âm (xanh): rẻ hơn thị trường chung." },
  vs_hist: { t: "So với lịch sử (vs LS)", d: "Định giá hiện tại so với mức thường thấy của chính nó từ 2020 đến nay (theo từng quý).", f: "Giá trị hiện tại ÷ trung vị các quý từ 2020 − 1", hi: "Dương (đỏ): đắt hơn thường lệ.", lo: "Âm (xanh): rẻ hơn thường lệ – cơ hội nếu lợi nhuận không xấu đi." },
  pctl_hist: { t: "Phân vị lịch sử", d: "Mức P/E hiện tại đứng ở đâu trong lịch sử của chính nó: 0 = thấp nhất từng thấy, 100 = cao nhất.", f: "% số quý từ 2020 có P/E thấp hơn hiện tại", hi: "Gần 100 (đắt): hiếm khi đắt như bây giờ.", lo: "Gần 0 (rẻ): hiếm khi rẻ như bây giờ.", n: "Nhãn: rẻ < 30, TB 30–70, đắt > 70." },
  hist_avg: { t: "Trung bình lịch sử", d: "Mức P/E bình quân từ quý ghi bên cạnh đến nay – để thấy hiện tại cao hay thấp hơn thường lệ.", f: "Trung bình P/E cuối mỗi quý", hi: "Hiện tại cao hơn TB: đắt hơn thường lệ.", lo: "Hiện tại thấp hơn TB: rẻ hơn thường lệ." },
  ctx_ind_mkt: { t: "Mốc so sánh", d: "\"ngành\" = mức trung vị của ngành; \"TT\" = mức trung vị toàn thị trường. Đặt cạnh nhau để biết con số của mã là cao hay thấp.", f: "Trung vị các doanh nghiệp có lãi cùng ngành / toàn thị trường" },
  pb: { t: "P/B – Giá trên giá trị sổ sách", d: "Trả bao nhiêu đồng cho 1 đồng vốn chủ sở hữu trên sổ sách.", f: "Giá ÷ Giá trị sổ sách mỗi cổ phiếu (BVPS) = Vốn hoá ÷ Vốn chủ sở hữu", hi: "Thị trường tin doanh nghiệp sinh lời cao trên vốn (ROE cao), hoặc đang đắt.", lo: "Rẻ so với tài sản, hoặc ROE thấp / tài sản kém chất lượng.", n: "Quan trọng nhất với ngân hàng, chứng khoán, bảo hiểm. Đọc cùng ROE." },
  pb_w: { t: "P/B gia quyền (GQ)", d: "P/B của cả nhóm như một công ty.", f: "Tổng vốn hoá ÷ Tổng vốn chủ sở hữu", hi: "Nhóm đang được trả giá cao so với vốn.", lo: "Nhóm rẻ so với vốn." },
  pb_med: { t: "P/B trung vị (TV)", d: "P/B của doanh nghiệp điển hình trong nhóm.", f: "Giá trị đứng giữa của P/B các doanh nghiệp", hi: "Số đông đắt so với vốn.", lo: "Số đông rẻ so với vốn." },
  ps: { t: "P/S – Giá trên doanh thu", d: "Trả bao nhiêu đồng cho 1 đồng doanh thu năm.", f: "Vốn hoá ÷ Doanh thu 12 tháng", hi: "Đắt, cần biên lợi nhuận cao mới xứng.", lo: "Rẻ so với quy mô bán hàng – hợp với doanh nghiệp đang lãi mỏng có thể cải thiện." },
  ev_ebitda: { t: "EV/EBITDA", d: "Giá toàn doanh nghiệp (cả nợ) so với lợi nhuận trước lãi vay, thuế, khấu hao – so sánh được giữa công ty nợ nhiều và nợ ít.", f: "(Vốn hoá + Nợ vay − Tiền) ÷ EBITDA 12 tháng", hi: "Đắt (thường > 12).", lo: "Rẻ (thường < 6).", n: "Không dùng cho ngân hàng, chứng khoán, bảo hiểm." },
  peg: { t: "PEG – P/E so với tăng trưởng", d: "P/E đã điều chỉnh theo tốc độ tăng lợi nhuận: P/E cao vẫn có thể rẻ nếu lợi nhuận tăng nhanh.", f: "P/E ÷ Tăng trưởng lợi nhuận (%/năm, dùng mức thấp hơn của CAGR 3 năm và 12 tháng)", hi: "> 1,5: đang trả quá nhiều cho tăng trưởng.", lo: "< 1: rẻ so với tốc độ tăng trưởng (rổ GARP yêu cầu ≤ 1,5)." },
  ey: { t: "Lợi suất lợi nhuận (LS lợi nhuận)", d: "Nếu mua cả công ty, mỗi năm nó làm ra bao nhiêu % trên số tiền bỏ ra – nghịch đảo của P/E.", f: "Lợi nhuận 12 tháng ÷ Vốn hoá = 1 ÷ P/E", hi: "Cao: rẻ – so với lãi suất trái phiếu chính phủ để biết có đáng rủi ro không.", lo: "Thấp: đắt – gửi tiết kiệm / trái phiếu có thể hấp dẫn hơn." },
  erp: { t: "Phần bù rủi ro cổ phiếu", d: "Cổ phiếu \"trả\" thêm bao nhiêu % so với trái phiếu chính phủ 10 năm (gần như không rủi ro).", f: "Lợi suất lợi nhuận thị trường − Lợi suất TPCP 10 năm", hi: "Cao (> 4%): cổ phiếu rẻ tương đối, đáng nắm.", lo: "Thấp (< 2%) hoặc âm: cổ phiếu đắt so với trái phiếu." },
  fcf_yield: { t: "Lợi suất dòng tiền tự do (LS FCF)", d: "Tiền mặt thật doanh nghiệp làm ra sau khi đã đầu tư, tính trên giá.", f: "(Dòng tiền kinh doanh − Chi đầu tư tài sản cố định) ÷ Vốn hoá", hi: "Cao: tạo nhiều tiền thật – có khả năng trả cổ tức, giảm nợ.", lo: "Thấp/âm: đang đốt tiền đầu tư hoặc lợi nhuận chưa thành tiền." },
  fair: { t: "Giá trị hợp lý", d: "Ước tính giá một cổ phiếu \"đáng giá\" theo nhiều phương pháp định giá (P/E, P/B mục tiêu theo ngành và lịch sử, chiết khấu dòng tiền/lợi nhuận…), lấy trung bình có trọng số.", f: "Bình quân các phương pháp – xem chi tiết ở tab Dự phóng & định giá của từng mã", hi: "Giá hợp lý cao hơn giá hiện tại: còn tiềm năng.", lo: "Giá hợp lý thấp hơn giá hiện tại: đã đắt.", n: "Phụ thuộc giả định dự phóng – anh sửa được ở trang mã." },
  fair_range: { t: "Khoảng giá trị", d: "Khoảng thấp – cao của các phương pháp định giá; giá ngoài khoảng này là rất rẻ hoặc rất đắt.", f: "Thấp = trung bình các ước tính thấp · Cao = trung bình các ước tính cao" },
  buy_below: { t: "Mua dưới (biên an toàn)", d: "Giá tối đa nên mua để có \"đệm\" phòng khi định giá sai.", f: "Giá trị hợp lý × (1 − Biên an toàn)", lo: "Giá dưới mức này: đủ biên an toàn để mua." },
  mos: { t: "Biên an toàn", d: "Phần chiết khấu so với giá trị hợp lý mà anh đòi hỏi trước khi mua – để có lỗ hổng cho sai sót định giá.", f: "Mặc định 20%: chỉ mua khi giá ≤ 80% giá trị hợp lý", hi: "Cao: ít mã đạt nhưng an toàn hơn.", lo: "Thấp: nhiều mã đạt hơn nhưng dễ mua đắt." },
  upside: { t: "Tiềm năng", d: "Giá còn cách giá trị hợp lý bao nhiêu %.", f: "Giá trị hợp lý ÷ Giá hiện tại − 1", hi: "Dương lớn: rẻ, còn dư địa tăng (nếu định giá đúng).", lo: "Âm: giá đã vượt giá trị hợp lý." },
  verdict: { t: "Định giá", d: "Kết luận tóm tắt: Rất rẻ / Rẻ / Hơi rẻ / Hợp lý / Hơi đắt / Đắt, dựa trên giá so với giá trị hợp lý. \"Chưa đáng tin\" = các phương pháp lệch nhau quá nhiều.", f: "Theo % giá so với giá trị hợp lý và biên an toàn" },
  eps: { t: "EPS – Lợi nhuận mỗi cổ phiếu", d: "Mỗi cổ phiếu \"làm ra\" bao nhiêu đồng lợi nhuận trong 12 tháng.", f: "Lợi nhuận sau thuế cổ đông mẹ 12 tháng ÷ Số cổ phiếu lưu hành", hi: "Tăng đều theo thời gian là dấu hiệu tốt." },
  bvps: { t: "BVPS – Giá trị sổ sách mỗi cổ phiếu", d: "Vốn chủ sở hữu chia đều cho mỗi cổ phiếu.", f: "Vốn chủ sở hữu ÷ Số cổ phiếu lưu hành" },
  mcap: { t: "Vốn hoá", d: "Giá trị cả công ty theo giá thị trường.", f: "Giá × Số cổ phiếu lưu hành", hi: "Lớn: ổn định, thanh khoản tốt, tổ chức nắm nhiều.", lo: "Nhỏ: biến động mạnh, dễ bị làm giá, khó bán khi cần." },
  gtgd: { t: "GTGD/ngày – Giá trị giao dịch", d: "Bình quân mỗi phiên có bao nhiêu tỷ đồng cổ phiếu này được mua bán (20 phiên).", f: "Trung bình (Giá × Khối lượng) 20 phiên", hi: "Cao: dễ mua bán khối lượng lớn.", lo: "Thấp (< 3 tỷ): khó thoát hàng – hệ thống không mua." },
  div_yield: { t: "Lợi suất cổ tức", d: "Cổ tức TIỀN MẶT một năm nhận được, tính theo % giá hiện tại.", f: "Cổ tức tiền mặt 12 tháng (đồng/cp) ÷ Giá", hi: "Cao: thu nhập đều – nhưng > 10% thường là cổ tức đặc biệt một lần, kiểm tra kỹ.", lo: "Thấp: doanh nghiệp giữ lại lợi nhuận để tăng trưởng.", n: "Cổ tức bằng cổ phiếu không tính." },
  payout: { t: "Tỷ lệ chi trả", d: "Doanh nghiệp đem bao nhiêu % lợi nhuận ra trả cổ tức tiền mặt.", f: "Cổ tức tiền mặt mỗi cp ÷ EPS", hi: "> 90%: khó duy trì nếu lợi nhuận giảm.", lo: "Thấp: còn dư địa tăng cổ tức hoặc đang giữ tiền để đầu tư." },
  cash_years: { t: "Số năm trả cổ tức tiền liên tiếp", d: "Đã trả cổ tức tiền mặt bao nhiêu năm liền gần đây.", hi: "Nhiều năm: chính sách cổ tức đáng tin.", lo: "Ít/0: chưa có thói quen trả tiền." },
  // ---------------- chất lượng & sức khoẻ
  roe: { t: "ROE – Lợi nhuận trên vốn chủ", d: "Mỗi 100 đồng vốn của cổ đông làm ra bao nhiêu đồng lời một năm.", f: "Lợi nhuận sau thuế 12 tháng ÷ Vốn chủ sở hữu bình quân", hi: "> 15%: doanh nghiệp giỏi dùng vốn (kiểm tra có phải nhờ vay nợ nhiều không).", lo: "< 10%: sinh lời kém, có khi thấp hơn gửi tiết kiệm." },
  roe_avg5: { t: "ROE trung bình 5 năm (ROE TB5)", d: "ROE bình quân 5 năm – cho biết sinh lời bền hay chỉ tốt 1 năm.", f: "Trung bình ROE 5 năm tài chính gần nhất", hi: "Cao và đều: lợi thế cạnh tranh bền.", lo: "Thấp: sinh lời yếu kéo dài." },
  roe_w: { t: "ROE gia quyền (GQ)", d: "ROE của cả nhóm như một công ty.", f: "Tổng lợi nhuận 12 tháng ÷ Tổng vốn chủ sở hữu", hi: "Nhóm sinh lời tốt.", lo: "Nhóm sinh lời kém." },
  roa: { t: "ROA – Lợi nhuận trên tổng tài sản", d: "Mỗi 100 đồng tài sản (cả phần vay) làm ra bao nhiêu đồng lời.", f: "Lợi nhuận sau thuế ÷ Tổng tài sản bình quân", hi: "Cao: dùng tài sản hiệu quả.", lo: "Thấp: tài sản nặng hoặc kém hiệu quả (ngân hàng thường chỉ 1–2%)." },
  roic: { t: "ROIC – Lợi nhuận trên vốn đầu tư", d: "Sinh lời trên toàn bộ vốn đã bỏ vào kinh doanh (vốn chủ + nợ vay).", f: "Lợi nhuận hoạt động sau thuế ÷ (Vốn chủ + Nợ vay − Tiền)", hi: "> 15%: kinh doanh tạo giá trị thật.", lo: "Thấp hơn chi phí vốn (~12%): tăng trưởng đang phá huỷ giá trị." },
  gross_margin: { t: "Biên lợi nhuận gộp", d: "Mỗi 100 đồng bán hàng còn lại bao nhiêu sau giá vốn.", f: "Lợi nhuận gộp ÷ Doanh thu", hi: "Cao: có sức định giá / sản phẩm khác biệt.", lo: "Thấp: kinh doanh hàng hoá, cạnh tranh giá." },
  net_margin: { t: "Biên lợi nhuận ròng", d: "Mỗi 100 đồng doanh thu còn lại bao nhiêu đồng lời cuối cùng.", f: "Lợi nhuận sau thuế ÷ Doanh thu", hi: "Cao: hiệu quả tốt.", lo: "Thấp: chi phí, lãi vay ăn mòn lợi nhuận." },
  cfo_ni: { t: "CFO/LN – Chất lượng lợi nhuận", d: "Lợi nhuận trên giấy có thành tiền thật không.", f: "Dòng tiền từ hoạt động kinh doanh ÷ Lợi nhuận sau thuế (12 tháng)", hi: "≥ 1: lợi nhuận được thu bằng tiền – tốt.", lo: "< 0,5 hoặc âm: lãi chủ yếu là phải thu/tồn kho – cảnh giác." },
  de: { t: "Vay/Vốn – Đòn bẩy", d: "Nợ vay có lãi gấp bao nhiêu lần vốn chủ sở hữu.", f: "Nợ vay ngắn + dài hạn ÷ Vốn chủ sở hữu", hi: "> 1,5: rủi ro khi lãi suất tăng hoặc kinh doanh xấu.", lo: "< 0,5: tài chính an toàn.", n: "Không áp dụng cho ngân hàng (nợ là tiền gửi)." },
  fscore: { t: "F-Score (Piotroski)", d: "9 bài kiểm tra sức khoẻ tài chính, mỗi bài đạt 1 điểm: có lãi, dòng tiền dương, ROA tăng, dòng tiền > lợi nhuận, nợ giảm, khả năng thanh toán tăng, không phát hành thêm, biên gộp tăng, vòng quay tài sản tăng.", f: "Tổng số bài đạt (0–9)", hi: "7–9: doanh nghiệp đang khoẻ lên.", lo: "0–3: đang yếu đi – hệ thống coi là luận điểm gãy." },
  loss_share: { t: "% doanh nghiệp lỗ", d: "Trong nhóm có bao nhiêu % doanh nghiệp đang lỗ 12 tháng gần nhất.", f: "Số DN có lợi nhuận 12 tháng ≤ 0 ÷ Số DN có BCTC", hi: "Cao: ngành đang khó khăn.", lo: "Thấp: ngành khoẻ." },
  // ---------------- tăng trưởng
  rev_yoy: { t: "Tăng trưởng doanh thu 12 tháng (DT 12T)", d: "Doanh thu 4 quý gần nhất so với 4 quý trước đó.", f: "Doanh thu 12 tháng ÷ Doanh thu 12 tháng cùng kỳ − 1", hi: "Cao: đang mở rộng kinh doanh.", lo: "Âm: thu hẹp." },
  ni_yoy: { t: "Tăng trưởng lợi nhuận 12 tháng (LN 12T)", d: "Lợi nhuận 4 quý gần nhất so với 4 quý trước đó.", f: "LN 12 tháng ÷ LN 12 tháng cùng kỳ − 1", hi: "Cao: lợi nhuận tăng (kiểm tra có khoản bất thường).", lo: "Âm: lợi nhuận giảm." },
  rev_q_yoy: { t: "Doanh thu quý gần nhất (DT quý)", d: "Doanh thu quý gần nhất so với cùng quý năm trước.", f: "DT quý ÷ DT cùng quý năm trước − 1", hi: "Cao: đà tăng mới nhất tốt.", lo: "Âm: đang chậm lại." },
  ni_q_yoy: { t: "Lợi nhuận quý gần nhất (LN quý)", d: "Lợi nhuận quý gần nhất so với cùng quý năm trước – tín hiệu sớm nhất.", f: "LN quý ÷ LN cùng quý năm trước − 1", hi: "≥ 25%: đạt tiêu chí C của CANSLIM.", lo: "< −30% cùng LN 12T < −20%: hệ thống coi là luận điểm gãy." },
  cagr: { t: "CAGR – Tăng trưởng kép mỗi năm", d: "Tốc độ tăng bình quân mỗi năm trong nhiều năm.", f: "(Giá trị cuối ÷ Giá trị đầu)^(1/số năm) − 1", hi: "Cao: tăng trưởng bền nhiều năm.", lo: "Thấp/âm: dậm chân hoặc thu hẹp." },
  ni_growth_streak: { t: "Số quý lợi nhuận tăng liên tiếp", d: "Bao nhiêu quý liền lợi nhuận cao hơn cùng kỳ năm trước.", hi: "Nhiều quý: đà tăng ổn định.", lo: "0: quý gần nhất đã giảm." },
  // ---------------- giá & kỹ thuật
  chg: { t: "Biến động giá", d: "Giá hiện tại so với giá đóng cửa của kỳ trước (hôm nay, 1 tuần, 1 tháng, 3 tháng, 1 năm).", f: "Giá đóng cửa ÷ Giá đóng cửa đầu kỳ − 1" },
  ret_12_1: { t: "Động lượng 12–1 tháng", d: "Mức tăng giá 12 tháng nhưng bỏ tháng gần nhất – thước đo động lượng chuẩn trong nghiên cứu (tháng gần nhất hay đảo chiều).", f: "Giá cách đây 1 tháng ÷ Giá cách đây 12 tháng − 1", hi: "Cao: mã mạnh, thường tiếp tục mạnh.", lo: "Thấp: mã yếu." },
  from_hi52: { t: "Cách đỉnh 52 tuần", d: "Giá hiện tại thấp hơn đỉnh cao nhất 1 năm qua bao nhiêu %.", f: "Giá ÷ Giá cao nhất 250 phiên − 1", hi: "Gần 0%: đang ở gần đỉnh – mã mạnh (tiêu chí N của CANSLIM: trong 15%).", lo: "−40% trở xuống: giảm sâu – có thể rẻ hoặc đang gặp vấn đề." },
  hilo52: { t: "Đỉnh / đáy 52 tuần", d: "Số mã lập đỉnh mới / đáy mới 1 năm trong phiên.", hi: "Nhiều đỉnh mới: thị trường khoẻ.", lo: "Nhiều đáy mới: thị trường yếu." },
  ta_score: { t: "Điểm kỹ thuật (KT)", d: "Tổng hợp xu hướng (MA, SuperTrend, ADX), động lượng (RSI, MACD, Stochastic), dòng tiền (OBV, MFI) và biến động, quy về 0–100.", f: "Trung bình có trọng số các nhóm chỉ báo, 50 = trung tính", hi: "> 65: kỹ thuật ủng hộ tăng (Mua / Mua mạnh).", lo: "< 35: kỹ thuật xấu (Bán / Bán mạnh)." },
  trend: { t: "Xu hướng", d: "Tăng khi giá > MA50 > MA200 và MA50 đang đi lên; Giảm khi ngược lại; còn lại là Đi ngang.", hi: "Tăng: hệ thống trung hạn chỉ mua mã đang tăng.", lo: "Giảm: hạn chế mua, chờ đảo chiều." },
  rsi: { t: "RSI (14) – Chỉ số sức mạnh tương đối", d: "Đo tốc độ tăng/giảm gần đây, thang 0–100.", f: "100 − 100 ÷ (1 + Trung bình phiên tăng ÷ Trung bình phiên giảm) trong 14 phiên", hi: "> 70: quá mua – dễ chững lại.", lo: "< 30: quá bán – dễ hồi lên." },
  macd: { t: "MACD", d: "Chênh lệch giữa hai đường trung bình nhanh và chậm – báo đổi đà.", f: "EMA12 − EMA26; đường tín hiệu = EMA9 của MACD", hi: "MACD cắt lên đường tín hiệu: đà tăng mạnh lên.", lo: "Cắt xuống: đà tăng yếu đi." },
  obv: { t: "OBV – Khối lượng cân bằng", d: "Cộng khối lượng phiên tăng, trừ khối lượng phiên giảm – xem tiền vào hay ra.", f: "OBV hôm nay = OBV hôm qua ± Khối lượng (theo giá tăng/giảm)", hi: "OBV đi lên trước giá: dòng tiền đang gom.", lo: "OBV đi xuống: tiền đang rút ra." },
  ma: { t: "MA – Đường trung bình giá", d: "Giá trung bình của N phiên gần nhất (MA20 ≈ 1 tháng, MA50 ≈ 1 quý, MA200 ≈ 1 năm). EMA cho phiên gần đây trọng số lớn hơn.", f: "Tổng giá đóng cửa N phiên ÷ N", hi: "Giá trên MA: xu hướng tăng ở khung đó.", lo: "Giá dưới MA: xu hướng giảm ở khung đó." },
  above_ma: { t: "% mã trên MA50 / MA200", d: "Bao nhiêu % cổ phiếu đang có giá trên đường trung bình 50 / 200 phiên – sức khoẻ chung của thị trường.", hi: "> 60%: số đông đang tăng.", lo: "< 30%: thị trường yếu diện rộng." },
  bollinger: { t: "Dải Bollinger", d: "Kênh quanh MA20 rộng ±2 độ lệch chuẩn – giá thường dao động trong kênh.", f: "MA20 ± 2 × Độ lệch chuẩn 20 phiên", hi: "Chạm dải trên: đang mạnh/quá mua.", lo: "Chạm dải dưới: yếu/quá bán. Kênh hẹp lại: sắp có biến động lớn." },
  atr: { t: "ATR – Biên độ dao động trung bình", d: "Một phiên giá thường dao động bao nhiêu – dùng đặt điểm dừng lỗ hợp lý.", f: "Trung bình 14 phiên của max(Cao − Thấp, |Cao − Đóng cửa hôm trước|, |Thấp − Đóng cửa hôm trước|)", hi: "Cao: mã biến động mạnh – dừng lỗ phải rộng hơn.", lo: "Thấp: mã ít biến động." },
  beta: { t: "Beta", d: "Mã biến động mạnh hay yếu hơn VN-Index.", f: "Hiệp phương sai lợi suất mã với VN-Index ÷ Phương sai VN-Index (1 năm)", hi: "> 1,2: VN-Index giảm 10% thì mã thường giảm hơn 12%.", lo: "< 0,8: phòng thủ, ít theo thị trường." },
  vol: { t: "Biến động (độ lệch chuẩn năm)", d: "Mức dao động giá trung bình một năm.", f: "Độ lệch chuẩn lợi suất ngày × √250", hi: "Cao: rủi ro cao, giá lên xuống mạnh.", lo: "Thấp: ổn định." },
  rs: { t: "RS – Sức mạnh giá tương đối", d: "Xếp hạng mức tăng giá 12 tháng của mã so với mọi mã khác (kiểu IBD), 1–99.", f: "40% × tăng giá quý gần nhất + 20% × mỗi quý trong 3 quý trước, rồi xếp phân vị", hi: "≥ 80: nằm trong top 20% mạnh nhất (tiêu chí L của CANSLIM).", lo: "< 30: mã yếu hơn đa số." },
  breadth: { t: "Độ rộng thị trường", d: "Số mã tăng so với số mã giảm trong phiên – cho thấy cả thị trường hay chỉ vài mã lớn đang kéo chỉ số.", hi: "Nhiều mã tăng: tăng diện rộng, khoẻ.", lo: "Chỉ số tăng mà số mã giảm nhiều hơn: tăng giả, chỉ vài trụ kéo." },
  dist_days: { t: "Ngày phân phối", d: "Phiên chỉ số giảm > 0,2% với khối lượng cao hơn phiên trước – dấu hiệu tổ chức bán ra (đếm trong 25 phiên).", hi: "≥ 5 ngày: áp lực bán lớn, thị trường dễ điều chỉnh.", lo: "0–2: chưa có dấu hiệu bán tháo." },
  ceil_floor: { t: "Mã trần / mã sàn", d: "Mã tăng hết biên độ (trần – màu tím) hoặc giảm hết biên độ (sàn – màu xanh lam) trong phiên. Biên độ: HOSE ±7%, HNX ±10%, UPCoM ±15%.", hi: "Nhiều mã trần: hưng phấn.", lo: "Nhiều mã sàn: hoảng loạn, bán tháo." },
  sr: { t: "Hỗ trợ / Kháng cự", d: "Vùng giá trong quá khứ hay có lực mua đỡ (hỗ trợ) hoặc lực bán chặn (kháng cự).", f: "Đỉnh/đáy cục bộ được chạm nhiều lần, gộp các mức gần nhau", n: "Thủng hỗ trợ thường giảm tiếp; vượt kháng cự thường tăng tiếp." },
  fib: { t: "Fibonacci – Thoái lui / Mở rộng", d: "Các mức giá theo tỷ lệ 23,6% / 38,2% / 50% / 61,8% / 78,6% của sóng gần nhất (thoái lui = vùng chỉnh về) và 127,2% / 161,8% / 261,8% (mở rộng = mục tiêu khi vượt đỉnh).", f: "Đáy + (Đỉnh − Đáy) × tỷ lệ" },
  elliott: { t: "Sóng Elliott", d: "Giá đi theo 5 sóng thuận xu hướng (1-2-3-4-5) và 3 sóng điều chỉnh (A-B-C). Hệ thống tự đếm sóng từ đỉnh/đáy.", n: "Chỉ để tham khảo – độ tin cậy đo trên dữ liệu VN ghi ở mục Kiểm chứng." },
  pattern: { t: "Mô hình giá", d: "Hình dạng giá kinh điển (hai đáy, vai-đầu-vai, cốc tay cầm, tam giác…) kèm mức giá xác nhận và mục tiêu.", n: "\"đúng x% / n lần\" = trong quá khứ trên thị trường VN, tín hiệu này đúng x% số lần sau 20 phiên." },
  reliability: { t: "Độ tin cậy tín hiệu", d: "Đo trên toàn bộ dữ liệu VN từ 2020: tín hiệu này xuất hiện bao nhiêu lần, bao nhiêu % lần giá đi đúng hướng sau 20 phiên, và trung bình vượt/thua VN-Index bao nhiêu.", hi: "> 55% và vượt VNI dương: tín hiệu có ích.", lo: "≈ 50% hoặc vượt VNI âm: không hơn tung đồng xu." },
  // ---------------- tạo lập & dòng tiền
  smc: { t: "SMC – Smart Money Concepts", d: "Đọc cấu trúc giá theo dấu chân tổ chức: phá đỉnh/đáy (BOS), đổi cấu trúc (CHoCH), vùng lệnh lớn (Order Block), khoảng trống giá (FVG), vùng đắt/rẻ (Premium/Discount).", f: "Điểm = 50 + 50 × hướng SMC (−1 giảm … +1 tăng)", hi: "> 60: cấu trúc tăng, giá ở vùng rẻ / về vùng mua của tổ chức.", lo: "< 40: cấu trúc giảm." },
  bos: { t: "BOS / CHoCH", d: "BOS (phá cấu trúc): giá vượt đỉnh (hoặc thủng đáy) gần nhất theo hướng xu hướng – xu hướng tiếp diễn. CHoCH (đổi tính cách): phá ngược hướng – dấu hiệu đảo chiều sớm." },
  ob: { t: "Order Block / FVG", d: "Order Block: cây nến ngược chiều cuối cùng trước một cú bứt mạnh – nơi tổ chức đặt lệnh lớn, giá hay quay lại. FVG: khoảng trống giữa 3 nến mà giá đi quá nhanh, thường được lấp lại." },
  pd: { t: "Premium / Discount (Vị trí P/D)", d: "Giá đang ở nửa trên (Premium – đắt) hay nửa dưới (Discount – rẻ) của biên độ từ đáy lên đỉnh gần nhất.", f: "(Giá − Đáy) ÷ (Đỉnh − Đáy): > 50% là Premium", hi: "Premium: tổ chức thường bán.", lo: "Discount: tổ chức thường mua." },
  vsa: { t: "VSA – Phân tích khối lượng & biên độ", d: "So nỗ lực (khối lượng) với kết quả (biên độ nến, vị trí đóng cửa). No Supply = giảm với khối lượng thấp (cạn cung); No Demand = tăng với khối lượng thấp (thiếu cầu); Spring/Shakeout = rũ bỏ thủng đáy rồi đóng cửa cao; Upthrust = vượt đỉnh giả.", f: "Điểm = 50 + 50 × hướng VSA", hi: "> 60: cầu chủ động, cung cạn.", lo: "< 40: cung chủ động." },
  wyckoff: { t: "Wyckoff – Pha tích luỹ / phân phối", d: "Tích luỹ: tổ chức gom hàng trong nền giá (pha A dừng giảm → B xây nền → C rũ bỏ/Spring → D/E bắt đầu tăng). Phân phối: ngược lại ở vùng đỉnh.", hi: "Tích luỹ pha C, D/E: sắp hoặc đang tăng (điểm 75–90).", lo: "Phân phối pha D/E: sắp hoặc đang giảm (điểm 10)." },
  orderflow: { t: "Order Flow – Dòng lệnh", d: "Mua chủ động (khớp ở giá bán) trừ bán chủ động (khớp ở giá mua) theo từng phiên/bước giá.", f: "Delta = KL mua chủ động − KL bán chủ động; Delta 5 phiên = tổng 5 phiên", hi: "Delta dương: bên mua đang chủ động.", lo: "Delta âm: bên bán chủ động.", n: "Chỉ có từ ngày hệ thống bắt đầu lưu dữ liệu khớp lệnh." },
  bias: { t: "Hướng (SMC / VSA / OF)", d: "Kết luận ngắn của phương pháp: Tăng / Giảm / Trung tính, kèm độ mạnh −1 … +1." },
  // ---------------- điểm phương pháp
  composite: { t: "Điểm tổng hợp", d: "Trung bình có trọng số của điểm các phương pháp (giá trị, chất lượng, tăng trưởng, cổ tức, động lượng…), thang 0–100 so với toàn thị trường. Trọng số chỉnh được ở Bộ lọc.", f: "Σ (Điểm phương pháp × Trọng số) ÷ Σ Trọng số", hi: "> 70: tốt hơn phần lớn thị trường trên nhiều mặt.", lo: "< 40: yếu ở nhiều mặt." },
  score: { t: "Điểm phương pháp (0–100)", d: "Mỗi phương pháp chấm mã theo phân vị so với mọi mã khác: 80 = tốt hơn 80% thị trường theo tiêu chí đó.", hi: "Cao: mã nổi bật theo phương pháp này.", lo: "Thấp: mã kém theo phương pháp này." },
  piotroski: { t: "Piotroski", d: "Điểm từ F-Score: F-Score ÷ 9 × 100.", hi: "Cao: tài chính khoẻ lên.", lo: "Thấp: tài chính yếu đi." },
  magic: { t: "Magic Formula (Greenblatt)", d: "Xếp hạng theo 2 tiêu chí cùng lúc: doanh nghiệp tốt (ROIC cao) và giá rẻ (lợi suất lợi nhuận cao). Với ngân hàng/CTCK/bảo hiểm dùng ROE và P/B.", f: "Phân vị (Hạng lợi suất lợi nhuận + Hạng ROIC)", hi: "Cao: vừa tốt vừa rẻ.", lo: "Thấp: đắt hoặc kém." },
  value: { t: "Giá trị", d: "Rẻ hay đắt: tiềm năng so với giá trị hợp lý, phân vị P/E – P/B so với ngành, P/E so với lịch sử của chính mã.", hi: "Cao: rẻ.", lo: "Thấp: đắt." },
  quality: { t: "Chất lượng", d: "ROE cao và ổn định 5 năm, biên gộp tốt, lợi nhuận thành tiền (CFO/LN), ít nợ, không có năm lỗ.", hi: "Cao: doanh nghiệp tốt, bền.", lo: "Thấp: chất lượng kém hoặc bất ổn." },
  growth: { t: "Tăng trưởng", d: "Doanh thu, lợi nhuận tăng (12 tháng, quý gần nhất, 3 năm) và số quý tăng liên tiếp.", hi: "Cao: đang tăng nhanh.", lo: "Thấp: chững lại hoặc giảm." },
  dividend: { t: "Điểm cổ tức", d: "Lợi suất cổ tức tiền mặt, số năm trả liên tiếp, tỷ lệ chi trả bền vững (≤ 90%).", hi: "Cao: cổ tức cao và đều.", lo: "Thấp: ít hoặc không trả tiền mặt." },
  momentum: { t: "Động lượng", d: "Mức tăng giá 12–1 tháng, 6 tháng và RS so với thị trường.", hi: "Cao: mã đang mạnh hơn thị trường.", lo: "Thấp: mã yếu hơn thị trường." },
  canslim: { t: "CANSLIM (William O'Neil)", d: "6 tiêu chí: C – LN quý tăng ≥ 25%; A – LN 3 năm tăng ≥ 20%/năm và ROE ≥ 17%; N – trong 15% từ đỉnh 52 tuần; S – GTGD ≥ 10 tỷ/ngày; L – RS ≥ 80; M – thị trường không ở đèn đỏ. (I – tổ chức nắm giữ chưa có dữ liệu.)", f: "Số tiêu chí đạt ÷ 6 × 100; \"CANSLIM đạt\" liệt kê chữ cái đạt", hi: "≥ 4/6: ứng viên tăng trưởng mạnh.", lo: "Ít tiêu chí: chưa phải cổ phiếu dẫn dắt." },
  low_vol: { t: "Ít biến động", d: "Mã dao động ít và beta thấp – phòng thủ khi thị trường xấu.", f: "Trung bình phân vị (biến động 1 năm thấp, beta thấp)", hi: "Cao: ổn định.", lo: "Thấp: lên xuống mạnh." },
  ind_rank: { t: "Hạng trong ngành", d: "Vị trí của mã theo điểm tổng hợp trong số các mã cùng ngành.", f: "1 = điểm cao nhất ngành / tổng số mã có điểm" },
  // ---------------- ngành
  outlook: { t: "Triển vọng ngành", d: "Ngành nào nên đầu tư / nên tránh trong 3–6 tháng và 12 tháng tới, xếp các ngành với nhau (0–100). 3–6 tháng: độ rộng (% mã trên MA200), tăng trưởng lợi nhuận, đà giá 6 và 3 tháng so với VN-Index. 12 tháng: ngành tụt mạnh 12 tháng qua (thường hồi lại), tăng trưởng lợi nhuận, P/E rẻ so với lịch sử ngành.", f: "Bình quân có trọng số thứ hạng từng yếu tố giữa các ngành", hi: "≥ 65: Đáng đầu tư – lịch sử nhóm này nhỉnh hơn bình quân ngành.", lo: "< 35: Nên tránh – lịch sử nhóm này kém hơn bình quân ngành.", n: "Là xác suất nghiêng, không chắc chắn – xem \"Dự báo này đúng đến đâu?\" ở trang Ngành." },
  mtf: { t: "Đa khung thời gian", d: "Cùng một công cụ (xu hướng MA, cấu trúc đỉnh–đáy, RSI, MACD, động lượng) áp lên nến ngày, tuần, tháng, quý. Ngày cho biết nhịp ngắn, tuần là xu hướng trung hạn, tháng/quý là xu hướng dài. Khung ngày tăng mà tháng giảm thường chỉ là hồi kỹ thuật; tháng tăng mà ngày giảm thường là điều chỉnh để mua.", f: "Điểm mỗi khung −1…+1 = trung bình (xu hướng, cấu trúc, MACD, (RSI−50)/20, động lượng); ≥ 0,35 Tăng, ≤ −0,35 Giảm · Đồng thuận = 20% ngày + 30% tuần + 30% tháng + 20% quý", hi: "Gần +1: tăng trên mọi khung – xu hướng bền.", lo: "Gần −1: giảm trên mọi khung – tránh bắt đáy." },
  tfk: { t: "Khung thời gian của nến", d: "Ngày: mỗi nến 1 phiên · Tuần: gộp 5 phiên · Tháng · Quý · Năm. MA trên biểu đồ tính theo số nến của khung (MA50 khung tuần = 50 tuần ≈ 1 năm)." },
  season: { t: "Mùa vụ – ngày này các năm trước", d: "Nếu mua đúng ngày/tháng này ở mỗi năm trước rồi giữ 1, 2, 3 tháng thì lãi lỗ bao nhiêu, bao nhiêu năm có lãi, hơn/kém VN-Index. Bảng tháng: lợi nhuận trung bình từng tháng dương lịch so với VN-Index và % số năm hơn.", f: "Lợi nhuận = Giá sau 21/42/63 phiên ÷ Giá ngày mua − 1 · So VN-Index = lợi nhuận mã − lợi nhuận VN-Index cùng kỳ", hi: "Mùa mạnh (viền vàng): ≥ 8 năm dữ liệu, ≥ 75% số năm hơn VN-Index, trung bình hơn ≥ 3%.", lo: "Mùa yếu: đa số năm kém VN-Index – kiểm chứng cho thấy tín hiệu yếu ít lặp lại hơn tín hiệu mạnh.", n: "Mùa vụ chỉ nên dùng khi số liệu năm nay ủng hộ (đà giá tuần/tháng, triển vọng ngành, lợi nhuận). Số năm ít nên rất dễ là trùng hợp – xem dòng kiểm chứng ngoài mẫu." },
  oos: { t: "Kiểm chứng ngoài mẫu", d: "Giả lập đúng như đang sống ở quá khứ: với mỗi năm chỉ dùng dữ liệu các năm TRƯỚC đó để đoán, rồi so với kết quả thật năm đó. Khác với \"đo trên chính dữ liệu đã dùng để tìm ra quy luật\" (luôn đẹp hơn thực tế)." },
  fb_fwd: { t: "Điểm hướng tương lai", d: "Gộp các chỉ số nói về tương lai: P/E dự phóng, triển vọng ngành, lợi nhuận tăng tốc, dòng tiền tích luỹ, mùa vụ, PEG… Chỉ số hỗn hợp góp một phần theo \"% tương lai\" của nó.", f: "Σ (hạng × % tương lai × trọng số) ÷ Σ (% tương lai × trọng số); trọng số = mức dự báo đúng trung bình trong quá khứ (âm → 0)", hi: "≥ 65: các tín hiệu về tương lai đều tốt.", lo: "< 35: kỳ vọng tương lai xấu." },
  fb_back: { t: "Điểm hướng quá khứ", d: "Gộp các chỉ số phản ánh kết quả đã xảy ra: ROE, tăng trưởng 12 tháng, biên lợi nhuận, nợ, P/E hiện tại, đà giá, giá so với MA200.", f: "Σ (hạng × (1 − % tương lai) × trọng số) ÷ Σ ((1 − % tương lai) × trọng số)", hi: "≥ 65: kết quả kinh doanh và giá đã qua rất tốt.", lo: "< 35: kết quả đã qua kém." },
  fb_total: { t: "Điểm tổng (tương lai + quá khứ)", d: "Điểm tương lai × trọng số tương lai + điểm quá khứ × (1 − trọng số). Trọng số được kiểm định: nếu khác biệt giữa các mã lặp lại qua các giai đoạn thì mỗi mã một trọng số riêng, nếu không thì dùng chung.", hi: "≥ 65 Mua/tích luỹ · 55–65 Nghiêng mua.", lo: "< 35 Tránh/giảm · 35–45 Nghiêng bán." },
  fb_w: { t: "Trọng số tương lai", d: "Phần của điểm tương lai trong điểm tổng. Ước lượng từ chỗ nhóm nào dự báo đúng hơn trong quá khứ (walk-forward, mỗi năm chỉ dùng các năm trước).", f: "IC nhóm tương lai ÷ (IC tương lai + IC quá khứ), giới hạn 20–80%; phần riêng của mã/ngành chỉ cộng thêm khi kiểm định cho thấy nó lặp lại" },
  ic: { t: "Tương quan (IC)", d: "Độ khớp thứ hạng giữa chỉ số hôm nay và lợi nhuận 3 tháng sau (−1…+1). Dương: chỉ số cao thường đi kèm lợi nhuận cao. Ở thị trường chứng khoán, 0,03–0,05 đã là có ích; trên 0,1 là hiếm.", f: "Tương quan Spearman, t = trung bình ÷ độ lệch × √(số tháng ÷ 3)", hi: "t > 2: khó là ngẫu nhiên.", lo: "Âm: chỉ số dự báo ngược chiều – hệ thống đặt trọng số 0." },
  rrg: { t: "RRG – Biểu đồ xoay vòng ngành", d: "Đặt mỗi ngành theo 2 trục: sức mạnh so với VN-Index (RS-Ratio) và đà thay đổi của sức mạnh đó (RS-Momentum). Ngành thường đi vòng: Cải thiện → Dẫn dắt → Suy yếu → Tụt hậu.", f: "RS-Ratio = 100 × (chỉ số ngành ÷ VN-Index) ÷ trung bình 50 phiên của tỷ số đó · RS-Momentum = 100 × RS-Ratio ÷ RS-Ratio 10 phiên trước", hi: "Trên 100 cả hai: Dẫn dắt.", lo: "Dưới 100 cả hai: Tụt hậu." },
  quadrant: { t: "Vòng ngành", d: "Dẫn dắt: mạnh hơn thị trường và còn mạnh lên. Suy yếu: vẫn mạnh nhưng đang chậm lại. Tụt hậu: yếu hơn và còn yếu đi. Cải thiện: còn yếu nhưng đang mạnh lên – thường là chỗ sớm nhất để để ý.", f: "Theo RS-Ratio và RS-Momentum so với mốc 100" },
  nstock: { t: "Số mã", d: "Số cổ phiếu trong nhóm (có giá); chỉ số định giá chỉ tính các mã có báo cáo tài chính." },
  // ---------------- kiểm chứng & hiệu quả
  cagr_ret: { t: "Lãi kép mỗi năm", d: "Nếu làm theo đúng cách này từ 2020, tài khoản tăng bình quân bao nhiêu %/năm (đã trừ phí, thuế).", f: "(Giá trị cuối ÷ Giá trị đầu)^(1/số năm) − 1", hi: "Càng cao càng tốt – so với VN-Index cùng kỳ.", lo: "Thấp hơn VN-Index: không đáng công." },
  maxdd: { t: "Sụt tối đa", d: "Mức giảm sâu nhất từ đỉnh xuống đáy của tài khoản – mức \"đau\" nhất anh phải chịu nếu làm theo.", f: "min(Giá trị ÷ Đỉnh trước đó − 1)", hi: "Gần 0%: êm.", lo: "−40% trở xuống: rất khó chịu đựng thật." },
  sharpe: { t: "Sharpe", d: "Lãi thêm so với gửi tiết kiệm trên mỗi đơn vị rủi ro (biến động).", f: "(Lãi năm − Lãi suất phi rủi ro) ÷ Độ lệch chuẩn năm", hi: "> 1: tốt; > 1,5: rất tốt.", lo: "< 0,5: lãi không xứng với rủi ro." },
  alpha: { t: "Alpha / Vượt VN-Index", d: "Lãi hơn hay kém VN-Index cùng kỳ.", f: "Lãi của chiến lược − Lãi của VN-Index cùng thời gian", hi: "Dương: chọn mã có giá trị thêm.", lo: "Âm: mua quỹ ETF VN-Index còn tốt hơn." },
  winrate: { t: "Tỷ lệ thắng", d: "Bao nhiêu % số lần (lệnh, năm, tín hiệu) có lãi hoặc vượt VN-Index.", hi: "> 55%: ổn định.", lo: "< 45%: thua nhiều hơn thắng (vẫn có thể lãi nếu lãi mỗi lần thắng lớn)." },
  pf_ratio: { t: "Hệ số lãi/lỗ", d: "Tổng tiền lãi các lần thắng chia tổng tiền lỗ các lần thua.", f: "Σ lãi ÷ Σ lỗ", hi: "> 1,5: cách giao dịch tốt.", lo: "< 1: tổng thể đang mất tiền." },
  fwd: { t: "Theo dõi thực tế", d: "Mỗi ngày hệ thống ghi lại danh sách MUA rồi đo kết quả thật sau 5/20/60 phiên – không thể \"tối ưu ngược\" như backtest." },
  // ---------------- kế hoạch, danh mục
  light: { t: "Đèn thị trường", d: "Xanh/Vàng/Đỏ dựa trên 7 điều kiện: VN-Index trên MA200, trên MA50, MA50 trên MA200, > 50% cổ phiếu trên MA50, > 50% trên MA200, dưới 5 ngày phân phối trong 25 phiên, cách đỉnh 52 tuần không quá 15%. Quyết định được nắm tối đa bao nhiêu % cổ phiếu.", f: "Đạt ≥ 5 điều kiện: Xanh · 3–4: Vàng · ≤ 2: Đỏ", hi: "Xanh: cho phép nắm nhiều cổ phiếu.", lo: "Đỏ: giữ nhiều tiền mặt." },
  exposure: { t: "Tỷ trọng cổ phiếu theo đèn (X/V/Đ)", d: "Phần vốn tối đa nên nằm trong cổ phiếu ứng với đèn Xanh / Vàng / Đỏ. Chỉnh ở Khẩu vị.", f: "Mặc định 100% / 60% / 30%" },
  weight: { t: "Tỷ trọng", d: "Mã này chiếm bao nhiêu % tổng vốn.", f: "Giá trị thị trường của mã ÷ Tổng vốn (hoặc cổ phiếu + tiền mặt)", hi: "Vượt trần (mặc định 20%/mã, 30%/ngành): rủi ro tập trung." },
  stop: { t: "Điểm dừng lỗ", d: "Mức giá mà nếu thủng thì bán để bảo vệ vốn. \"Khoá lãi\" khi điểm dừng đã cao hơn giá vốn.", f: "Trung hạn: max(Giá vốn × (1 − 20%), Đỉnh sau mua − 3×ATR) · Lướt sóng: 2,5×ATR dưới giá vốn (5–10%), dời theo đỉnh", n: "Dài hạn và cổ tức không cắt lỗ theo giá – chỉ \"xem lại luận điểm\"." },
  target: { t: "Mục tiêu (MT1, MT2)", d: "Các mức giá dự kiến chốt lời.", f: "Trung hạn: giá trị hợp lý / vùng cao · Lướt sóng: 3R và 4R · Dài hạn: giá trị hợp lý +20% / +40% · Cổ tức: giá ứng với lợi suất 3,5% / 3%" },
  rmult: { t: "R – Đơn vị rủi ro", d: "1R = khoảng cách từ giá mua tới điểm dừng lỗ (số tiền chấp nhận mất mỗi cổ phiếu). 3R = lãi gấp 3 lần mức rủi ro.", f: "R = Giá mua − Điểm dừng" },
  rr: { t: "Lời / lỗ kỳ vọng", d: "Nếu đạt mục tiêu 1 thì lãi gấp mấy lần khoản lỗ khi chạm điểm dừng.", f: "(Mục tiêu 1 − Giá mua) ÷ (Giá mua − Điểm dừng)", hi: "≥ 2: đáng vào lệnh.", lo: "< 1,5: lời không xứng rủi ro." },
  zone: { t: "Vùng mua", d: "Khoảng giá hệ thống cho là hợp lý để mua theo phong cách đang chọn; trên vùng thì chờ.", n: "Có thể đặt lệnh chờ ở cận trên vùng." },
  breakeven: { t: "Giá hoà vốn sau phí", d: "Giá bán tối thiểu để không lỗ sau khi trừ phí bán và thuế 0,1%.", f: "Giá vốn bình quân (đã gồm phí mua) ÷ (1 − 0,25%)" },
  t2: { t: "T+2", d: "Cổ phiếu mua hôm nay (T) về tài khoản sau 2 ngày làm việc – trước đó chưa bán được.", f: "Ngày mua + 2 ngày giao dịch" },
  unrealized: { t: "Lãi/lỗ chưa chốt", d: "Lãi/lỗ trên giấy nếu bán hết hôm nay ở giá đóng cửa, đã trừ phí bán và thuế.", f: "Khối lượng × (Giá × (1 − 0,25%) − Giá vốn)" },
  realized: { t: "Lãi/lỗ đã chốt", d: "Lãi/lỗ thật của các lần đã bán, tính theo giá vốn bình quân như công ty chứng khoán, đã trừ phí và thuế.", f: "Khối lượng bán × (Giá bán × (1 − phí %) − Giá vốn bình quân)" },
  cost: { t: "Giá vốn", d: "Giá mua bình quân mỗi cổ phiếu, đã gồm phí mua; mua thêm thì tính lại bình quân.", f: "(KL cũ × Giá vốn cũ + KL mua × Giá mua × (1 + phí)) ÷ Tổng KL" },
  dd_since: { t: "Sụt từ đỉnh sau mua", d: "Giá hiện tại thấp hơn mức cao nhất kể từ ngày mua bao nhiêu % – đo phần lãi đã trả lại.", f: "Giá ÷ Đỉnh đóng cửa kể từ ngày mua − 1", lo: "Sụt sâu khi đã từng lãi nhiều: cân nhắc khoá lãi." },
  // ---------------- rổ & phong cách
  garp: { t: "GARP – Tăng trưởng với giá hợp lý", d: "Rổ doanh nghiệp vừa tốt vừa tăng trưởng mà giá chưa quá đắt.", f: "ROE ≥ 15%, LN tăng ≥ 10%, PEG ≤ 1,5, F-Score ≥ 5, Vay/Vốn < 1,5, dòng tiền kinh doanh dương" },
  defensive: { t: "Rổ Phòng thủ", d: "Mã ít biến động, ít nợ, trả cổ tức đều – giữ tài khoản ổn định khi thị trường xấu.", f: "Ít biến động ≥ 60 điểm, Vay/Vốn < 1, trả cổ tức tiền ≥ 3 năm" },
  b_growth: { t: "Rổ Tăng trưởng", d: "Mã đạt ≥ 4/6 tiêu chí CANSLIM và đang trong xu hướng tăng.", f: "Điểm = 60% CANSLIM + 40% động lượng" },
  b_value: { t: "Rổ Giá trị", d: "Mã rẻ rõ rệt so với giá trị hợp lý và ngành, chất lượng tối thiểu đạt." },
  b_div: { t: "Rổ Cổ tức", d: "Trả cổ tức tiền ≥ 3 năm liên tiếp, lợi suất ≥ 5%, chi trả ≤ 90% lợi nhuận, có lãi, F-Score ≥ 4." },
  st_swing: { t: "Lướt sóng (1–4 tuần)", d: "Thuần kỹ thuật: nhịp chỉnh về EMA20 trong xu hướng tăng hoặc bứt phá nền có khối lượng. Dừng lỗ 2,5×ATR, chốt 2/3 ở 3R, thoát sau 20 phiên.", n: "Kiểm chứng 2020–nay: gần hoà vốn – chưa có lợi thế rõ." },
  st_position: { t: "Trung hạn theo xu hướng (1–6 tháng)", d: "Hệ thống gốc đã kiểm chứng: doanh nghiệp tốt (GARP, tăng trưởng, phòng thủ), chỉ mua khi giá đã vào xu hướng tăng. Dừng lỗ 20% hoặc 3×ATR từ đỉnh, chốt 1/2 khi vượt giá trị hợp lý 10%." },
  st_long: { t: "Đầu tư dài hạn (1–3 năm+)", d: "Doanh nghiệp chất lượng cao mua khi rẻ hơn giá trị hợp lý, mua dần 3 lần, không cắt lỗ theo giá – bán 1/3 khi vượt giá trị hợp lý 20%, thêm khi vượt 40%." },
  st_income: { t: "Cổ tức (nhiều năm)", d: "Mua khi lợi suất cổ tức tiền mặt ≥ 6%; bán 1/2 khi lợi suất còn 3,5%, bán hết khi còn 3%." },
  exit_dist: { t: "Khoảng cách tới mức", d: "Giá hiện tại còn phải tăng (+) hoặc giảm (−) bao nhiêu % nữa thì chạm mức này.", f: "Giá của mức ÷ Giá hiện tại − 1", n: "\"Sắp chạm\" khi còn ≤ 3% – Telegram nhắn trước." },
  exit_status: { t: "Trạng thái mức thoát", d: "Còn x%: chưa tới · Sắp chạm: cách ≤ 3% · ĐÃ CHẠM: giá đã tới mức, nên thực hiện · Đã làm: anh đã ghi lệnh bán theo mức này." },
  time_stop: { t: "Hạn nắm giữ", d: "Số phiên đã nắm / số phiên tối đa của phong cách. Lướt sóng: quá 20 phiên mà chưa đạt mục tiêu 1 thì bán; Trung hạn: 60 phiên chưa lãi 5% thì xem lại.", f: "Đếm phiên giao dịch từ ngày mua" },
  action: { t: "Khuyến nghị", d: "MUA: đạt đủ điều kiện của phong cách. GIỮ: chưa chạm mức thoát nào. CHỐT LỜI x%: chạm mức chốt lời. CẮT LỖ / BÁN, BÁN HẾT: chạm điểm dừng hoặc điều kiện thoát. XEM LẠI LUẬN ĐIỂM: chạm mức cảnh báo hoặc hết hạn nắm – đọc lại cơ bản trước khi quyết. BÁN – LUẬN ĐIỂM GÃY: cơ bản xấu đi (F-Score ≤ 3, lợi nhuận sụt mạnh, lỗ, cắt cổ tức)." },
  exchange: { t: "Sàn giao dịch", d: "HOSE (TP.HCM, biên độ ±7%), HNX (Hà Nội, ±10%), UPCoM (sàn mã chưa niêm yết, ±15%, thanh khoản và minh bạch thường kém hơn)." },
  pctl_ind: { t: "Phân vị trong ngành", d: "Mã tốt hơn bao nhiêu % số mã cùng ngành theo tiêu chí này.", f: "% số mã cùng ngành có điểm thấp hơn", hi: "Gần 100%: đứng đầu ngành.", lo: "Thấp: kém hơn phần lớn ngành." },
  avg_ret: { t: "Lãi trung bình mỗi lần", d: "Lãi/lỗ bình quân mỗi lượt mua – bán (đã trừ phí).", f: "Tổng % lãi/lỗ các lượt ÷ Số lượt", hi: "Dương: trung bình mỗi lần có lời.", lo: "Âm: trung bình mỗi lần mất tiền." },
  cash_avg: { t: "Tiền mặt trung bình", d: "Bình quân bao nhiêu % vốn nằm ở tiền mặt trong suốt thời gian mô phỏng – do đèn thị trường và thiếu mã đạt.", hi: "Cao: an toàn hơn nhưng lỡ nhịp tăng.", lo: "Thấp: luôn gần đầy hàng." },
  cash: { t: "Tiền mặt nên giữ", d: "Phần vốn không nên nằm trong cổ phiếu hôm nay theo đèn thị trường và số mã đạt chuẩn.", f: "100% − Tổng tỷ trọng các mã nên mua (không vượt mức đèn cho phép)" },
  turnover: { t: "Số lệnh mỗi năm", d: "Bình quân bao nhiêu lệnh mua/bán mỗi năm nếu làm theo – càng nhiều càng tốn phí và công theo dõi." },
  risk_trade: { t: "Rủi ro mỗi lệnh (% vốn)", d: "Số tiền tối đa chấp nhận mất nếu một lệnh chạm điểm dừng, tính theo % tổng vốn – dùng để tính khối lượng mua.", f: "Khối lượng = (Vốn × Rủi ro %) ÷ (Giá mua − Điểm dừng)", hi: "Cao: lãi/lỗ mỗi lệnh lớn.", lo: "Thấp (1–2%): an toàn, cần nhiều lệnh thắng." },
  per_basket: { t: "Số mã mỗi rổ", d: "Mỗi rổ (GARP, Tăng trưởng, Phòng thủ…) giữ tối đa bao nhiêu mã đứng đầu.", hi: "Nhiều: đa dạng hơn, lợi nhuận gần thị trường hơn.", lo: "Ít: tập trung, lãi/lỗ mạnh hơn." },
  alloc: { t: "Phân bổ vốn theo rổ", d: "Phần vốn dành cho mỗi rổ (tổng 100%), ví dụ GARP 40 · Tăng trưởng 60." },
  fee: { t: "Phí giao dịch", d: "Phí mua mặc định 0,15%; phí bán 0,25% (gồm 0,1% thuế thu nhập cá nhân trên giá bán). Sửa theo biểu phí công ty chứng khoán của anh." },
  // ---------------- viết tắt chung
  ab_gq: { t: "GQ – Gia quyền", d: "Tính theo vốn hoá: mã lớn ảnh hưởng nhiều hơn (như cách tính chỉ số)." },
  ab_tv: { t: "TV – Trung vị", d: "Giá trị đứng giữa khi xếp từ thấp đến cao – đại diện doanh nghiệp điển hình, không bị vài mã lớn hay vài số cực đoan kéo lệch." },
  ab_tt: { t: "TT – Toàn thị trường", d: "Tất cả cổ phiếu HOSE + HNX + UPCoM có dữ liệu." },
  ab_ls: { t: "LS – Lịch sử", d: "So với chính nó trong quá khứ (theo quý từ 2020)." },
  ab_12t: { t: "12T – 12 tháng gần nhất", d: "Cộng 4 quý báo cáo gần nhất (TTM)." },
  ab_vni: { t: "VNI – VN-Index", d: "Chỉ số chung sàn HOSE, gia quyền vốn hoá." },
  ab_kl: { t: "KL – Khối lượng", d: "Số cổ phiếu (cp)." },
  idx: { t: "Chỉ số thị trường", d: "VN-Index: toàn sàn HOSE · HNX-Index: sàn Hà Nội · UPCoM: sàn UPCoM · VN30: 30 mã vốn hoá và thanh khoản lớn nhất HOSE. Mũi tên và màu theo quy ước bảng điện: tím trần, xanh tăng, vàng đứng giá, đỏ giảm, xanh lam sàn." },
  board_px: { t: "Màu giá theo bảng điện", d: "Tím = tăng trần · Xanh = tăng · Vàng = đứng giá tham chiếu · Đỏ = giảm · Xanh lam = giảm sàn. Biên độ: HOSE ±7%, HNX ±10%, UPCoM ±15%." },
  // ---------------- hành vi giá & trong phiên
  sw_score: { t: "Điểm bất thường (0–100)", d: "Mã này hay bị đẩy/đạp, đảo chiều, chạm trần/sàn rồi rời, KL thất thường đến mức nào so với các mã thanh khoản khác. Không phải bằng chứng thao túng.", f: "Xếp hạng (%) trong các mã GTGD ≥ 1 tỷ theo: biên độ so với thị trường ×1, tần suất phiên đảo chiều ×1,5, chạm trần/sàn rồi rời ×1, tự tương quan âm ×0,5, KL thất thường ×1, xác suất sáng–chiều ngược chiều vượt mức chung ×1,5, biến động ATC ×1, thanh khoản thấp ×0,5 – rồi lấy trung bình có trọng số", hi: "Giá hay bị điều khiển/nhiễu: đặt dừng rộng hơn, không mua đuổi, chia lệnh. Kiểm chứng: điểm cao → biến động 20 phiên sau lớn hơn rõ rệt.", lo: "Giá đi đều, ít bị đẩy/đạp – tín hiệu kỹ thuật đáng tin hơn.", n: "Không dự báo được lãi/lỗ – dùng để chọn cách vào lệnh, không dùng để chọn mã." },
  sw_tags: { t: "Kiểu chơi", d: "Thói quen giá lặp lại nhiều lần trong 120 phiên (hoặc trong lịch sử nến giờ/phút) – dấu vết của dòng tiền lớn / tay to ở mã đó.", f: "Đẩy sáng–xả chiều: ≥ 60% số phiên sáng tăng ≥ 1,5% thì chiều giảm lại (≥ 12 lần, cao hơn mức chung ≥ 8 điểm) · Hay kéo/đạp ATC: ≥ 30% số phiên ATC thay đổi ≥ 0,5% và TB ≥ 0,2% · Kéo trần rồi xả / Đạp sàn rồi kéo: ≥ 3 lần · Nhiều phiên phân phối/rũ bỏ: ≥ 3 lần · Biên độ rộng, giằng co: biên độ ≥ 1,6× thị trường và ≥ 58% phiên đổi chiều", n: "Không biết được ai đứng sau – chỉ thấy cách giá bị chơi." },
  sw_rng: { t: "Biên độ trung bình", d: "Khoảng dao động cao–thấp trong một phiên, tính trên giá tham chiếu (trung vị 120 phiên).", f: "(Cao − Thấp) ÷ Giá đóng cửa phiên trước", hi: "Giá dao động mạnh trong phiên – dễ bị quét dừng lỗ.", lo: "Giá đi êm." },
  sw_rel: { t: "Biên độ so với thị trường", d: "Biên độ của mã gấp mấy lần biên độ của mã điển hình cùng ngày.", f: "Trung vị 120 phiên của (biên độ mã ÷ trung vị biên độ các mã thanh khoản cùng ngày)", hi: "> 1,5×: biến động bất thường.", lo: "< 1×: êm hơn thị trường." },
  sw_rev: { t: "Phiên đảo chiều (trên 100 phiên)", d: "Số phiên bị đẩy lên rồi xả xuống, hoặc bị đạp rồi kéo lên.", f: "Đẩy rồi xả: giá lên ≥ 1 biên độ quen thuộc (≥ 2,5%) so với tham chiếu nhưng đóng cửa trả lại ≥ 65% mức tăng · Đạp rồi kéo: ngược lại · Biên độ quen thuộc = trung vị biên độ 20 phiên trước", hi: "Hay bị \"làm giá\" trong phiên.", lo: "Ít đảo chiều trong phiên." },
  sw_pump_spike: { t: "Đẩy rồi xả + KL đột biến (phân phối)", d: "Giá bị đẩy lên mạnh rồi bán xuống, khối lượng ≥ 2,5 lần bình thường – có người tranh thủ giá cao để bán ra.", f: "Đẩy rồi xả và KL ≥ 2,5 × trung vị KL 20 phiên trước", n: "Xem bảng Kiểm chứng: sau phiên kiểu này giá thường đi đâu." },
  sw_dump_spike: { t: "Đạp rồi kéo + KL đột biến (rũ bỏ / gom)", d: "Giá bị bán mạnh rồi được mua lại với KL lớn.", f: "Đạp rồi kéo và KL ≥ 2,5 × trung vị 20 phiên", n: "Trên dữ liệu VN từ 2016, kiểu này thường đi kèm 5 phiên sau KÉM VN-Index – đừng vội coi là tín hiệu mua." },
  sw_leave_c: { t: "Chạm trần rồi rời", d: "Giá chạm trần trong phiên nhưng không giữ được, đóng cửa thấp hơn đỉnh ≥ 1,5% – lực bán chờ sẵn ở giá trần.", f: "Cao nhất ≥ trần (−0,6%) và Đóng cửa ≤ Cao nhất × 0,985" },
  sw_rec_f: { t: "Chạm sàn rồi kéo", d: "Giá chạm sàn trong phiên rồi được đỡ lên ≥ 1,5%.", f: "Thấp nhất ≤ sàn (+0,6%) và Đóng cửa ≥ Thấp nhất × 1,015" },
  sw_push: { t: "Tăng/giảm mạnh có KL lớn", d: "Biên độ ≥ 2 lần bình thường, KL đột biến, đóng cửa sát đỉnh (tăng thật) hoặc sát đáy (bán tháo) – để so sánh với các kiểu đảo chiều." },
  sw_fade: { t: "Sáng tăng → chiều xả", d: "Trong các phiên buổi sáng tăng ≥ 1,5% (giá 11:30 so với tham chiếu), bao nhiêu % buổi chiều giảm lại (giá 14:30 so với 11:30 giảm > 0,3%).", f: "Từ nến giờ (~3 năm) và nến phút (~6 tháng) · số nhỏ bên cạnh là số lần", hi: "≥ 60%: mã hay \"đẩy sáng, xả chiều\" – đừng mua đuổi buổi sáng, đang lãi thì chốt bớt khi sáng tăng mạnh.", lo: "Sáng tăng thường giữ được tới chiều." },
  sw_bounce: { t: "Sáng giảm → chiều kéo", d: "Trong các phiên buổi sáng giảm ≥ 1,5%, bao nhiêu % buổi chiều hồi lại (> 0,3%).", hi: "≥ 60%: mã hay \"đạp sáng, kéo chiều\" – đừng bán tháo buổi sáng.", lo: "Sáng giảm thường giảm tiếp." },
  sw_atc: { t: "Biến động phiên ATC", d: "Giá khớp ATC (14:45) so với giá cuối phiên liên tục (14:29).", f: "Giá ATC ÷ giá 14:29 − 1 · Kéo ATC % = số phiên ATC tăng ≥ 0,5%", hi: "TB dương, hay kéo ATC: giá đóng cửa thường \"đẹp\" hơn cung cầu trong phiên – đừng dựa vào giá đóng cửa để mua đuổi sáng hôm sau.", lo: "TB âm, hay đạp ATC: giá đóng cửa thường xấu hơn – đừng vội bán ATO sáng hôm sau." },
  sw_hi_early: { t: "Đỉnh / đáy đầu phiên", d: "% số phiên giá cao nhất (thấp nhất) xuất hiện trong 45 phút đầu (trước 9:45).", hi: "Đỉnh đầu phiên cao: hay bị đẩy lúc mở cửa rồi bán dần – không mua lúc ATO/đầu phiên." },
  sw_ac1: { t: "Tự tương quan 1 phiên", d: "Phiên hôm nay có xu hướng ngược hay cùng chiều với hôm qua.", f: "Tương quan giữa lợi nhuận ngày t và ngày t−1, 120 phiên", hi: "Dương: có quán tính, đi theo xu hướng.", lo: "Âm (< −0,1): giằng co – tăng xong lại giảm, giảm xong lại tăng (dấu hiệu bị lái / rung lắc)." },
  sw_path: { t: "Đường đi trung bình trong phiên", d: "Giá trung bình ở cuối mỗi khung 30 phút so với tham chiếu – thấy mã thường mạnh lúc nào, yếu lúc nào trong ngày.", f: "Trung bình (giá cuối khung ÷ tham chiếu − 1) của 60 phiên gần nhất có nến phút" },
  sw_pace: { t: "KL so với cùng giờ", d: "Khối lượng đã khớp tới giờ này gấp mấy lần mức thường có tới đúng giờ này.", f: "KL đã khớp ÷ (KL trung bình 20 phiên × tỷ lệ KL thường khớp tới giờ này theo nhịp 30 phút của chính mã)", hi: "≥ 2,5×: bất thường – có thể có thông tin hoặc tay to vào/ra." },
  sw_fnet: { t: "Khối ngoại ròng", d: "Giá trị mua − bán của nhà đầu tư nước ngoài trong phiên (tỷ đồng).", hi: "Mua ròng mạnh: dòng tiền ngoại vào.", lo: "Bán ròng mạnh (≥ 10 tỷ và ≥ 25% GTGD): áp lực bán." },
  sw_fade_hi: { t: "Cao / thấp / từ đỉnh trong phiên", d: "Giá cao nhất, thấp nhất so với tham chiếu và giá hiện tại cách đỉnh phiên bao nhiêu %.", hi: "Từ đỉnh ≤ −2%: đang bị xả từ đỉnh phiên." },
  sw_shark: { t: "Cá mập / Sói / Cừu", d: "Phân loại lệnh khớp theo giá trị lệnh (Vietcap): Cá mập = lệnh rất lớn, Sói = vừa, Cừu = nhỏ lẻ. Số dương = mua chủ động nhiều hơn bán chủ động.", f: "Tổng giá trị lệnh mua chủ động − bán chủ động theo từng nhóm, tách buổi sáng / chiều", hi: "Cá mập mua ròng: tay to gom.", lo: "Cá mập bán ròng trong khi Cừu mua ròng: tay to đang phân phối cho nhỏ lẻ.", n: "Chỉ lấy cho mã anh nắm/theo dõi, lưu từ khi bắt đầu chạy." },
  upd: { t: "Thời điểm cập nhật", d: "Lần cuối hệ thống lấy dữ liệu và tính lại. Mỗi ngày giao dịch có 3 lượt: 11:35 và 14:35 (giá trong phiên, cảnh báo) và 15:35 (phân tích đầy đủ sau đóng cửa); 8:00 thứ 7 tải lại báo cáo tài chính.", hi: "Chấm đỏ nhấp nháy: đang dùng giá trong phiên hôm nay.", lo: "Chấm vàng: dữ liệu đã cũ hơn 30 giờ – lượt chạy có thể bị trễ hoặc lỗi.", n: "Rê chuột / chạm để xem chi tiết: dữ liệu phiên nào, phân tích lúc nào." },
  tstat: { t: "t (độ tin cậy thống kê)", d: "Kết quả trung bình lớn gấp mấy lần sai số – càng xa 0 càng khó là may rủi.", f: "Trung bình theo ngày ÷ (độ lệch chuẩn ÷ √số ngày)", hi: "|t| ≥ 2: có ý nghĩa thống kê.", lo: "|t| < 2: có thể chỉ là ngẫu nhiên." },
};

// nhãn hiển thị → mục từ điển (so khớp sau khi bỏ dấu cách thừa, ▾▴, dấu ":" cuối)
const GLOSS_ALIAS = {
  "P/E": "pe", "P/E (đ)": "pe", "PE": "pe", "P/E GQ": "pe_w", "P/E gia quyền": "pe_w", "P/E gia quyền các ngành": "pe_w", "P/E TT gia quyền": "pe_w", "gia quyền": "ab_gq",
  "P/E TV": "pe_med", "P/E trung vị": "pe_med", "P/E TT trung vị": "pe_med", "trung vị": "ab_tv", "P/E ngành": "pe_ind", "P/E thị trường": "pe_mkt", "P/E toàn thị trường": "pe_mkt", "P/E TT": "pe_mkt",
  "P/E vs ngành": "vs_ind", "P/E so ngành": "vs_ind", "P/B vs ngành": "vs_ind", "vs ngành": "vs_ind", "P/E vs ngành / TT": "vs_ind", "P/E vs TT": "vs_mkt", "vs TT": "vs_mkt",
  "vs LS": "vs_hist", "P/E vs LS": "vs_hist", "P/B vs LS": "vs_hist", "TV vs LS": "vs_hist", "P/E so với lịch sử": "vs_hist", "Phân vị LS": "pctl_hist", "Rẻ nhất so với lịch sử": "vs_hist",
  "P/B": "pb", "P/B GQ": "pb_w", "P/B gia quyền": "pb_w", "P/B TT": "pb_w", "P/B TV": "pb_med", "P/B trung vị": "pb_med", "P/B ngành": "pe_ind", "P/B gia quyền / TV": "pb_w", "P/B gia quyền / trung vị": "pb_w",
  "P/S": "ps", "EV/EBITDA": "ev_ebitda", "PEG": "peg", "PEG (TV)": "peg", "LS lợi nhuận": "ey", "Lợi suất LN": "ey", "PEG · Lợi suất LN": "peg", "Lợi suất LN vs TPCP 10N": "erp", "LS FCF": "fcf_yield",
  "Giá trị hợp lý": "fair", "Hợp lý": "fair", "Khoảng": "fair_range", "Mua dưới": "buy_below", "Biên an toàn": "mos", "Biên an toàn %": "mos", "Tiềm năng": "upside", "Tiềm năng TV": "upside", "Tiềm năng ≥ %": "upside", "tiềm năng": "upside",
  "Định giá": "verdict", "EPS (đ)": "eps", "EPS": "eps", "BVPS (đ)": "bvps", "Vốn hoá": "mcap", "Vốn hoá có BCTC": "mcap", "GTGD/ngày": "gtgd", "GTGD": "gtgd", "GTGD ≥ tỷ": "gtgd", "GTGD ≥ (tỷ)": "gtgd",
  "Cổ tức": "div_yield", "Cổ tức (TV)": "div_yield", "Lợi suất": "div_yield", "Cổ tức ≥ %": "div_yield", "Tỷ lệ chi trả": "payout", "Năm trả TM": "cash_years", "Năm trả liên tiếp": "cash_years",
  "ROE": "roe", "ROE TB5": "roe_avg5", "ROE TB 5 năm": "roe_avg5", "ROE GQ": "roe_w", "ROE gia quyền": "roe_w", "ROE TV": "roe", "ROE trung vị": "roe", "ROE ≥ %": "roe", "ROE · F-Score": "roe",
  "ROA": "roa", "ROIC": "roic", "Biên gộp": "gross_margin", "Biên ròng": "net_margin", "Biên LN ròng": "net_margin", "CFO/LN": "cfo_ni", "Vay/Vốn": "de", "F-Score": "fscore", "F-Score ≥": "fscore", "% DN lỗ": "loss_share",
  "DT 12T": "rev_yoy", "DT 12T (TV)": "rev_yoy", "DT 12 tháng": "rev_yoy", "LN 12T": "ni_yoy", "LN 12T (TV)": "ni_yoy", "LN 12 tháng": "ni_yoy", "DT quý": "rev_q_yoy", "LN quý": "ni_q_yoy", "LN quý gần nhất": "ni_q_yoy",
  "DT CAGR3": "cagr", "LN CAGR3": "cagr", "DT CAGR 3N": "cagr", "LN CAGR 3N": "cagr", "LN CAGR 3 năm": "cagr", "Quý LN tăng": "ni_growth_streak",
  "Hôm nay": "chg", "1 tuần": "chg", "1 tháng": "chg", "3 tháng": "chg", "1 năm": "chg", "Giá 6T": "chg", "1 tháng · 1 năm": "chg", "12–1 tháng": "ret_12_1",
  "Cách đỉnh 52T": "from_hi52", "Cách đỉnh ≤ %": "from_hi52", "Đỉnh / đáy 52T": "hilo52", "Điểm KT": "ta_score", "Điểm kỹ thuật": "ta_score", "Kỹ thuật": "ta_score", "KT chỉ số": "ta_score",
  "Xu hướng": "trend", "RSI": "rsi", "RSI VN-Index": "rsi", "MACD": "macd", "OBV": "obv", "MA20": "ma", "MA50": "ma", "MA200": "ma", "EMA21": "ma", ">MA50": "above_ma", ">MA200": "above_ma", "% trên MA50": "above_ma", "% trên MA200": "above_ma",
  "Bollinger": "bollinger", "Beta": "beta", "Biến động": "vol", "Biến động 1N": "vol", "Biến động · Sharpe": "vol", "RS": "rs", "Sức mạnh": "rs",
  "Độ rộng": "breadth", "Độ rộng thị trường": "breadth", "Tăng / giảm": "breadth", "Tăng/giảm": "breadth", "Ngày phân phối": "dist_days", "Hỗ trợ": "sr", "Kháng cự": "sr", "Mức giá": "sr", "Sóng": "elliott", "Elliott": "elliott", "Mô hình giá": "pattern",
  "SMC": "smc", "SMC TB": "smc", "SMC hướng": "bias", "VSA hướng": "bias", "OF hướng": "bias", "Premium/Discount": "pd", "Vị trí P/D": "pd", "VSA": "vsa", "Wyckoff": "wyckoff", "Pha Wyckoff": "wyckoff", "Order Flow": "orderflow", "Delta 5 phiên": "orderflow",
  "Dấu chân tổ chức": "smc", "Dấu chân tổ chức mạnh": "smc", "Tạo lập & dòng tiền": "smc", "Dòng tiền thông minh": "smc",
  "Điểm": "composite", "Tổng hợp": "composite", "Điểm phương pháp": "score", "Điểm theo từng phương pháp": "score", "Điểm TH": "composite", "Điểm ≥": "composite", "Điểm PA": "score", "Điểm TV": "composite",
  "Piotroski": "piotroski", "Magic F.": "magic", "Magic Formula": "magic", "Giá trị": "value", "Chất lượng": "quality", "Tăng trưởng": "growth", "Động lượng": "momentum", "CANSLIM": "canslim", "CANSLIM đạt": "canslim", "Ít biến động": "low_vol", "Biến động thấp": "low_vol",
  "Hạng ngành": "ind_rank", "Điểm tổng (TL+QK)": "fb_total", "Điểm tương lai": "fb_fwd", "Điểm quá khứ": "fb_back", "Trọng số tương lai": "fb_w", "Tương lai / quá khứ": "fb_total", "Tương quan": "ic", "Tương quan với LN 3 tháng sau": "ic", "% tương lai": "fb_w", "Trọng số": "fb_w", "Hạng": "score", "Tương quan 3 tháng": "ic", "Tương quan 12 tháng": "ic", "Mùa vụ": "season", "Mùa vụ các ngành": "season", "Từ hôm nay 1 tháng": "season", "Ngày này +1 tháng": "season", "So VN-Index +1 tháng": "season", "% năm hơn VNI": "season", "Số năm": "season", "Sau 1 tháng": "season", "Sau 2 tháng": "season", "Sau 3 tháng": "season", "Năm nay": "season", "Năm nay ủng hộ": "season", "Năm nay không ủng hộ": "season", "Năm nay chưa rõ": "season", "Đa khung": "mtf", "Đa khung thời gian": "mtf", "Khung ngày": "mtf", "Khung tuần": "mtf", "Khung tháng": "mtf", "Khung quý": "mtf", "Đồng thuận": "mtf", "Ngày": "tfk", "Tuần": "tfk", "Tháng": "tfk", "Quý": "tfk", "Năm": "tfk", "Cấu trúc": "mtf", "Vị trí": "pd", "3–6 tháng": "outlook", "12 tháng": "outlook", "Triển vọng": "outlook", "Đáng đầu tư": "outlook", "Nên tránh": "outlook", "Trung tính": "outlook", "Vòng": "quadrant", "Dẫn dắt": "quadrant", "Cải thiện": "quadrant", "Suy yếu": "quadrant", "Tụt hậu": "quadrant", "Ngành Suy yếu": "quadrant", "Ngành Tụt hậu": "quadrant", "Ngành Dẫn dắt": "quadrant", "Ngành Cải thiện": "quadrant", "RS-Ratio / Mom": "rrg", "Xoay vòng ngành (RRG)": "rrg", "Số mã": "nstock",
  "Lãi kép/năm": "cagr_ret", "Lãi kép / năm": "cagr_ret", "Lãi/năm": "cagr_ret", "Mục tiêu / năm": "cagr_ret", "Hệ thống + đèn / năm": "cagr_ret", "Top 3 / năm": "cagr_ret", "Top 3/năm": "cagr_ret", "Cả ngành / năm": "cagr_ret", "Cả ngành/năm": "cagr_ret", "VN-Index / năm": "cagr_ret",
  "Sụt tối đa": "maxdd", "Sụt": "maxdd", "Sụt sâu nhất": "maxdd", "Sụt top 3": "maxdd", "Sụt tối đa ngành": "maxdd", "Sụt tối đa top 3": "maxdd", "VN-Index sụt": "maxdd", "Chấp nhận sụt": "maxdd",
  "Sharpe": "sharpe", "Sharpe top / ngành": "sharpe", "Alpha": "alpha", "Alpha chọn mã": "alpha", "Vượt trội (alpha)": "alpha", "Vượt VNI": "alpha", "Vượt VNI TB": "alpha", "Vượt VNI TB/lượt": "alpha", "Vượt": "alpha", "Thắng VN-Index": "winrate",
  "Tỷ lệ thắng": "winrate", "Tỷ lệ có lãi": "winrate", "Thắng": "winrate", "Hệ số lãi/lỗ": "pf_ratio", "Theo dõi thực tế": "fwd",
  "Đèn": "light", "Đèn X/V/Đ": "exposure", "Đèn lúc mua": "light", "được nắm cổ phiếu": "exposure", "Tỷ trọng cổ phiếu": "exposure", "Tỷ trọng cổ phiếu theo đèn thị trường": "exposure", "Tỷ trọng": "weight", "Tỷ trọng CP sau": "weight", "Tối đa/mã % vốn": "weight", "Tối đa/ngành % vốn": "weight",
  "Điểm dừng": "stop", "Dừng lỗ": "stop", "Cắt lỗ": "stop", "Dừng – khoá lãi": "stop", "Dừng lỗ của anh": "stop", "Dừng lỗ riêng": "stop", "Cắt lỗ khi giảm": "stop", "Mục tiêu": "target", "Mục tiêu 1": "target", "Mục tiêu 2": "target",
  "Mục tiêu 1 (3R)": "rmult", "Mục tiêu 2 (4R)": "rmult", "Lời / lỗ kỳ vọng": "rr", "Lời / lỗ": "rr", "Lãi/lỗ kỳ vọng": "rr", "Vùng mua": "zone", "Giá vốn": "cost", "Được bán từ": "t2", "hàng về T+2": "t2", "Lãi/lỗ chưa chốt": "unrealized", "Lãi/lỗ đã chốt": "realized", "Sụt từ đỉnh sau mua": "dd_since",
  "GARP": "garp", "Phòng thủ": "defensive", "Lướt sóng": "st_swing", "Trung hạn": "st_position", "Trung hạn ●": "st_position", "Dài hạn": "st_long", "Đầu tư dài hạn": "st_long", "Trung hạn theo xu hướng": "st_position",
  "TV": "ab_tv", "GQ": "ab_gq", "TT": "ab_tt", "LS": "ab_ls", "12T": "ab_12t", "VNI": "ab_vni", "VNI cùng kỳ": "ab_vni", "VN-Index cùng kỳ": "ab_vni", "KL": "ab_kl", "KL (cp)": "ab_kl",
  "Điểm bất thường": "sw_score", "Kiểu chơi": "sw_tags", "Biên độ TB": "sw_rng", "× thị trường": "sw_rel", "Phiên đảo chiều": "sw_rev", "Phân phối": "sw_pump_spike", "Rũ bỏ": "sw_dump_spike",
  "Phân phối / rũ bỏ": "sw_pump_spike", "Trần→rời / sàn→kéo": "sw_leave_c", "Trần→rời": "sw_leave_c", "Sàn→kéo": "sw_rec_f", "Sáng tăng→chiều xả": "sw_fade", "Sáng giảm→chiều kéo": "sw_bounce",
  "ATC TB": "sw_atc", "Kéo ATC": "sw_atc", "Đỉnh đầu phiên": "sw_hi_early", "Đỉnh / đáy đầu phiên": "sw_hi_early", "Tự tương quan": "sw_ac1", "KL so cùng giờ": "sw_pace", "NN ròng": "sw_fnet",
  "Từ đỉnh": "sw_fade_hi", "Sáng": "sw_fade", "Chiều": "sw_fade", "Hành vi giá & tay chơi lớn": "sw_tags", "Biến động & đảo chiều": "sw_score",
  "Sáng tăng ≥ 1,5% → chiều giảm lại": "sw_fade", "Sáng giảm ≥ 1,5% → chiều hồi": "sw_bounce", "ATC trung bình": "sw_atc", "Kéo ATC ≥ 0,5% / đạp ≥ 0,5%": "sw_atc",
  "Đỉnh trong 45 phút đầu": "sw_hi_early", "Đáy trong 45 phút đầu": "sw_hi_early", "Tương quan với biến động 20 phiên sau": "sw_score", "Tương quan với lợi nhuận 20 phiên sau": "sw_score", "t": "tstat",
  "VN-Index": "idx", "HNX-Index": "idx", "UPCoM": "idx", "VN30": "idx", "VNINDEX": "idx", "HNXINDEX": "idx", "UPCOMINDEX": "idx", "Mã trần": "ceil_floor",
};
const GLOSS_RX = [
  [/^Theo chỉ số hướng TƯƠNG LAI/, "fb_fwd"], [/^Theo chỉ số hướng QUÁ KHỨ/, "fb_back"], [/^TỔNG – \d+% tương lai/, "fb_total"], [/^Hướng tương lai \(/, "fb_fwd"], [/^Hướng quá khứ \(/, "fb_back"], [/^Hỗn hợp \(/, "fb_w"],
  [/^Ngày \d\d\/\d\d các năm trước$/, "season"], [/^Kiểm chứng ngoài mẫu/, "oos"],
  [/– đa khung thời gian$/, "mtf"],
  [/^\d+ mã · \d+% trên MA50 · /, "above_ma"], [/^Lãi\/lỗ$/, "realized"], [/^Bán %$/, "exit_status"], [/^\/ tối đa \d+%$/, "exposure"], [/^GARP( [A-ZĐa-zà-ỹ]+)+$/, "garp"],
  [/^[CANSLM]{1,6}$/, "canslim"], [/^(HOSE|HNX|UPCOM|UPCoM)( ·.*)?$/, "exchange"], [/^VSA – Spring|^VSA – /, "vsa"], [/^SMC – (BOS|CHoCH)/, "bos"], [/^SMC – về Order Block/, "ob"], [/^SMC – /, "smc"],
  [/^Chính mã, TB \d+ quý$/, "hist_avg"], [/^(Dẫn dắt|Cải thiện|Suy yếu|Tụt hậu) · /, "quadrant"], [/P\/E [\d,]+ vs ngành [\d,]+$/, "vs_ind"], [/^cao hơn vùng mua/, "zone"], [/^còn [+-−]?[\d.,]+%$/, "exit_dist"],
  [/^(sắp chạm|ĐÃ CHẠM|đã làm)( .*)?$/, "exit_status"], [/^phiên \d+\/\d+$/, "time_stop"], [/^(trần|tối đa) \d+%$/, "weight"], [/^lãi\/lỗ( [+-−]?[\d.,]+%)?$/, "unrealized"], [/^Lãi TB$/, "avg_ret"], [/^Tiền mặt TB$/, "cash_avg"],
  [/^Tiền mặt nên giữ/, "cash"], [/^Lệnh\/năm$/, "turnover"], [/^Rủi ro\/lệnh/, "risk_trade"], [/^Mã\/rổ$/, "per_basket"], [/^Số mã mỗi rổ/, "per_basket"], [/^GARP \d+ · /, "alloc"], [/^Phân bổ vốn theo rổ$/, "alloc"], [/^Phí %$/, "fee"], [/^Lãi %$/, "realized"],
  [/^Vượt \/ sát đỉnh 52 tuần$/, "from_hi52"], [/^– hơn \d+% ngành$/, "pctl_ind"], [/^TV [\d.,]+$/, "ab_tv"], [/^P\/E ≤$/, "pe"], [/^(MUA|GIỮ|BÁN HẾT|BÁN BỚT|MUA THÊM|MUA MỚI|CẮT LỖ \/ BÁN|XEM LẠI LUẬN ĐIỂM|BÁN – LUẬN ĐIỂM GÃY|CÂN NHẮC GIẢM TỶ TRỌNG|CHỐT LỜI .*)$/, "action"],
  [/^(Rổ )?Tăng trưởng mạnh \(CANSLIM\)$/, "b_growth"], [/^chốt \d+\/\d+|– chốt \d\/\d$/, "target"],
  [/^ngành [\d.,—–-]+( · TT [\d.,—–-]+)?$/, "ctx_ind_mkt"], [/^P\/E ngành TV/, "ctx_ind_mkt"], [/^TB [\d.,]+ · Q\d\/\d\d/, "hist_avg"], [/^TB LS [\d.,]+$/, "hist_avg"], [/^(rẻ|TB|đắt) · \d+$/, "pctl_hist"],
  [/^SMC \d+ · VSA \d+$/, "smc"], [/^P\/E [\d.,]+( vs ngành [\d.,]+)?$/, "pe"], [/^(Tích luỹ|Tích lũy|Phân phối) [A-E/ ]+$/, "wyckoff"], [/^Thoái lui|^Mở rộng [\d.]+%/, "fib"], [/^hoà vốn sau phí/, "breakeven"],
  [/^đúng \d+%\//, "reliability"], [/^Hạng \d+\/\d+ trong ngành$/, "ind_rank"], [/^Xu hướng (Tăng|Giảm|Đi ngang)$/i, "trend"], [/^Định giá: /, "verdict"], [/^Kỹ thuật: /, "ta_score"],
  [/\bRRG\b/, "rrg"], [/^\d+ mã (trần|sàn)$/, "ceil_floor"], [/^\d+ (tăng|giảm)$/, "breadth"], [/^trung vị [\d.,]+$/, "pe_med"], [/^nắm tối đa \d+%$/, "exposure"], [/^Đèn (xanh|vàng|đỏ)$/i, "light"],
  [/\((3R|4R)\)/, "rmult"], [/^(chốt \d|MT\d)/, "target"], [/^(dừng|xem lại) [\d.,]+$/, "stop"], [/^Vượt giá trị hợp lý/, "target"], [/^Lợi suất còn/, "target"], [/^cổ tức [\d.,]+%$/, "div_yield"], [/^ROE [\d.,]+%/, "roe"],
  [/^(MUA|chờ) · (Lướt sóng|Trung hạn|Dài hạn|Cổ tức)$/, "zone"], [/^Thắng VN-Index/, "winrate"], [/^Sau (5|20|60) phiên$/, "fwd"], [/^% xu hướng tăng$/, "trend"], [/^Kỹ thuật VN-Index$/, "ta_score"],
];

// ---------------------------------------------------------------- gắn giải thích & hiện hộp giải thích
const GL = (() => {
  const norm = (t) => String(t || "").replace(/\s+/g, " ").replace(/[▾▴]/g, "").replace(/\s*[:：]\s*$/, "").trim();
  const keyFor = (t) => {
    t = norm(t);
    if (!t || t.length > 48) return null;
    if (GLOSS_ALIAS[t]) return GLOSS_ALIAS[t];
    for (const [rx, k] of GLOSS_RX) if (rx.test(t)) return k;
    return null;
  };
  const SEL = "th, dt, small, label, .pill, td.l, .bi b, .bi small, .lleg span, summary, h2, .pk-facts>div>small:first-child, .exr .ex-l b, .ph .meta, .leg span, .big>small, .dk>small, .bd-light b, .seg button, .views button";
  const own = (el) => { let t = ""; el.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent; }); return t; };
  function annotate(root) {
    (root || document).querySelectorAll(SEL).forEach((el) => {
      if (el.dataset.gk) return;
      el.dataset.gk = "1";
      if (el.dataset.g) return;
      const k = keyFor(el.textContent) || keyFor(own(el));
      if (k && GLOSS[k]) el.dataset.g = k;
    });
  }
  let tip = null, cur = null, timer = 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function html(g) {
    return `<b class="gt">${esc(g.t)}</b><p>${esc(g.d)}</p>${g.f ? `<p class="gr"><i>Công thức</i><span>${esc(g.f)}</span></p>` : ""}${g.hi ? `<p class="gr hi"><i>Cao</i><span>${esc(g.hi)}</span></p>` : ""}${g.lo ? `<p class="gr lo"><i>Thấp</i><span>${esc(g.lo)}</span></p>` : ""}${g.n ? `<p class="gn">${esc(g.n)}</p>` : ""}`;
  }
  function show(el) {
    const g = GLOSS[el.dataset.g]; if (!g) return;
    if (!tip) { tip = document.createElement("div"); tip.id = "gtip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    cur = el;
    tip.innerHTML = html(g);
    tip.style.visibility = "hidden"; tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8), y = r.bottom + 8;
    if (y + h > vh - 8 && r.top - h - 8 > 8) y = r.top - h - 8;
    tip.style.left = x + "px"; tip.style.top = Math.max(8, y) + "px"; tip.style.visibility = "";
    el.setAttribute("aria-describedby", "gtip");
  }
  function hide() { clearTimeout(timer); if (tip) tip.hidden = true; if (cur) cur.removeAttribute("aria-describedby"); cur = null; }
  function init() {
    let touch = false;
    document.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const el = e.target.closest?.("[data-g]");
      if (!el) return;
      if (el === cur) return;
      clearTimeout(timer); timer = setTimeout(() => show(el), 140);
    });
    document.addEventListener("pointerout", (e) => {
      if (e.pointerType === "touch") return;
      const el = e.target.closest?.("[data-g]");
      if (el && !el.contains(e.relatedTarget)) hide();
    });
    document.addEventListener("pointerdown", (e) => {
      touch = e.pointerType === "touch";
      const el = e.target.closest?.("[data-g]");
      if (touch && el) { if (cur === el) hide(); else show(el); }
      else if (!e.target.closest?.("#gtip")) hide();
    }, true);
    document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-g]"); if (el && !touch) show(el); });
    document.addEventListener("focusout", hide);
    addEventListener("scroll", () => { if (cur && !touch) hide(); }, { passive: true, capture: true });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    let pend = 0;
    new MutationObserver(() => { if (!pend) pend = requestAnimationFrame(() => { pend = 0; annotate(document); }); }).observe(document.body, { childList: true, subtree: true });
    annotate(document);
  }
  return { init, annotate, keyFor, show, hide };
})();
