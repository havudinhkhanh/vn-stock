"""Nhóm so sánh ("mâm") theo MÔ HÌNH KINH DOANH – thay cho phân ngành ICB cấp 3 khi so P/E, P/B, ROE, tăng trưởng.

Vì sao: ICB chia theo sản phẩm, 36 nhóm cho ~1.500 mã → ACV (độc quyền sân bay) chung mâm cảng biển & chuyển phát; GAS chung mâm
nước sạch & đại lý gas; cao su (định giá theo quỹ đất KCN) chung mâm phân bón; BĐS nhà ở chung mâm KCN, cho thuê & tập đoàn đa ngành…
Mặt bằng P/E, P/B hợp lý phụ thuộc mô hình kinh doanh (độc quyền / chu kỳ / thâm dụng tài sản / quỹ đất), nên mâm sai làm méo
giá trị hợp lý một cách hệ thống.

Cách gán (theo thứ tự ưu tiên):
  1. anh tự đổi trên web (khoá "peermap" trong dữ liệu tài khoản quản trị): {mã: khoá nhóm}
  2. gán tay cho các mã lớn / dễ nhầm (MANUAL)
  3. quy tắc theo tên công ty trong từng ngành con (RULES) – vd. "Cảng", "Cao su", "Xi măng", "Thủy điện"
  4. mặc định theo ngành con ICB (SUB)
Tính trung vị: chỉ mã có thanh khoản, bỏ tập đoàn đa ngành (không có mâm tương đồng – định giá theo DCF & lịch sử của chính mã),
bỏ giá trị ngoại lai (P/E, P/B lệch quá 3 lần trung vị mâm). Mâm < 3 mã tham chiếu → nhóm gần nhất (FALLBACK) → ngành ICB cấp 3.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

GROUPS = {
    "bank": "Ngân hàng", "broker": "Chứng khoán", "consfin": "Tài chính tiêu dùng & cho vay", "fin_other": "Đầu tư & quản lý tài sản",
    "ins_nl": "Bảo hiểm phi nhân thọ & tái bảo hiểm", "ins_life": "Bảo hiểm nhân thọ",
    "re_res": "BĐS nhà ở & đô thị", "re_ip": "BĐS khu công nghiệp", "re_lease": "BĐS cho thuê, TTTM & nghỉ dưỡng", "re_svc": "Môi giới & dịch vụ BĐS",
    "cons_civil": "Xây dựng dân dụng & công nghiệp", "cons_infra": "Xây dựng hạ tầng, giao thông & BOT", "cons_power": "Xây lắp điện & cơ điện",
    "cement": "Xi măng", "mat_stone": "Đá, khoáng & bê tông xây dựng", "mat_finish": "Gạch, gốm sứ, kính & sơn", "pipe": "Ống nhựa xây dựng",
    "steel": "Thép", "metal_nf": "Kim loại màu & nhôm", "mining": "Khoáng sản", "coal": "Than",
    "fert": "Phân bón", "chem": "Hóa chất cơ bản & hóa dầu", "agchem": "Thuốc BVTV, thú y & vật tư nông nghiệp", "rubber": "Cao su thiên nhiên",
    "tyre": "Săm lốp", "plastic": "Nhựa, bao bì & đóng gói", "paper": "Giấy", "wood": "Gỗ & lâm sản",
    "oil_svc": "Dịch vụ & thiết bị dầu khí", "oil_ref": "Lọc hoá dầu", "fuel": "Kinh doanh xăng dầu", "gas": "Khí & phân phối khí",
    "hydro": "Thủy điện", "thermal": "Nhiệt điện & điện khí", "power_other": "Điện tái tạo & phân phối điện", "water": "Nước sạch", "env": "Môi trường & chất thải",
    "port": "Cảng biển & ICD", "ship": "Vận tải biển", "airline": "Hàng không", "airport": "Sân bay & dịch vụ hàng không", "logistics": "Logistics & giao nhận",
    "road": "Vận tải bộ, đường sắt & bến xe", "express": "Chuyển phát",
    "machinery": "Cơ khí & máy móc", "elec_equip": "Thiết bị điện & dây cáp", "auto": "Ô tô & phụ tùng", "shipbuild": "Đóng tàu & xe chuyên dụng",
    "consult": "Tư vấn, thiết kế & dịch vụ kỹ thuật",
    "dairy": "Sữa & thực phẩm tiêu dùng có thương hiệu", "food": "Chế biến thực phẩm & lương thực", "sugar": "Mía đường", "seafood": "Thủy sản",
    "livestock": "Chăn nuôi & thực phẩm thịt", "agri": "Nông nghiệp & cây trồng", "beer": "Bia & rượu", "beverage": "Đồ uống & giải khát", "tobacco": "Thuốc lá",
    "garment": "Dệt may & da giày", "retail": "Bán lẻ", "distribution": "Phân phối & thương mại", "household": "Hàng gia dụng & cá nhân",
    "pharma": "Dược phẩm", "health": "Y tế & thiết bị y tế", "hotel": "Khách sạn, du lịch & giải trí", "media": "Truyền thông, xuất bản & giáo dục",
    "telecom": "Viễn thông & hạ tầng viễn thông", "it": "Công nghệ & phần mềm", "hardware": "Thiết bị & phần cứng điện tử",
    "conglomerate": "Tập đoàn đa ngành",
}
NO_MEDIAN = {"conglomerate"}          # đa ngành: không có mâm tương đồng → P/E, P/B theo lịch sử của chính mã
MKT_MEDIAN = {"airline"}              # chỉ 2 hãng bay, P/E dao động cực mạnh theo chu kỳ → so với mặt bằng toàn thị trường
MIN_N = {"airline": 2}                # chỉ 2 hãng bay niêm yết: so với nhau còn hơn so với dịch vụ sân bay          # không có mâm tương đồng: không lấy trung vị, không góp vào trung vị của mâm khác
# mâm quá nhỏ → so với nhóm gần nhất trước khi lùi về ngành ICB
FALLBACK = {
    "retail": "distribution",
    "ins_life": "ins_nl", "oil_ref": "fuel", "express": "logistics", "re_svc": "re_res", "re_lease": "re_res",
    "cons_power": "cons_infra", "pipe": "plastic", "tyre": "rubber", "metal_nf": "mining", "coal": "mining", "agchem": "chem",
    "paper": "plastic", "wood": "household", "tobacco": "beverage", "beer": "beverage", "health": "pharma", "consfin": "fin_other",
    "shipbuild": "machinery", "elec_equip": "machinery", "auto": "machinery", "power_other": "hydro", "thermal": "hydro",
    "road": "logistics", "airport": "port", "env": "water", "hardware": "it", "telecom": "it", "dairy": "food", "sugar": "food",
    "livestock": "food", "agri": "food", "seafood": "food", "mat_finish": "mat_stone", "cement": "mat_stone", "fin_other": "broker",
}

SUB = {
    "Sản xuất bia": "beer", "Vang & Rượu mạnh": "beer", "Đồ uống & giải khát": "beverage",
    "Bán lẻ phức hợp": "distribution", "Dịch vụ tiêu dùng chuyên ngành": "household", "Phân phối hàng chuyên dụng": "distribution",
    "Bảo hiểm nhân thọ": "ins_life", "Bảo hiểm phi nhân thọ": "ins_nl", "Tái bảo hiểm": "ins_nl",
    "Bất động sản": "re_res", "Tư Vấn, Định giá, Môi giới Bất động sản": "re_svc",
    "Máy công nghiệp": "machinery", "Xe tải & Đóng tàu": "shipbuild",
    "Dịch vụ giải trí": "hotel", "Hàng không": "airline", "Khách sạn": "hotel", "Nhà hàng và quán bar": "hotel", "Vận tải hành khách & Du lịch": "road",
    "Công nghệ sinh học": "pharma", "Dược phẩm": "pharma",
    "Môi giới chứng khoán": "broker", "Quản lý tài sản": "fin_other", "Tài chính cá nhân": "consfin", "Tài chính đặc biệt": "fin_other",
    "Giầy dép": "garment", "Hàng May mặc": "garment", "Hàng cá nhân": "household",
    "Containers & Đóng gói": "plastic", "Công nghiệp phức hợp": "machinery",
    "Thiết bị gia dụng": "household", "Đồ gia dụng lâu bền": "household", "Đồ gia dụng một lần": "household", "Điện tử tiêu dùng": "hardware", "Đồ chơi": "household",
    "Nhựa, cao su & sợi": "plastic", "Sản phẩm hóa dầu, Nông dược & Hóa chất khác": "chem",
    "Khai khoáng": "mining", "Khai thác Than": "coal", "Khai thác vàng": "mining",
    "Kim Loại màu": "metal_nf", "Nhôm": "metal_nf", "Thép và sản phẩm thép": "steel",
    "Lâm sản và Chế biến gỗ": "wood", "Sản xuất giấy": "paper", "Ngân hàng": "bank",
    "Nước": "water", "Phân phối xăng dầu & khí đốt": "fuel", "Tiện ích khác": "water", "Phân phối thực phẩm": "distribution",
    "Dịch vụ Máy tính": "it", "Internet": "it", "Phần mềm": "it",
    "Sản xuất & Phân phối Điện": "power_other", "Sản xuất và Khai thác dầu khí": "oil_ref",
    "Nuôi trồng nông & hải sản": "agri", "Thực phẩm": "food",
    "Chăm sóc y tế": "health", "Dụng cụ y tế": "health", "Thiết bị y tế": "health",
    "Phần cứng": "hardware", "Thiết bị viễn thông": "hardware", "Thiết bị văn phòng": "hardware",
    "Thiết bị và Dịch vụ Dầu khí": "oil_svc", "Thuốc lá": "tobacco",
    "Dịch vụ truyền thông": "media", "Giải trí & Truyền thông": "media", "Sách, ấn bản & sản phẩm văn hóa": "media",
    "Chất thải & Môi trường": "env", "Nhà cung cấp thiết bị": "distribution", "Tư vấn & Hỗ trợ KD": "consult", "Đào tạo & Việc làm": "media",
    "Viễn thông cố định": "telecom", "Viễn thông di động": "telecom",
    "Chuyển phát nhanh": "express", "Dịch vụ vận tải": "logistics", "Kho bãi, hậu cần và bảo dưỡng": "port", "Vận tải Thủy": "ship", "Đường sắt": "road",
    "Vật liệu xây dựng & Nội thất": "mat_stone", "Xây dựng": "cons_civil",
    "Lốp xe": "tyre", "Phụ tùng ô tô": "auto", "Sản xuất ô tô": "auto",
    "Hàng điện & điện tử": "elec_equip", "Thiết bị điện": "elec_equip",
}

# quy tắc theo tên công ty: (ngành con áp dụng hoặc None = mọi ngành con, biểu thức, nhóm) – lần lượt, khớp đầu tiên thắng
RULES = [
    ("Bất động sản", r"khu công nghiệp|\bkcn\b|sonadezi|long hậu|tân tạo|tín nghĩa|hiệp phước|nam tân uyên|công nghiệp số 2|đô thị công nghiệp|hạ tầng vĩnh phúc|idico|kinh bắc|phát triển công ngh", "re_ip"),
    ("Bất động sản", r"vincom retail|cho thuê|hội chợ|triển lãm|ninh vân bay|du lịch", "re_lease"),
    ("Nhựa, cao su & sợi", r"cao su", "rubber"),
    ("Sản phẩm hóa dầu, Nông dược & Hóa chất khác", r"phân bón|phân lân|phân đạm|supe phốt phát|dap|phân bón", "fert"),
    ("Sản phẩm hóa dầu, Nông dược & Hóa chất khác", r"thuốc|bảo vệ thực vật|khử trùng|vật tư|nông nghiệp", "agchem"),
    ("Phân phối xăng dầu & khí đốt", r"\bgas\b|lpg|\bcng\b|kinh doanh khí|phân phối khí|khí thấp áp", "gas"),
    ("Sản xuất & Phân phối Điện", r"thủy điện|thuỷ điện|sông ba|sê san", "hydro"),
    ("Sản xuất & Phân phối Điện", r"nhiệt điện|điện lực dầu khí|phát điện|điện lực tkv|điện miền bắc 2", "thermal"),
    ("Nuôi trồng nông & hải sản", r"thủy sản|thuỷ sản|hải sản|vĩnh hoàn|nam việt|sao ta|minh phú|i\.d\.i|camimex|kiên hùng|sao mai|ntaco|út xi|mekong|cửu long|thủy đặc sản|ngô quyền|tô châu", "seafood"),
    ("Nuôi trồng nông & hải sản", r"chăn nuôi|nông súc|dabaco|\bbaf\b|mitraco", "livestock"),
    ("Thực phẩm", r"sữa|bò sữa", "dairy"),
    ("Thực phẩm", r"đường|mía|thành thành công - biên hòa", "sugar"),
    ("Thực phẩm", r"súc sản|meatlife", "livestock"),
    ("Thực phẩm", r"hàng tiêu dùng|kido|bánh kẹo|bích chi", "dairy"),
    ("Dịch vụ vận tải", r"vận tải biển|vận tải dầu khí|vận tải xăng dầu|global pacific|hải minh", "ship"),
    ("Dịch vụ vận tải", r"cảng", "port"),
    ("Kho bãi, hậu cần và bảo dưỡng", r"sân bay|hàng không|hàng hóa nội bài|mặt đất", "airport"),
    ("Kho bãi, hậu cần và bảo dưỡng", r"bến xe|cao tốc|vận tải 1|đảm bảo giao thông", "road"),
    ("Kho bãi, hậu cần và bảo dưỡng", r"logistics|kho vận|giao nhận|transimex|tập đoàn asg|alpha seven", "logistics"),
    ("Kho bãi, hậu cần và bảo dưỡng", r"vận tải và xếp dỡ hải an", "ship"),
    ("Vận tải Thủy", r"cảng", "port"),
    ("Vận tải Thủy", r"logistics|vinafco|tiếp vận", "logistics"),
    ("Vận tải hành khách & Du lịch", r"du lịch|lữ hành", "hotel"),
    ("Vật liệu xây dựng & Nội thất", r"xi măng|vicem|thạch cao", "cement"),
    ("Vật liệu xây dựng & Nội thất", r"nhựa", "pipe"),
    ("Vật liệu xây dựng & Nội thất", r"gạch|gốm|\bsứ\b|kính|ceglass|\bsơn\b|taicera|redstar|cera|ốp lát|tấm lợp|viglacera", "mat_finish"),
    ("Xây dựng", r"tư vấn|thiết kế", "consult"),
    ("Xây dựng", r"lắp máy|cơ điện|xây lắp điện|điện lực|xây lắp đường dây|năng lượng", "cons_power"),
    ("Xây dựng", r"giao thông|\bcầu\b|cầu đường|hạ tầng|công trình|\bbot\b|thủy lợi|thuỷ lợi|cienco|đường bộ|cảng|sông đà|licogi|đèo cả", "cons_infra"),
]
_RULES = [(sub, re.compile(rx, re.I), g) for sub, rx, g in RULES]

MANUAL = {
    # tập đoàn đa ngành – không có mâm tương đồng
    **{s: "conglomerate" for s in ("VIC", "MSN", "GEX", "REE", "PAN", "HDG", "GEL", "HUT", "BCG", "SAM", "DLG", "HHS", "IJC")},
    # bán lẻ / phân phối
    **{s: "retail" for s in ("MWG", "FRT", "PNJ", "DMX")},
    **{s: "distribution" for s in ("DGW", "PET", "PSD", "SVT", "CPH", "TH1", "AGX", "FHN", "AFX", "VXT", "SFN", "PVM", "MTS", "ARM", "AMS")},
    # xăng dầu, khí, lọc dầu
    **{s: "fuel" for s in ("PLX", "OIL", "COM", "PSH", "SFC", "TLP", "PPT", "TMC", "HFC")},
    **{s: "oil_ref" for s in ("BSR",)},
    **{s: "gas" for s in ("GAS", "PGD", "PGC", "PGS", "CNG", "PVG", "ASP", "MTG", "PCG")},
    # hàng không, sân bay, cảng, vận tải biển, logistics
    **{s: "airline" for s in ("VJC", "HVN")},
    **{s: "airport" for s in ("ACV", "SCS", "NCT", "SGN", "NAS", "CIA", "SAS", "AST", "MAS", "NCS")},
    **{s: "port" for s in ("GMD", "PHP", "SGP", "VSC", "DVP", "PDN", "CDN", "QNP", "VGR", "SAC", "CLL", "MVN", "PSP", "PAP", "ILB", "IST", "DXP", "CQN", "CPI", "TCW", "PNP")},
    **{s: "ship" for s in ("HAH", "PVT", "VOS", "VTO", "VIP", "GSP", "PVP", "PTT", "VNA", "SGS", "GTX", "VST", "TRS", "SHC", "DDM", "NOS")},
    **{s: "logistics" for s in ("TMS", "STG", "VIN", "TCL", "TOT", "VNL", "VNF", "VNT", "VLG", "SFI", "VFC", "ASG", "DL1")},
    **{s: "express" for s in ("VTP", "EMS")},
    # viễn thông, công nghệ
    **{s: "telecom" for s in ("FOX", "VGI", "CTR", "TTN", "MFS", "ABC", "FOC", "ELC")},
    **{s: "it" for s in ("FPT", "CMG", "ITD", "HPT", "CMT", "SGT", "VNZ", "ICT", "SBD", "TST", "UNI")},
    # xây dựng
    **{s: "cons_infra" for s in ("CII", "VCG", "HHV", "LCG", "C4G", "FCN", "CTI", "DPG", "TCD", "G36", "BCE", "CC1", "L14", "LIG")},
    **{s: "cons_power" for s in ("PC1", "SCI", "PXS", "VNE", "SD9")},
    **{s: "cons_civil" for s in ("CTD", "HBC", "SC5", "HTN", "BMN", "CSC", "NHA")},
    **{s: "consult" for s in ("TV2", "TV1", "TV3", "TV4")},
    # vật liệu
    **{s: "cement" for s in ("HT1", "BCC", "BTS", "HOM", "QNC", "TXM", "CCM", "YBC", "HVX", "VCX", "PTE", "SCJ", "SDY", "CQT", "CLH")},
    **{s: "mat_stone" for s in ("KSB", "DHA", "VLB", "NNC", "VCS", "CMI", "BTD", "HMR", "MVC", "DND", "FCM", "BHC", "ACE", "BT6", "LBM", "XMC")},
    **{s: "pipe" for s in ("BMP", "NTP", "DAG")},
    **{s: "re_ip" for s in ("KBC", "IDC", "BCM", "SZC", "SIP", "NTC", "D2D", "LHG", "ITA", "TIP", "SZL", "SZB", "SZG", "IDV", "HPI", "VRG", "PXL", "MH3", "VGC", "TID", "SNZ", "DTD")},
    **{s: "re_lease" for s in ("VRE", "VEF", "NVT", "MBT")},
    **{s: "re_svc" for s in ("DXS", "CRE", "DCH")},
    **{s: "re_res" for s in ("VHM", "NVL", "KDH", "NLG", "DXG", "PDR", "DIG", "NTL", "KHG", "CEO", "HDC", "QCG", "TCH", "SJS", "HQC", "SCR", "LDG", "NBB", "KSF", "CRV", "HPX", "AGG", "VPI", "DRH", "TDH", "SGR", "NRC", "TIG", "API", "IDJ", "CKG", "VCR")},
    # năng lượng
    **{s: "thermal" for s in ("POW", "PGV", "NT2", "QTP", "PPC", "HND", "BTP", "NBP", "ND2", "DTK")},
    **{s: "power_other" for s in ("GEG", "BGE", "HIO", "TTE", "PIC", "KHP", "VPD", "TTA", "SEB", "ANI", "VCP")},
    **{s: "oil_svc" for s in ("PVD", "PVS", "PVB", "PVC", "PVE", "PTV", "POS", "PEQ", "TOS", "PSN", "PQN")},
    # hoá chất, phân bón, cao su, nhựa
    **{s: "fert" for s in ("DPM", "DCM", "BFC", "LAS", "DDV", "SFG", "NFC", "VAF", "PMB", "PCE", "PSE", "PSW", "AVG", "DHB")},
    **{s: "chem" for s in ("DGC", "CSV", "PAT", "HVT", "PLC", "APP", "PVO", "HPH", "HMD")},
    **{s: "rubber" for s in ("GVR", "PHR", "DPR", "TRC", "TNC", "DRI", "HRC", "BRR", "RTB", "SBR", "DRG", "BRC")},
    **{s: "plastic" for s in ("AAA", "APH", "NHH", "TPC", "RDP", "SVI", "TDP", "NSG", "VNP", "HII", "PCH")},
    **{s: "steel" for s in ("HPG", "HSG", "NKG", "TLH", "SMC", "POM", "VGS", "TVN", "TIS", "DTL", "HMC")},
    **{s: "mining" for s in ("KSV", "MSR", "BMC", "HGM", "KCB", "ACM")},
    # tiêu dùng
    **{s: "dairy" for s in ("VNM", "MCH", "KDC", "IDP", "HNM", "MCM")},
    **{s: "sugar" for s in ("SBT", "QNS", "LSS", "SLS", "KTS", "CBS")},
    **{s: "seafood" for s in ("VHC", "ANV", "IDI", "FMC", "MPC", "CMX", "ACL", "ASM", "ABT", "AAM", "CCA", "SEA", "CAT", "BLF", "JOS", "SPD")},
    **{s: "livestock" for s in ("DBC", "BAF", "MML", "VLC", "PSL", "MLS", "NSS", "VSN")},
    **{s: "agri" for s in ("HNG", "HAG", "SSC", "NSC", "TAR", "HPA", "NAF", "VNH")},
    **{s: "beer" for s in ("SAB", "BHN", "SMB", "HAD", "THB", "WSB", "SB1", "SBB", "HAT")},
    **{s: "hotel" for s in ("VNG", "DAH", "OCH", "VTR", "VPL", "DSN", "TCT", "VIR", "SGH", "DSD", "PNG", "ATS")},
    **{s: "household" for s in ("RAL", "TLG", "LIX", "NET", "DQC", "SHE", "KSD", "GDT", "BKG")},
    **{s: "garment" for s in ("TCM", "TNG", "MSH", "VGT", "GIL", "STK", "ADS", "HUG", "VGG", "TVT", "M10", "PPH", "MPT", "EVE")},
    **{s: "pharma" for s in ("DHG", "IMP", "TRA", "DMC", "DBD", "PME", "DP3", "OPC", "DHT", "DVN", "AMP", "DCL")},
    **{s: "health" for s in ("JVC", "TNH", "DNM", "AMV", "TTD", "MEF", "YTC")},
    **{s: "auto" for s in ("HAX", "SVC", "TMT", "VEA", "CTF", "DAS", "HTL", "GMA", "FTI", "VMA")},
    **{s: "tyre" for s in ("DRC", "CSM", "SRC")},
    **{s: "elec_equip" for s in ("CAV", "GEE", "TYA", "PAC")},
    # tài chính
    **{s: "consfin" for s in ("F88", "EVF", "TIN")},
    **{s: "ins_life" for s in ("BVH",)},
    **{s: "media" for s in ("YEG", "ODE", "VNB")},
    **{s: "mat_finish" for s in ("TTC",)}, **{s: "re_res" for s in ("UIC",)}, **{s: "garment" for s in ("SFN",)},
    **{s: "plastic" for s in ("SBV",)}, **{s: "machinery" for s in ("AMS",)}, **{s: "oil_svc" for s in ("PVM",)},
}


def assign(sym: str, sub: str | None, name: str | None, user: dict | None = None) -> tuple[str, str]:
    """(khoá nhóm, nguồn gán: user | manual | rule | sub | icb)."""
    if user and user.get(sym) in GROUPS:
        return user[sym], "user"
    if sym in MANUAL:
        return MANUAL[sym], "manual"
    nm = str(name or "")
    for s_, rx, g in _RULES:
        if (s_ is None or s_ == sub) and rx.search(nm):
            return g, "rule"
    if sub in SUB:
        return SUB[sub], "sub"
    return "", "icb"


def assign_all(u: pd.DataFrame, user: dict | None = None) -> pd.DataFrame:
    """Thêm cột peer (khoá nhóm), peer_src. Mã không gán được → 'icb:<ngành cấp 3>'."""
    keys, srcs = [], []
    for s, r in u.iterrows():
        g, src = assign(str(s), r.get("subindustry"), r.get("name"), user)
        if not g:
            g = f"icb:{r.get('industry')}"
        keys.append(g)
        srcs.append(src)
    u = u.copy()
    u["peer"], u["peer_src"] = keys, srcs
    return u


def label(key: str) -> str:
    if key == "_mkt":
        return "toàn thị trường"
    if key.startswith("icb:"):
        return key[4:]
    return GROUPS.get(key, key)


def _trim_median(x: pd.Series) -> float | None:
    x = x.dropna()
    if x.empty:
        return None
    m = float(x.median())
    if m > 0:
        y = x[(x >= m / 3) & (x <= m * 3)]
        if len(y) >= 3:
            m = float(y.median())
    return m


def benchmark(u: pd.DataFrame, metrics: list[str], ref: pd.Series, min_n: int = 3) -> pd.DataFrame:
    """Trung vị mâm cho từng mã + mâm thực sự dùng (sau khi nới khi mâm quá nhỏ).
    ref: True = mã dùng để tính trung vị (có thanh khoản, có BCTC). Tập đoàn đa ngành: không có trung vị (None)."""
    u = u.assign(_all=True)
    refm = ref.reindex(u.index).fillna(False).astype(bool) & ~u["peer"].isin(NO_MEDIAN)
    cnt = u[refm].groupby("peer").size()
    cnt_icb = u[refm].groupby("industry").size()
    used = {}
    for s, g in u["peer"].items():
        if g in NO_MEDIAN:
            used[s] = None
            continue
        if g in MKT_MEDIAN:
            used[s] = "_mkt"
            continue
        c, k = g, 0
        need = lambda c_: MIN_N.get(c_, min_n)  # noqa: E731
        while c and cnt.get(c, 0) < need(c) and k < 4:
            c, k = FALLBACK.get(c), k + 1
        if c and cnt.get(c, 0) >= need(c):
            used[s] = c
        else:
            ind = u.at[s, "industry"]
            used[s] = f"icb:{ind}" if cnt_icb.get(ind, 0) >= 3 else (g if cnt.get(g, 0) >= 1 else None)
    out = pd.DataFrame(index=u.index)
    out["peer_used"] = pd.Series(used)
    key_of = lambda s_: ("_all", True) if s_ == "_mkt" else ("industry", s_[4:]) if s_.startswith("icb:") else ("peer", s_)  # noqa: E731
    cache: dict = {}
    K = 4.0     # co về mặt bằng ngành ICB: mâm n mã có trọng số n/(n+4) – mâm nhỏ không kéo P/E quá xa vì 1–2 mã cá biệt

    def med_of(m, x, col, val):
        ck = (m, col, val)
        if ck not in cache:
            mem = refm & (u[col] == val) & x.notna()
            xx = x[mem]
            cache[ck] = ((_trim_median(xx) if m in ("pe", "pb") else (float(xx.median()) if len(xx) else None)), int(len(xx)))
        return cache[ck]

    for m in metrics:
        if m not in u:
            continue
        x = pd.to_numeric(u[m], errors="coerce")
        if m in ("pe", "pb"):
            x = x.where(x > 0)
        vals = []
        for s in u.index:
            gk = out.at[s, "peer_used"]
            if not isinstance(gk, str) or not gk:
                vals.append(np.nan)
                continue
            col, val = key_of(gk)
            mg, ng = med_of(m, x, col, val)
            if mg is not None and col == "peer":
                # co về nhóm gần nhất (FALLBACK) nếu có, không thì về trung vị toàn thị trường (KHÔNG về ngành ICB – chính là cái đang sai)
                fb = FALLBACK.get(val)
                mp, npp = med_of(m, x, "peer", fb) if fb else (None, 0)
                if mp is None or npp < 3:
                    mp, npp = med_of(m, x, "_all", True)
                if mp is not None and npp >= 3:
                    mg = (ng * mg + K * mp) / (ng + K)
            vals.append(mg if mg is not None else np.nan)
        out[f"{m}_ind_med"] = vals
    n_ = {}
    for s in u.index:
        gk = out.at[s, "peer_used"]
        if not isinstance(gk, str) or not gk:
            n_[s] = 0
            continue
        col, val = key_of(gk)
        n_[s] = int((refm & (u[col] == val)).sum())
    out["peers_n"] = pd.Series(n_)
    out["peer_used_label"] = out["peer_used"].map(lambda k: label(k) if isinstance(k, str) and k else None)
    return out


def members(u: pd.DataFrame, s: str) -> pd.DataFrame:
    """Các mã cùng mâm (theo mâm thực sự dùng để so) – cho bảng "Cùng ngành"."""
    gk = u.at[s, "peer_used"] if "peer_used" in u else None
    if isinstance(gk, str) and gk and gk != "_mkt":
        col, val = ("industry", gk[4:]) if gk.startswith("icb:") else ("peer", gk)
        # mâm đã nới (fallback): hiện cả mã cùng nhóm gốc lẫn nhóm được nới tới
        m = (u[col] == val) | (u["peer"] == u.at[s, "peer"])
    else:
        m = u["peer"] == u.at[s, "peer"]
    return u[m]
