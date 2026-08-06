'use strict';

/**
 * Phase 3-F1A — F1-251 目录覆盖的轻量服务端字典。
 *
 * 数据由冻结 i18n.js 的 api.* EN/ID 赋值机械提取；不执行浏览器脚本，
 * 不包含 16 个日志/内部保护 key，也不覆盖目录外自定义异常、飞书通知或订单预测展示族。
 */

const LANGUAGE_COOKIE_NAME = 'psi_lang';
const RESPONSE_TEXT_FIELDS = new Set([
  'error', 'errors', 'reason', 'warning', 'warnings', 'message', 'messages',
  'note', 'notes', 'instruction', 'instructions', 'rmb_note', 'error_report'
]);

// Phase 3-F1A-CLOSEOUT-R3: settlement log reason 保护
// settlement_logs 对象（具有 payment_request_id + event_type）的 reason 字段
// 可能包含用户录入或数据库保存的业务文本。为防止用户文本恰好等于词典中文时被误翻译，
// 该类对象的 reason 字段一律保持原文。
// 系统生成的 settlement 展示文案（如"历史付款基线""付款确认"等）作为已知未翻译展示债务，
// 纳入独立 settlement-display-i18n 任务处理，不在本checkpoint中扩大翻译范围。
function isSettlementLogObject(obj) {
  return obj != null
    && Object.prototype.hasOwnProperty.call(obj, 'payment_request_id')
    && Object.prototype.hasOwnProperty.call(obj, 'event_type');
}

const API_CATALOG = Object.freeze({
  "api.059": Object.freeze({ zh: "下单日期格式无法识别：{0}", en: "Order date format unrecognized: {0}", id: "Format tanggal pesanan tidak dikenali: {0}" }),
  "api.169": Object.freeze({ zh: "没有该操作的权限", en: "No permission for this operation", id: "Tidak ada izin untuk operasi ini" }),
  "api.072": Object.freeze({ zh: "付款主体代码(entity_key)不能为空", en: "Payer entity code (entity_key) is required", id: "Kode entitas pembayar (entity_key) wajib diisi" }),
  "api.170": Object.freeze({ zh: "法人名称(entity_name)不能为空", en: "Legal entity name (entity_name) is required", id: "Nama badan hukum (entity_name) wajib diisi" }),
  "api.050": Object.freeze({ zh: "SKU编码不能为空", en: "SKU code is required", id: "Kode SKU wajib diisi" }),
  "api.165": Object.freeze({ zh: "来源系统不能为空", en: "Source system is required", id: "Sistem sumber wajib diisi" }),
  "api.185": Object.freeze({ zh: "订单号不能为空", en: "Order no. is required", id: "No. pesanan wajib diisi" }),
  "api.042": Object.freeze({ zh: "SKU不能为空", en: "SKU is required", id: "SKU wajib diisi" }),
  "api.221": Object.freeze({ zh: "调整原因不能为空", en: "Adjustment reason is required", id: "Alasan penyesuaian wajib diisi" }),
  "api.089": Object.freeze({ zh: "删除原因不能为空", en: "Deletion reason is required", id: "Alasan penghapusan wajib diisi" }),
  "api.238": Object.freeze({ zh: "附件不存在", en: "Attachment not found", id: "Lampiran tidak ditemukan" }),
  "api.108": Object.freeze({ zh: "实际入库数量必须为正整数（大于0）", en: "Actual inbound quantity must be a positive integer (greater than 0)", id: "Kuantitas masuk aktual harus bilangan bulat positif (lebih besar dari 0)" }),
  "api.231": Object.freeze({ zh: "跨站请求被拒绝（CSRF 防护）", en: "Cross-site request rejected (CSRF protection)", id: "Permintaan lintas situs ditolak (perlindungan CSRF)" }),
  "api.159": Object.freeze({ zh: "未登录", en: "Not signed in", id: "Belum masuk" }),
  "api.076": Object.freeze({ zh: "会话无效或已过期", en: "Session invalid or expired", id: "Sesi tidak valid atau kedaluwarsa" }),
  "api.225": Object.freeze({ zh: "账号不存在", en: "Account does not exist", id: "Akun tidak ada" }),
  "api.226": Object.freeze({ zh: "账号已停用", en: "Account disabled", id: "Akun dinonaktifkan" }),
  "api.227": Object.freeze({ zh: "账号待管理员授权", en: "Account pending admin authorization", id: "Akun menunggu otorisasi admin" }),
  "api.181": Object.freeze({ zh: "缺少 state", en: "Missing state", id: "Kurang state" }),
  "api.055": Object.freeze({ zh: "state 无效或已过期", en: "state is invalid or expired", id: "state tidak valid atau kedaluwarsa" }),
  "api.248": Object.freeze({ zh: "飞书身份校验失败", en: "Feishu identity verification failed", id: "Verifikasi identitas Feishu gagal" }),
  "api.245": Object.freeze({ zh: "飞书未返回有效用户标识", en: "Feishu did not return a valid user identifier", id: "Feishu tidak mengembalikan identitas pengguna yang valid" }),
  "api.247": Object.freeze({ zh: "飞书登录失败", en: "Feishu sign-in failed", id: "Masuk Feishu gagal" }),
  "api.218": Object.freeze({ zh: "请求过于频繁，请稍后再试", en: "Too many requests, please try again later", id: "Terlalu banyak permintaan, silakan coba lagi nanti" }),
  "api.228": Object.freeze({ zh: "账号或密码错误", en: "Incorrect account or password", id: "Akun atau kata sandi salah" }),
  "api.162": Object.freeze({ zh: "本地账号未初始化", en: "Local account not initialized", id: "Akun lokal belum diinisialisasi" }),
  "api.229": Object.freeze({ zh: "账号未启用", en: "Account not enabled", id: "Akun belum diaktifkan" }),
  "api.173": Object.freeze({ zh: "用户名和姓名不能为空", en: "Username and name are required", id: "Nama pengguna dan nama lengkap wajib diisi" }),
  "api.061": Object.freeze({ zh: "不允许创建本地密码账号", en: "Creating a local password account is not allowed", id: "Membuat akun kata sandi lokal tidak diizinkan" }),
  "api.174": Object.freeze({ zh: "用户名已存在", en: "Username already exists", id: "Nama pengguna sudah ada" }),
  "api.172": Object.freeze({ zh: "用户不存在", en: "User does not exist", id: "Pengguna tidak ada" }),
  "api.062": Object.freeze({ zh: "不允许设置为本地账号", en: "Setting as a local account is not allowed", id: "Menetapkan sebagai akun lokal tidak diizinkan" }),
  "api.060": Object.freeze({ zh: "不允许修改密码", en: "Password changes are not allowed", id: "Perubahan kata sandi tidak diizinkan" }),
  "api.064": Object.freeze({ zh: "不能停用 break-glass 应急账号", en: "The break-glass emergency account cannot be disabled", id: "Akun darurat break-glass tidak dapat dinonaktifkan" }),
  "api.066": Object.freeze({ zh: "不能删除超级管理员", en: "The super admin cannot be deleted", id: "Super admin tidak dapat dihapus" }),
  "api.065": Object.freeze({ zh: "不能删除 break-glass 应急账号", en: "The break-glass emergency account cannot be deleted", id: "Akun darurat break-glass tidak dapat dihapus" }),
  "api.067": Object.freeze({ zh: "不能删除超级管理员角色", en: "The super admin role cannot be deleted", id: "Peran super admin tidak dapat dihapus" }),
  "api.168": Object.freeze({ zh: "没有有效的品牌状态记录", en: "No valid brand status record", id: "Tidak ada catatan status merek yang valid" }),
  "api.057": Object.freeze({ zh: "supplier_id 必填", en: "supplier_id is required", id: "supplier_id wajib diisi" }),
  "api.157": Object.freeze({ zh: "未找到该付款条件", en: "Payment term not found", id: "Termin pembayaran tidak ditemukan" }),
  "api.184": Object.freeze({ zh: "获取实时汇率失败:", en: "Failed to obtain real-time exchange rate: ", id: "Gagal mendapatkan kurs real-time: " }),
  "api.110": Object.freeze({ zh: "审批流名称不能为空", en: "Approval flow name is required", id: "Nama alur persetujuan wajib diisi" }),
  "api.068": Object.freeze({ zh: "业务类型不能为空", en: "Business type is required", id: "Tipe bisnis wajib diisi" }),
  "api.111": Object.freeze({ zh: "审批流至少需要配置一个审批级次", en: "An approval flow requires at least one approval level", id: "Alur persetujuan memerlukan setidaknya satu level persetujuan" }),
  "api.113": Object.freeze({ zh: "审批级次必须为正整数", en: "Approval level must be a positive integer", id: "Level persetujuan harus bilangan bulat positif" }),
  "api.114": Object.freeze({ zh: "审批级次必须连续（从 1 开始，无重复/缺漏）", en: "Approval levels must be consecutive (starting from 1, with no duplicates or gaps)", id: "Level persetujuan harus berurutan (mulai dari 1, tanpa duplikat atau celah)" }),
  "api.179": Object.freeze({ zh: "类目编码(code)不能为空", en: "Category code (code) is required", id: "Kode kategori (code) wajib diisi" }),
  "api.178": Object.freeze({ zh: "类目名称(name)不能为空", en: "Category name (name) is required", id: "Nama kategori (name) wajib diisi" }),
  "api.056": Object.freeze({ zh: "status 只允许 active 或 inactive", en: "status only allows active or inactive", id: "status hanya mengizinkan active atau inactive" }),
  "api.177": Object.freeze({ zh: "类目不存在", en: "Category does not exist", id: "Kategori tidak ada" }),
  "api.215": Object.freeze({ zh: "该类目code已被业务数据引用，不允许修改code（可改名称/排序/状态）", en: "This category code is already referenced by business data; the code cannot be changed (name, sort order, and status may be changed).", id: "Kode kategori ini sudah dirujuk oleh data bisnis; kode tidak dapat diubah (nama, urutan, dan status dapat diubah)." }),
  "api.180": Object.freeze({ zh: "类目编码(code)已存在", en: "Category code (code) already exists", id: "Kode kategori (code) sudah ada" }),
  "api.134": Object.freeze({ zh: "所属大类(category_id)不能为空", en: "Parent category (category_id) is required", id: "Kategori induk (category_id) wajib diisi" }),
  "api.106": Object.freeze({ zh: "子类编码(code)不能为空", en: "Subcategory code (code) is required", id: "Kode subkategori (code) wajib diisi" }),
  "api.105": Object.freeze({ zh: "子类名称(name)不能为空", en: "Subcategory name (name) is required", id: "Nama subkategori (name) wajib diisi" }),
  "api.133": Object.freeze({ zh: "所属大类(category_id)不存在", en: "Parent category (category_id) does not exist", id: "Kategori induk (category_id) tidak ada" }),
  "api.104": Object.freeze({ zh: "子类不存在", en: "Subcategory does not exist", id: "Subkategori tidak ada" }),
  "api.214": Object.freeze({ zh: "该子类code已被业务数据引用，不允许修改code（可改名称/排序/状态/映射）", en: "This subcategory code is already referenced by business data; the code cannot be changed (name, sort order, status, and mapping may be changed).", id: "Kode subkategori ini sudah dirujuk oleh data bisnis; kode tidak dapat diubah (nama, urutan, status, dan pemetaan dapat diubah)." }),
  "api.100": Object.freeze({ zh: "同一大类下子类编码(code)已存在", en: "Subcategory code (code) already exists under the same parent category", id: "Kode subkategori (code) sudah ada di bawah kategori induk yang sama" }),
  "api.144": Object.freeze({ zh: "新增操作不应携带 id，更新请使用 PUT /api/payer-entities/:id", en: "A create operation should not carry an id; use PUT /api/payer-entities/:id to update", id: "Operasi pembuatan tidak boleh membawa id; gunakan PUT /api/payer-entities/:id untuk memperbarui" }),
  "api.131": Object.freeze({ zh: "所属国家(country_id)不能为空", en: "Country (country_id) is required", id: "Negara (country_id) wajib diisi" }),
  "api.132": Object.freeze({ zh: "所属国家不存在（country_id 无效）", en: "Country does not exist (country_id invalid)", id: "Negara tidak ada (country_id tidak valid)" }),
  "api.250": Object.freeze({ zh: "默认币种(default_currency)不存在", en: "Default currency (default_currency) does not exist", id: "Mata uang default (default_currency) tidak ada" }),
  "api.251": Object.freeze({ zh: "默认币种(default_currency)已停用，不可选为默认币种", en: "Default currency (default_currency) is disabled and cannot be selected as the default currency", id: "Mata uang default (default_currency) dinonaktifkan dan tidak dapat dipilih sebagai mata uang default" }),
  "api.079": Object.freeze({ zh: "停用(inactive)的主体不能设为默认(is_default=1)", en: "A disabled (inactive) entity cannot be set as default (is_default=1)", id: "Entitas yang dinonaktifkan (inactive) tidak dapat ditetapkan sebagai default (is_default=1)" }),
  "api.213": Object.freeze({ zh: "该国家已存在一个启用中的默认付款主体，请先取消原默认主体再设置", en: "This country already has an enabled default payer entity; please unset the existing default entity before setting a new one", id: "Negara ini sudah memiliki entitas pembayar default yang aktif; silakan batalkan entitas default yang ada sebelum menetapkan yang baru" }),
  "api.073": Object.freeze({ zh: "付款主体代码(entity_key)已存在", en: "Payer entity code (entity_key) already exists", id: "Kode entitas pembayar (entity_key) sudah ada" }),
  "api.130": Object.freeze({ zh: "所属国家(country_id)不存在", en: "Country (country_id) does not exist", id: "Negara (country_id) tidak ada" }),
  "api.071": Object.freeze({ zh: "付款主体不存在", en: "Payer entity does not exist", id: "Entitas pembayar tidak ada" }),
  "api.211": Object.freeze({ zh: "该付款主体代码(entity_key)已被业务数据引用，不允许修改", en: "This payer entity code (entity_key) is already referenced by business data and cannot be modified", id: "Kode entitas pembayar (entity_key) ini sudah dirujuk oleh data bisnis dan tidak dapat diubah" }),
  "api.210": Object.freeze({ zh: "该付款主体为当前启用中的默认主体，不能直接停用。请先取消其默认设置或改设其他默认主体后再停用。", en: "This payer entity is the currently enabled default entity and cannot be disabled directly. Please unset its default setting or set another default entity first, then disable it.", id: "Entitas pembayar ini adalah entitas default yang sedang aktif dan tidak dapat dinonaktifkan langsung. Silakan batalkan setelan default-nya atau tetapkan entitas default lain terlebih dahulu, lalu nonaktifkan." }),
  "api.137": Object.freeze({ zh: "所属小类(subcategory_id)不能为空", en: "Subcategory (subcategory_id) is required", id: "Subkategori (subcategory_id) wajib diisi" }),
  "api.054": Object.freeze({ zh: "source_type 不能为空", en: "source_type is required", id: "source_type wajib diisi" }),
  "api.017": Object.freeze({ zh: "fee_type 不能为空", en: "fee_type is required", id: "fee_type wajib diisi" }),
  "api.163": Object.freeze({ zh: "来源映射不存在", en: "Source mapping does not exist", id: "Pemetaan sumber tidak ada" }),
  "api.164": Object.freeze({ zh: "来源映射的所属小类、来源类型和费用事件不能直接修改。请停用旧映射后新增正确映射。", en: "The subcategory, source type, and fee event of a source mapping cannot be modified directly. Please disable the old mapping and create a correct one.", id: "Subkategori, tipe sumber, dan event biaya dari pemetaan sumber tidak dapat diubah langsung. Silakan nonaktifkan pemetaan lama dan buat pemetaan yang benar." }),
  "api.135": Object.freeze({ zh: "所属小类(subcategory_id)不存在", en: "Subcategory (subcategory_id) does not exist", id: "Subkategori (subcategory_id) tidak ada" }),
  "api.129": Object.freeze({ zh: "所属一级类目不存在", en: "Parent (level-1) category does not exist", id: "Kategori induk (level-1) tidak ada" }),
  "api.136": Object.freeze({ zh: "所属小类(subcategory_id)不存在或外键校验失败", en: "Subcategory (subcategory_id) does not exist or foreign-key validation failed", id: "Subkategori (subcategory_id) tidak ada atau validasi foreign key gagal" }),
  "api.040": Object.freeze({ zh: "SKU不存在", en: "SKU does not exist", id: "SKU tidak ada" }),
  "api.052": Object.freeze({ zh: "SKU编码已存在", en: "SKU code already exists", id: "Kode SKU sudah ada" }),
  "api.233": Object.freeze({ zh: "采购单价必须为不小于0的数字", en: "Purchase unit price must be a number not less than 0", id: "Harga satuan pembelian harus angka tidak kurang dari 0" }),
  "api.096": Object.freeze({ zh: "参考关税税率必须为不小于0的数字", en: "Reference tariff rate must be a number not less than 0", id: "Tarif bea referensi harus angka tidak kurang dari 0" }),
  "api.051": Object.freeze({ zh: "SKU编码为空", en: "SKU code is empty", id: "Kode SKU kosong" }),
  "api.101": Object.freeze({ zh: "品牌为空", en: "Brand is empty", id: "Merek kosong" }),
  "api.160": Object.freeze({ zh: "未选择SKU", en: "No SKU selected", id: "Tidak ada SKU dipilih" }),
  "api.148": Object.freeze({ zh: "无更新字段", en: "No fields to update", id: "Tidak ada kolom untuk diperbarui" }),
  "api.149": Object.freeze({ zh: "无有效更新字段", en: "No valid fields to update", id: "Tidak ada kolom valid untuk diperbarui" }),
  "api.047": Object.freeze({ zh: "SKU或导入日期为空", en: "SKU or import date is empty", id: "SKU atau tanggal impor kosong" }),
  "api.099": Object.freeze({ zh: "可用数量必须为非负整数", en: "Available quantity must be a non-negative integer", id: "Kuantitas tersedia harus bilangan bulat non-negatif" }),
  "api.154": Object.freeze({ zh: "未找到最新已确认加权平均成本，已保留原成本，请完成成本确认。", en: "Latest confirmed weighted average cost not found; original cost retained. Please complete cost confirmation.", id: "Biaya rata-rata tertimbang terkonfirmasi terbaru tidak ditemukan; biaya asli dipertahankan. Silakan selesaikan konfirmasi biaya." }),
  "api.156": Object.freeze({ zh: "未找到已确认加权平均成本，成本与金额暂为 0，请尽快完成成本确认。", en: "Confirmed weighted average cost not found; cost and amount are temporarily 0. Please complete cost confirmation as soon as possible.", id: "Biaya rata-rata tertimbang terkonfirmasi tidak ditemukan; biaya dan jumlah sementara 0. Silakan selesaikan konfirmasi biaya secepatnya." }),
  "api.045": Object.freeze({ zh: "SKU和出库日期不能为空", en: "SKU and outbound date are required", id: "SKU dan tanggal barang keluar wajib diisi" }),
  "api.046": Object.freeze({ zh: "SKU或出库日期为空", en: "SKU or outbound date is empty", id: "SKU atau tanggal barang keluar kosong" }),
  "api.048": Object.freeze({ zh: "SKU或日期为空", en: "SKU or date is empty", id: "SKU atau tanggal kosong" }),
  "api.235": Object.freeze({ zh: "重复记录（唯一约束）", en: "Duplicate record (unique constraint)", id: "Catatan duplikat (constraint unik)" }),
  "api.036": Object.freeze({ zh: "PO不存在", en: "Purchase Order does not exist", id: "Purchase Order tidak ada" }),
  "api.078": Object.freeze({ zh: "供应商不能为空", en: "Supplier is required", id: "Supplier wajib diisi" }),
  "api.234": Object.freeze({ zh: "采购币种必须为 RMB 或 USD", en: "Procurement currency must be RMB or USD", id: "Mata uang pengadaan harus RMB atau USD" }),
  "api.037": Object.freeze({ zh: "PO创建失败：存在价格问题", en: "Purchase Order creation failed: pricing issue", id: "Pembuatan Purchase Order gagal: ada masalah harga" }),
  "api.032": Object.freeze({ zh: "PO 创建后币种不可修改，如需更换币种请新建 PO", en: "Currency cannot be changed after PO creation; create a new PO if a different currency is needed", id: "Mata uang tidak dapat diubah setelah pembuatan PO; buat PO baru jika memerlukan mata uang lain" }),
  "api.038": Object.freeze({ zh: "PO币种缺失", en: "PO currency missing", id: "Mata uang PO hilang" }),
  "api.039": Object.freeze({ zh: "PO更新失败：存在价格问题", en: "Purchase Order update failed: pricing issue", id: "Pembaruan Purchase Order gagal: ada masalah harga" }),
  "api.197": Object.freeze({ zh: "该 PO 当前状态不允许硬删除；请先作废，或先作废其关联的活跃 PI", en: "The current PO status does not allow hard deletion; please void it first, or void its associated active Proforma Invoice first", id: "Status PO saat ini tidak mengizinkan penghapusan permanen; silakan batalkan terlebih dahulu, atau batalkan Proforma Invoice aktif yang terkait terlebih dahulu" }),
  "api.077": Object.freeze({ zh: "作废原因不能为空", en: "Void reason is required", id: "Alasan pembatalan wajib diisi" }),
  "api.196": Object.freeze({ zh: "该 PO 已作废，不能重复作废", en: "This Purchase Order is already voided and cannot be voided again", id: "Purchase Order ini sudah dibatalkan dan tidak dapat dibatalkan lagi" }),
  "api.097": Object.freeze({ zh: "只有草稿状态才能提交审批", en: "Only draft status can be submitted for approval", id: "Hanya status draf yang dapat diajukan untuk persetujuan" }),
  "api.112": Object.freeze({ zh: "审批流配置无效，无法提交：", en: "Approval flow configuration is invalid; cannot submit: ", id: "Konfigurasi alur persetujuan tidak valid; tidak dapat diajukan: " }),
  "api.033": Object.freeze({ zh: "PO 审批流未配置或未启用，无法提交审批。请先在系统管理（审批流管理）完成 PO 审批流的具体审批人配置。", en: "The PO approval flow is not configured or not enabled, so it cannot be submitted for approval. Please complete the PO approval flow's approver configuration in System Management (Approval Flows) first.", id: "Alur persetujuan PO belum dikonfigurasi atau belum diaktifkan, sehingga tidak dapat diajukan. Silakan selesaikan konfigurasi approver alur persetujuan PO di Manajemen Sistem (Alur Persetujuan) terlebih dahulu." }),
  "api.138": Object.freeze({ zh: "抄送人「", en: "CC recipient “", id: "Penerima CC “" }),
  "api.243": Object.freeze({ zh: "非法的审批动作", en: "Illegal approval action", id: "Tindakan persetujuan tidak sah" }),
  "api.155": Object.freeze({ zh: "未找到审批记录", en: "Approval record not found", id: "Catatan persetujuan tidak ditemukan" }),
  "api.122": Object.freeze({ zh: "当前审批实例不在可审批状态", en: "The current approval instance is not in an approvable state", id: "Instans persetujuan saat ini tidak dalam status yang dapat disetujui" }),
  "api.123": Object.freeze({ zh: "当前审批级次无效", en: "Current approval level is invalid", id: "Level persetujuan saat ini tidak valid" }),
  "api.124": Object.freeze({ zh: "当前级次未配置具体审批人，无法审批", en: "The current level has no specific approver configured and cannot be approved", id: "Level saat ini tidak memiliki approver tertentu yang dikonfigurasi sehingga tidak dapat disetujui" }),
  "api.128": Object.freeze({ zh: "您不是当前审批级次的指定审批人，无权审批", en: "You are not the designated approver for the current level and are not authorized to approve", id: "Anda bukan approver yang ditunjuk untuk level saat ini dan tidak berwenang menyetujui" }),
  "api.021": Object.freeze({ zh: "PI不存在", en: "Proforma Invoice does not exist", id: "Proforma Invoice tidak ada" }),
  "api.087": Object.freeze({ zh: "关联的PO不存在", en: "Associated Purchase Order does not exist", id: "Purchase Order terkait tidak ada" }),
  "api.034": Object.freeze({ zh: "PO 尚未审批通过，不能生成 PI", en: "The PO has not been approved, so a Proforma Invoice cannot be generated", id: "PO belum disetujui, sehingga Proforma Invoice tidak dapat dibuat" }),
  "api.195": Object.freeze({ zh: "该 PI 当前不可编辑（", en: "This Proforma Invoice is not editable at the current status (", id: "Proforma Invoice ini tidak dapat diedit pada status saat ini (" }),
  "api.193": Object.freeze({ zh: "该 PI 已作废，不能重复作废", en: "This Proforma Invoice is already voided and cannot be voided again", id: "Proforma Invoice ini sudah dibatalkan dan tidak dapat dibatalkan lagi" }),
  "api.120": Object.freeze({ zh: "已完结的 PI 不允许作废", en: "A finalized Proforma Invoice cannot be voided", id: "Proforma Invoice yang sudah selesai tidak dapat dibatalkan" }),
  "api.015": Object.freeze({ zh: "CI不存在", en: "Commercial Invoice does not exist", id: "Commercial Invoice tidak ada" }),
  "api.014": Object.freeze({ zh: "CI 必须关联 PI，不能直接创建", en: "A Commercial Invoice must be linked to a Proforma Invoice and cannot be created directly", id: "Commercial Invoice harus terkait dengan Proforma Invoice dan tidak dapat dibuat langsung" }),
  "api.085": Object.freeze({ zh: "关联的PI不存在", en: "Associated Proforma Invoice does not exist", id: "Proforma Invoice terkait tidak ada" }),
  "api.019": Object.freeze({ zh: "PI 定金尚未付清，不能生成 CI", en: "The Proforma Invoice deposit has not been fully paid, so a Commercial Invoice cannot be generated", id: "Uang muka Proforma Invoice belum lunas, sehingga Commercial Invoice tidak dapat dibuat" }),
  "api.189": Object.freeze({ zh: "该 CI 已作废，不能重复作废", en: "This Commercial Invoice is already voided and cannot be voided again", id: "Commercial Invoice ini sudah dibatalkan dan tidak dapat dibatalkan lagi" }),
  "api.119": Object.freeze({ zh: "已发货/入库的 CI 不允许作废", en: "A Commercial Invoice that has been shipped/received cannot be voided", id: "Commercial Invoice yang sudah dikirim/diterima tidak dapat dibatalkan" }),
  "api.022": Object.freeze({ zh: "PL 必须关联 CI，不能直接创建", en: "A PL must be linked to a Commercial Invoice and cannot be created directly", id: "PL harus terkait dengan Commercial Invoice dan tidak dapat dibuat langsung" }),
  "api.084": Object.freeze({ zh: "关联的CI不存在", en: "Associated Commercial Invoice does not exist", id: "Commercial Invoice terkait tidak ada" }),
  "api.187": Object.freeze({ zh: "该 CI 已作废，不能创建 PL", en: "This Commercial Invoice is voided and a PL cannot be created", id: "Commercial Invoice ini dibatalkan dan PL tidak dapat dibuat" }),
  "api.152": Object.freeze({ zh: "无法匹配PO：PO编号为空", en: "Cannot match PO: PO no. is empty", id: "Tidak dapat mencocokkan PO: No. PO kosong" }),
  "api.151": Object.freeze({ zh: "无法匹配PO：", en: "Cannot match PO: ", id: "Tidak dapat mencocokkan PO: " }),
  "api.035": Object.freeze({ zh: "PO 尚未审批通过，不能生成 PI：", en: "The PO has not been approved, so a Proforma Invoice cannot be generated: ", id: "PO belum disetujui, sehingga Proforma Invoice tidak dapat dibuat: " }),
  "api.041": Object.freeze({ zh: "SKU不存在：", en: "SKU does not exist: ", id: "SKU tidak ada: " }),
  "api.086": Object.freeze({ zh: "关联的PI不存在：", en: "Associated Proforma Invoice does not exist: ", id: "Proforma Invoice terkait tidak ada: " }),
  "api.020": Object.freeze({ zh: "PI 定金尚未付清，不能生成 CI：", en: "The Proforma Invoice deposit has not been fully paid, so a Commercial Invoice cannot be generated: ", id: "Uang muka Proforma Invoice belum lunas, sehingga Commercial Invoice tidak dapat dibuat: " }),
  "api.153": Object.freeze({ zh: "无法匹配PO：PO编号为空或PI未关联PO", en: "Cannot match PO: PO no. is empty or the PI is not linked to a PO", id: "Tidak dapat mencocokkan PO: No. PO kosong atau PI tidak terkait dengan PO" }),
  "api.109": Object.freeze({ zh: "实际关税税率必须为不小于0的数字：", en: "Actual tariff rate must be a number not less than 0: ", id: "Tarif bea aktual harus angka tidak kurang dari 0: " }),
  "api.205": Object.freeze({ zh: "该CI费用已确认，不能继续追加或修改CI明细：", en: "This CI's costs are confirmed; CI details cannot be further appended or modified: ", id: "Biaya CI ini sudah dikonfirmasi; detail CI tidak dapat ditambah atau diubah lagi: " }),
  "api.150": Object.freeze({ zh: "无法匹配CI：", en: "Cannot match CI: ", id: "Tidak dapat mencocokkan CI: " }),
  "api.188": Object.freeze({ zh: "该 CI 已作废，不能创建 PL：", en: "This Commercial Invoice is voided and a PL cannot be created: ", id: "Commercial Invoice ini dibatalkan dan PL tidak dapat dibuat: " }),
  "api.171": Object.freeze({ zh: "物流批次不存在", en: "Logistics batch does not exist", id: "Batch logistik tidak ada" }),
  "api.023": Object.freeze({ zh: "PL不存在", en: "PL does not exist", id: "PL tidak ada" }),
  "api.044": Object.freeze({ zh: "SKU和入库日期不能为空", en: "SKU and inbound date are required", id: "SKU dan tanggal masuk wajib diisi" }),
  "api.125": Object.freeze({ zh: "必须关联 PL 明细（source_pl_item_id 必填）", en: "A PL line must be linked (source_pl_item_id is required)", id: "Harus terkait dengan baris PL (source_pl_item_id wajib diisi)" }),
  "api.027": Object.freeze({ zh: "PL明细不存在（source_pl_item_id 无效）", en: "PL line does not exist (source_pl_item_id invalid)", id: "Baris PL tidak ada (source_pl_item_id tidak valid)" }),
  "api.029": Object.freeze({ zh: "PL明细缺少所属 PL（pl_id 为空）", en: "PL line is missing its parent PL (pl_id is empty)", id: "Baris PL kehilangan PL induknya (pl_id kosong)" }),
  "api.053": Object.freeze({ zh: "source_pl_id 与 PL明细所属 PL 不一致", en: "source_pl_id does not match the PL that the PL line belongs to", id: "source_pl_id tidak cocok dengan PL yang menjadi induk baris PL" }),
  "api.024": Object.freeze({ zh: "PL不存在（source_pl_id 无效）", en: "PL does not exist (source_pl_id invalid)", id: "PL tidak ada (source_pl_id tidak valid)" }),
  "api.043": Object.freeze({ zh: "SKU与PL明细不一致", en: "SKU does not match the PL line", id: "SKU tidak cocok dengan baris PL" }),
  "api.031": Object.freeze({ zh: "PL未关联CI（related_ci_id 为空），无法入库", en: "The PL is not linked to a CI (related_ci_id is empty) and cannot be received", id: "PL tidak terkait dengan CI (related_ci_id kosong) dan tidak dapat diterima" }),
  "api.082": Object.freeze({ zh: "关联CI不存在", en: "Associated Commercial Invoice does not exist", id: "Commercial Invoice terkait tidak ada" }),
  "api.083": Object.freeze({ zh: "关联CI已作废（cancelled），不可入库", en: "The associated Commercial Invoice is voided (cancelled) and cannot be received", id: "Commercial Invoice terkait dibatalkan (cancelled) dan tidak dapat diterima" }),
  "api.016": Object.freeze({ zh: "CI明细中不存在该SKU", en: "The SKU does not exist in the CI details", id: "SKU tidak ada dalam detail CI" }),
  "api.209": Object.freeze({ zh: "该SKU无可入库余量（PL或CI已收满）", en: "This SKU has no remaining receivable quantity (PL or CI already fully received)", id: "SKU ini tidak memiliki sisa kuantitas yang dapat diterima (PL atau CI sudah diterima penuh)" }),
  "api.167": Object.freeze({ zh: "没有可导入的数据", en: "No data available to import", id: "Tidak ada data untuk diimpor" }),
  "api.090": Object.freeze({ zh: "单次最多导入 2000 条", en: "At most 2000 records per import", id: "Maksimal 2000 catatan per impor" }),
  "api.080": Object.freeze({ zh: "入库日期格式错误（应为 YYYY-MM-DD）", en: "Invalid inbound date format (expected YYYY-MM-DD)", id: "Format tanggal masuk salah (seharusnya YYYY-MM-DD)" }),
  "api.025": Object.freeze({ zh: "PL不存在（source_pl_no 无效）", en: "PL does not exist (source_pl_no invalid)", id: "PL tidak ada (source_pl_no tidak valid)" }),
  "api.028": Object.freeze({ zh: "PL明细不存在（source_pl_no+sku 无匹配）", en: "PL line does not exist (no match for source_pl_no + sku)", id: "Baris PL tidak ada (tidak ada kecocokan untuk source_pl_no + sku)" }),
  "api.026": Object.freeze({ zh: "PL明细不唯一（source_pl_no+sku 命中多条）", en: "PL line is not unique (source_pl_no + sku matches multiple rows)", id: "Baris PL tidak unik (source_pl_no + sku cocok dengan beberapa baris)" }),
  "api.126": Object.freeze({ zh: "必须关联 PL 明细（source_pl_item_id 或 source_pl_no+sku）", en: "A PL line must be linked (source_pl_item_id or source_pl_no + sku)", id: "Harus terkait dengan baris PL (source_pl_item_id atau source_pl_no + sku)" }),
  "api.030": Object.freeze({ zh: "PL未关联CI，无法入库", en: "The PL is not linked to a CI and cannot be received", id: "PL tidak terkait dengan CI dan tidak dapat diterima" }),
  "api.095": Object.freeze({ zh: "历史付款基线（迁移前数据）", en: "Historical payment baseline (pre-migration data)", id: "Basis pembayaran historis (data pra-migrasi)" }),
  "api.092": Object.freeze({ zh: "历史 CI 不存在", en: "Historical Commercial Invoice does not exist", id: "Commercial Invoice historis tidak ada" }),
  "api.093": Object.freeze({ zh: "历史 CI 导入失败", en: "Historical Commercial Invoice import failed", id: "Impor Commercial Invoice historis gagal" }),
  "api.166": Object.freeze({ zh: "没有可导入的历史 CI 数据", en: "No historical CI data available to import", id: "Tidak ada data CI historis untuk diimpor" }),
  "api.091": Object.freeze({ zh: "单次最多导入 2000 条历史 CI", en: "At most 2000 historical CIs per import", id: "Maksimal 2000 CI historis per impor" }),
  "api.094": Object.freeze({ zh: "历史 CI 批量导入失败", en: "Historical CI batch import failed", id: "Impor batch CI historis gagal" }),
  "api.239": Object.freeze({ zh: "附件对象缺失", en: "Attachment object missing", id: "Objek lampiran hilang" }),
  "api.241": Object.freeze({ zh: "附件数据格式非法（须为 data URL）", en: "Invalid attachment data format (must be a data URL)", id: "Format data lampiran tidak valid (harus berupa data URL)" }),
  "api.237": Object.freeze({ zh: "附件 data URL 非法", en: "Invalid attachment data URL", id: "Data URL lampiran tidak valid" }),
  "api.240": Object.freeze({ zh: "附件必须为 base64 编码", en: "Attachment must be base64-encoded", id: "Lampiran harus dikodekan base64" }),
  "api.063": Object.freeze({ zh: "不支持的文件类型：", en: "Unsupported file type: ", id: "Tipe berkas tidak didukung: " }),
  "api.142": Object.freeze({ zh: "文件扩展名与类型不匹配：", en: "File extension does not match type: ", id: "Ekstensi berkas tidak cocok dengan tipe: " }),
  "api.236": Object.freeze({ zh: "附件 base64 解码失败", en: "Attachment base64 decoding failed", id: "Dekode base64 lampiran gagal" }),
  "api.143": Object.freeze({ zh: "文件超过", en: "File exceeds ", id: "Berkas melampaui " }),
  "api.242": Object.freeze({ zh: "附件格式不合法", en: "Invalid attachment format", id: "Format lampiran tidak valid" }),
  "api.069": Object.freeze({ zh: "仅原币为 RMB 的单据计入已知人民币总额；其他币种未提供明确汇率证据时标记为待补，不做跨币种裸加。", en: "Only documents originally denominated in RMB are counted toward the known RMB total; others without clear exchange-rate evidence are marked as to-be-supplemented and are not naively summed across currencies.", id: "Hanya dokumen dalam RMB yang dihitung ke total RMB yang diketahui; dokumen lain tanpa bukti kurs yang jelas ditandai perlu dilengkapi dan tidak dijumlahkan mentah lintas mata uang." }),
  "api.074": Object.freeze({ zh: "付款申请不存在", en: "Payment request does not exist", id: "Permintaan pembayaran tidak ada" }),
  "api.230": Object.freeze({ zh: "货款付款申请不需要补录费用归属国家", en: "A goods payment request does not require a supplementary cost attribution country", id: "Permintaan pembayaran barang tidak memerlukan pelengkapan negara atribusi biaya" }),
  "api.208": Object.freeze({ zh: "该PI不需要定金，无需发起定金付款审批", en: "This Proforma Invoice requires no deposit, so no deposit payment approval is needed", id: "Proforma Invoice ini tidak memerlukan uang muka, sehingga tidak perlu ada persetujuan pembayaran uang muka" }),
  "api.194": Object.freeze({ zh: "该 PI 已存在有效的定金付款申请，不能重复生成", en: "This Proforma Invoice already has a valid deposit payment request and cannot be generated again", id: "Proforma Invoice ini sudah memiliki permintaan pembayaran uang muka yang valid dan tidak dapat dibuat lagi" }),
  "api.140": Object.freeze({ zh: "抵扣金额不能小于0", en: "Deduction amount cannot be less than 0", id: "Jumlah potongan tidak boleh kurang dari 0" }),
  "api.139": Object.freeze({ zh: "抵扣金额不能大于应付金额", en: "Deduction amount cannot exceed the payable amount", id: "Jumlah potongan tidak boleh melebihi jumlah yang harus dibayar" }),
  "api.141": Object.freeze({ zh: "抵扣金额大于0时必须填写抵扣来源类型和说明", en: "When the deduction amount is greater than 0, the deduction source type and note are required", id: "Jika jumlah potongan lebih besar dari 0, tipe sumber potongan dan keterangan wajib diisi" }),
  "api.192": Object.freeze({ zh: "该 CI 已无待付尾款，不能重复生成尾款申请", en: "This Commercial Invoice has no remaining balance payment due, so a balance payment request cannot be generated again", id: "Commercial Invoice ini tidak memiliki sisa pembayaran yang harus dibayar, sehingga permintaan pembayaran sisa tidak dapat dibuat lagi" }),
  "api.190": Object.freeze({ zh: "该 CI 已存在有效的尾款付款申请，不能重复生成", en: "This Commercial Invoice already has a valid balance payment request and cannot be generated again", id: "Commercial Invoice ini sudah memiliki permintaan pembayaran sisa yang valid dan tidak dapat dibuat lagi" }),
  "api.121": Object.freeze({ zh: "应付金额必须大于0", en: "Payable amount must be greater than 0", id: "Jumlah yang harus dibayar harus lebih besar dari 0" }),
  "api.145": Object.freeze({ zh: "无效的到仓费用小类", en: "Invalid delivery-to-warehouse cost subcategory", id: "Subkategori biaya pengiriman ke gudang tidak valid" }),
  "api.204": Object.freeze({ zh: "该CI费用已确认，不能继续新增计入落地成本的到仓费用", en: "This CI's costs are confirmed; delivery-to-warehouse costs counted into landed cost cannot be added further", id: "Biaya CI ini sudah dikonfirmasi; biaya pengiriman ke gudang yang diperhitungkan ke landed cost tidak dapat ditambah lagi" }),
  "api.081": Object.freeze({ zh: "关税付款必须关联CI", en: "An import duty payment must be linked to a CI", id: "Pembayaran bea masuk harus terkait dengan CI" }),
  "api.202": Object.freeze({ zh: "该CI费用已确认，不能继续新增Import Duty", en: "This CI's costs are confirmed; Import Duty cannot be added further", id: "Biaya CI ini sudah dikonfirmasi; Import Duty tidak dapat ditambah lagi" }),
  "api.200": Object.freeze({ zh: "该CI未标记为有关税，无法创建关税付款申请", en: "This CI is not marked as having import duty, so an import duty payment request cannot be created", id: "CI ini belum ditandai memiliki bea masuk, sehingga permintaan pembayaran bea masuk tidak dapat dibuat" }),
  "api.198": Object.freeze({ zh: "该CI已存在Import Duty费用，请勿重复创建", en: "This CI already has Import Duty; please do not create it again", id: "CI ini sudah memiliki Import Duty; jangan buat lagi" }),
  "api.102": Object.freeze({ zh: "商检费用付款必须关联CI", en: "An inspection fee payment must be linked to a CI", id: "Pembayaran biaya pemeriksaan harus terkait dengan CI" }),
  "api.203": Object.freeze({ zh: "该CI费用已确认，不能继续新增商检费用", en: "This CI's costs are confirmed; inspection fees cannot be added further", id: "Biaya CI ini sudah dikonfirmasi; biaya pemeriksaan tidak dapat ditambah lagi" }),
  "api.201": Object.freeze({ zh: "该CI未标记为有商检费用，无法创建商检费用付款申请", en: "This CI is not marked as having an inspection fee, so an inspection fee payment request cannot be created", id: "CI ini belum ditandai memiliki biaya pemeriksaan, sehingga permintaan pembayaran biaya pemeriksaan tidak dapat dibuat" }),
  "api.212": Object.freeze({ zh: "该付款申请已完成审批，不能重复操作", en: "This payment request has been fully approved and cannot be operated on again", id: "Permintaan pembayaran ini sudah selesai disetujui dan tidak dapat dioperasikan lagi" }),
  "api.146": Object.freeze({ zh: "无效的审批操作", en: "Invalid approval operation", id: "Operasi persetujuan tidak valid" }),
  "api.206": Object.freeze({ zh: "该CI费用已确认，费用标记已锁定", en: "This CI's costs are confirmed; the cost flag is locked", id: "Biaya CI ini sudah dikonfirmasi; tanda biaya terkunci" }),
  "api.207": Object.freeze({ zh: "该CI费用已确认，运输计费基础和实际关税税率已锁定", en: "This CI's costs are confirmed; the freight basis and actual tariff rate are locked", id: "Biaya CI ini sudah dikonfirmasi; basis angkut dan tarif bea aktual terkunci" }),
  "api.232": Object.freeze({ zh: "运输计费基础只允许cbm或kg", en: "Freight basis only allows cbm or kg", id: "Basis angkut hanya mengizinkan cbm atau kg" }),
  "api.011": Object.freeze({ zh: "CI Import Duty总金额必须为不小于0的数字", en: "CI Import Duty total must be a number not less than 0", id: "Total Bea Masuk CI harus angka tidak kurang dari 0" }),
  "api.127": Object.freeze({ zh: "必须关联CI", en: "A Commercial Invoice must be linked", id: "Harus terkait dengan Commercial Invoice" }),
  "api.115": Object.freeze({ zh: "导入数据不能为空", en: "Import data cannot be empty", id: "Data impor tidak boleh kosong" }),
  "api.103": Object.freeze({ zh: "如果当前采购单已绑定国家和仓库，模板只需 SKU、原库存数量、备注三列。", en: "If the current purchase order is already bound to a country and warehouse, the template only needs three columns: SKU, original inventory quantity, and remarks.", id: "Jika purchase order saat ini sudah terikat dengan negara dan gudang, templat hanya memerlukan tiga kolom: SKU, jumlah persediaan awal, dan catatan." }),
  "api.217": Object.freeze({ zh: "请先确认该 CI 的到仓费用、关税、商检费用是否已录入完整。未录入的费用将不会计入落地成本。", en: "Please first confirm that the CI's delivery-to-warehouse costs, import duty, and inspection fees are fully entered. Costs not entered will not be counted into landed cost.", id: "Silakan pastikan dulu biaya pengiriman ke gudang, bea masuk, dan biaya pemeriksaan CI sudah diisi lengkap. Biaya yang tidak diisi tidak akan diperhitungkan ke landed cost." }),
  "api.199": Object.freeze({ zh: "该CI已完成费用分摊，请勿重复执行", en: "This CI's cost allocation is already complete; please do not run it again", id: "Alokasi biaya CI ini sudah selesai; jangan jalankan lagi" }),
  "api.216": Object.freeze({ zh: "请先完成费用分摊", en: "Please complete cost allocation first", id: "Silakan selesaikan alokasi biaya terlebih dahulu" }),
  "api.191": Object.freeze({ zh: "该 CI 已完成 WAC 确认，请勿重复确认。如需调整请使用冲销版本（尚未实现）。", en: "This CI's WAC confirmation is already complete; please do not confirm again. To adjust, use a reversal version (not yet implemented).", id: "Konfirmasi WAC CI ini sudah selesai; jangan konfirmasi lagi. Untuk menyesuaikan, gunakan versi pembatalan (belum diimplementasi)." }),
  "api.158": Object.freeze({ zh: "未找到费用分摊记录，请先执行费用分摊", en: "No cost allocation record found; please run cost allocation first", id: "Tidak ada catatan alokasi biaya; silakan jalankan alokasi biaya terlebih dahulu" }),
  "api.058": Object.freeze({ zh: "WAC 确认 SKU 数量不一致，已整体回滚", en: "WAC confirmation SKU count mismatch; the whole operation was rolled back", id: "Jumlah SKU konfirmasi WAC tidak cocok; seluruh operasi dibatalkan (rollback)" }),
  "api.013": Object.freeze({ zh: "CI 尚未确认（wac_confirmed=1），无法安排上架准备", en: "The CI is not yet confirmed (wac_confirmed=1), so listing preparation cannot be arranged", id: "CI belum dikonfirmasi (wac_confirmed=1), sehingga persiapan penyiapan tidak dapat diatur" }),
  "api.223": Object.freeze({ zh: "负责人不能为空", en: "Owner is required", id: "Penanggung jawab wajib diisi" }),
  "api.222": Object.freeze({ zh: "负责人不存在", en: "Owner does not exist", id: "Penanggung jawab tidak ada" }),
  "api.224": Object.freeze({ zh: "负责人已停用", en: "Owner is disabled", id: "Penanggung jawab dinonaktifkan" }),
  "api.012": Object.freeze({ zh: "CI 尚未确认，无法标记上架准备", en: "The CI is not yet confirmed, so listing preparation cannot be marked", id: "CI belum dikonfirmasi, sehingga persiapan penyiapan tidak dapat ditandai" }),
  "api.116": Object.freeze({ zh: "尚未分配负责人，无法标记就绪", en: "No owner assigned, so readiness cannot be marked", id: "Belum ada penanggung jawab, sehingga kesiapan tidak dapat ditandai" }),
  "api.070": Object.freeze({ zh: "仅负责人或管理员可标记上架准备完成", en: "Only the owner or an admin can mark listing preparation complete", id: "Hanya penanggung jawab atau admin yang dapat menandai persiapan penyiapan selesai" }),
  "api.049": Object.freeze({ zh: "SKU或盘点日期为空", en: "SKU or stock-take date is empty", id: "SKU atau tanggal cek stok kosong" }),
  "api.175": Object.freeze({ zh: "盘点记录不存在", en: "Inventory-take record does not exist", id: "Catatan cek stok tidak ada" }),
  "api.098": Object.freeze({ zh: "只能审批待处理记录", en: "Only pending records can be approved", id: "Hanya catatan tertunda yang dapat disetujui" }),
  "api.161": Object.freeze({ zh: "未选择记录", en: "No record selected", id: "Tidak ada catatan dipilih" }),
  "api.147": Object.freeze({ zh: "无效的库存状态", en: "Invalid inventory status", id: "Status persediaan tidak valid" }),
  "api.186": Object.freeze({ zh: "记录不存在", en: "Record does not exist", id: "Catatan tidak ada" }),
  "api.107": Object.freeze({ zh: "安全库存必须为非负整数", en: "Safety stock must be a non-negative integer", id: "Persediaan pengaman harus bilangan bulat non-negatif" }),
  "api.176": Object.freeze({ zh: "目标周转月数必须为非负数", en: "Target turnover months must be a non-negative number", id: "Bulan perputaran target harus angka non-negatif" }),
  "api.118": Object.freeze({ zh: "已作废记录不能重复作废", en: "A voided record cannot be voided again", id: "Catatan yang dibatalkan tidak dapat dibatalkan lagi" }),
  "api.088": Object.freeze({ zh: "出库类型不能为空", en: "Outbound type is required", id: "Tipe barang keluar wajib diisi" }),
  "api.117": Object.freeze({ zh: "已作废记录不能修改", en: "A voided record cannot be modified", id: "Catatan yang dibatalkan tidak dapat diubah" }),
  "api.075": Object.freeze({ zh: "任务不存在", en: "Task does not exist", id: "Tugas tidak ada" }),
  "api.219": Object.freeze({ zh: "调整单不存在", en: "Adjustment order does not exist", id: "Dokumen penyesuaian tidak ada" }),
  "api.220": Object.freeze({ zh: "调整单状态不允许审批", en: "The adjustment order status does not allow approval", id: "Status dokumen penyesuaian tidak mengizinkan persetujuan" })
});

// ==================== Phase 3-F1B: SettlementError & CostAllocationError ====================
// 中文原文保持不变；EN/ID 沿用系统既有术语机械映射，不重新翻译或润色。
// 静态条目通过 EXACT_INDEX 精确匹配；带 {placeholder} 的条目通过 TEMPLATE_MATCHERS 正则匹配。
// api.074(付款申请不存在)、api.011(CI Import Duty总金额...)、api.141(抵扣金额大于0时...) 已由 F1A 覆盖，此处不重复。

const SETTLEMENT_ERROR_CATALOG = Object.freeze({
  // --- 静态精确匹配 (41) ---
  "se.001": Object.freeze({ zh: "实际付款日期必须为 YYYY-MM-DD", en: "Actual payment date must be YYYY-MM-DD", id: "Tanggal pembayaran aktual harus YYYY-MM-DD" }),
  "se.002": Object.freeze({ zh: "实际付款日期无效", en: "Actual payment date is invalid", id: "Tanggal pembayaran aktual tidak valid" }),
  "se.003": Object.freeze({ zh: "付款幂等键不能为空", en: "Payment idempotency key is required", id: "Kunci idempotensi pembayaran wajib diisi" }),
  "se.004": Object.freeze({ zh: "付款幂等键长度不能超过200个字符", en: "Payment idempotency key length cannot exceed 200 characters", id: "Panjang kunci idempotensi pembayaran tidak boleh melebihi 200 karakter" }),
  "se.006": Object.freeze({ zh: "有效付款、抵扣与抹零金额之和不能超过应付总额", en: "The sum of valid payment, deduction and rounding amounts cannot exceed the total payable", id: "Jumlah pembayaran, potongan, dan pembulatan yang valid tidak boleh melebihi total yang harus dibayar" }),
  "se.007": Object.freeze({ zh: "无来源手工非货款必须选择费用归属国家", en: "A manual non-goods payment without a source must specify a cost attribution country", id: "Pembayaran non-barang manual tanpa sumber harus menentukan negara atribusi biaya" }),
  "se.014": Object.freeze({ zh: "该付款幂等键已用于不同的付款申请、金额、付款日期或凭证，不能重复使用", en: "This payment idempotency key has been used for a different payment request, amount, payment date or voucher and cannot be reused", id: "Kunci idempotensi pembayaran ini telah digunakan untuk permintaan pembayaran, jumlah, tanggal pembayaran atau voucher yang berbeda dan tidak dapat digunakan kembali" }),
  "se.015": Object.freeze({ zh: "付款申请尚未审批通过，不能确认付款", en: "The payment request has not been approved and payment cannot be confirmed", id: "Permintaan pembayaran belum disetujui dan pembayaran tidak dapat dikonfirmasi" }),
  "se.016": Object.freeze({ zh: "当前付款申请状态不允许确认付款", en: "The current payment request status does not allow payment confirmation", id: "Status permintaan pembayaran saat ini tidak mengizinkan konfirmasi pembayaran" }),
  "se.017": Object.freeze({ zh: "本次实际付款金额必须大于0", en: "This actual payment amount must be greater than 0", id: "Jumlah pembayaran aktual ini harus lebih besar dari 0" }),
  "se.018": Object.freeze({ zh: "该付款申请已结清，无需重复付款", en: "This payment request is settled and no duplicate payment is needed", id: "Permintaan pembayaran ini sudah lunas dan tidak perlu pembayaran duplikat" }),
  "se.019": Object.freeze({ zh: "本次实际付款金额不能大于当前未付金额", en: "This actual payment amount cannot exceed the current unpaid amount", id: "Jumlah pembayaran aktual ini tidak boleh melebihi jumlah yang belum dibayar saat ini" }),
  "se.020": Object.freeze({ zh: "该付款申请已产生有效付款，不能通过普通编辑修改抵扣；如需调整请先冲销付款", en: "This payment request has generated valid payments and deductions cannot be modified through regular editing; please reverse the payment first if adjustment is needed", id: "Permintaan pembayaran ini telah menghasilkan pembayaran yang valid dan potongan tidak dapat diubah melalui edit reguler; silakan batalkan pembayaran terlebih dahulu jika perlu penyesuaian" }),
  "se.021": Object.freeze({ zh: "该付款申请已有生效抵扣，不能直接覆盖；请先冲销原抵扣", en: "This payment request already has effective deductions and they cannot be overwritten directly; please reverse the original deduction first", id: "Permintaan pembayaran ini sudah memiliki potongan yang berlaku dan tidak dapat ditimpa langsung; silakan batalkan potongan asli terlebih dahulu" }),
  "se.022": Object.freeze({ zh: "该付款申请已结清，不能编辑抵扣", en: "This payment request is settled and deductions cannot be edited", id: "Permintaan pembayaran ini sudah lunas dan potongan tidak dapat diedit" }),
  "se.023": Object.freeze({ zh: "抵扣金额必须大于0", en: "Deduction amount must be greater than 0", id: "Jumlah potongan harus lebih besar dari 0" }),
  "se.024": Object.freeze({ zh: "抵扣金额不能大于当前未付金额", en: "Deduction amount cannot exceed the current unpaid amount", id: "Jumlah potongan tidak boleh melebihi jumlah yang belum dibayar saat ini" }),
  "se.026": Object.freeze({ zh: "付款申请尚未审批通过，不能执行抹零", en: "The payment request has not been approved and rounding cannot be executed", id: "Permintaan pembayaran belum disetujui dan pembulatan tidak dapat dilakukan" }),
  "se.027": Object.freeze({ zh: "该付款申请已有生效抹零，不能直接覆盖；请先撤销原抹零", en: "This payment request already has effective rounding and it cannot be overwritten directly; please revoke the original rounding first", id: "Permintaan pembayaran ini sudah memiliki pembulatan yang berlaku dan tidak dapat ditimpa langsung; silakan batalkan pembulatan asli terlebih dahulu" }),
  "se.028": Object.freeze({ zh: "该付款申请已结清，无需抹零", en: "This payment request is settled and no rounding is needed", id: "Permintaan pembayaran ini sudah lunas dan tidak perlu pembulatan" }),
  "se.029": Object.freeze({ zh: "抹零金额不能小于0", en: "Rounding amount cannot be less than 0", id: "Jumlah pembulatan tidak boleh kurang dari 0" }),
  "se.030": Object.freeze({ zh: "抹零金额必须大于0", en: "Rounding amount must be greater than 0", id: "Jumlah pembulatan harus lebih besar dari 0" }),
  "se.031": Object.freeze({ zh: "抹零金额不能超过当前剩余未结金额", en: "Rounding amount cannot exceed the current remaining unsettled amount", id: "Jumlah pembulatan tidak boleh melebihi sisa jumlah yang belum diselesaikan saat ini" }),
  "se.032": Object.freeze({ zh: "抹零原因或备注不能为空", en: "Rounding reason or note is required", id: "Alasan atau catatan pembulatan wajib diisi" }),
  "se.033": Object.freeze({ zh: "冲销原因不能为空", en: "Reversal reason is required", id: "Alasan pembatalan wajib diisi" }),
  "se.034": Object.freeze({ zh: "必须指定要冲销的结算事件", en: "A settlement event to reverse must be specified", id: "Event penyelesaian yang akan dibatalkan harus ditentukan" }),
  "se.035": Object.freeze({ zh: "结算事件不存在", en: "Settlement event does not exist", id: "Event penyelesaian tidak ada" }),
  "se.036a": Object.freeze({ zh: "该事件不是付款记录，不能作为付款冲销", en: "This event is not a payment record and cannot be reversed as a payment", id: "Event ini bukan catatan pembayaran dan tidak dapat dibatalkan sebagai pembayaran" }),
  "se.036b": Object.freeze({ zh: "该事件不是抵扣记录，不能作为抵扣冲销", en: "This event is not a deduction record and cannot be reversed as a deduction", id: "Event ini bukan catatan potongan dan tidak dapat dibatalkan sebagai potongan" }),
  "se.037": Object.freeze({ zh: "该结算事件已经冲销，不能重复操作", en: "This settlement event has already been reversed and cannot be operated on again", id: "Event penyelesaian ini sudah dibatalkan dan tidak dapat dioperasikan lagi" }),
  "se.040": Object.freeze({ zh: "历史 CI 编号不能为空", en: "Historical CI number is required", id: "Nomor CI historis wajib diisi" }),
  "se.041": Object.freeze({ zh: "历史 CI 的 source_mode 必须为 historical", en: "Historical CI source_mode must be historical", id: "source_mode CI historis harus historical" }),
  "se.043": Object.freeze({ zh: "供应商或供应商快照不能为空", en: "Supplier or supplier snapshot is required", id: "Supplier atau snapshot supplier wajib diisi" }),
  "se.044": Object.freeze({ zh: "品牌或品牌快照不能为空", en: "Brand or brand snapshot is required", id: "Merek atau snapshot merek wajib diisi" }),
  "se.045": Object.freeze({ zh: "采购归属国家不能为空", en: "Procurement attribution country is required", id: "Negara atribusi pengadaan wajib diisi" }),
  "se.047": Object.freeze({ zh: "历史货款总金额必须大于0", en: "Historical goods payment total amount must be greater than 0", id: "Total pembayaran barang historis harus lebih besar dari 0" }),
  "se.048": Object.freeze({ zh: "历史已付款金额不能小于0", en: "Historical paid amount cannot be less than 0", id: "Jumlah yang sudah dibayar historis tidak boleh kurang dari 0" }),
  "se.049": Object.freeze({ zh: "历史已付款金额不能超过历史货款总金额", en: "Historical paid amount cannot exceed the historical goods payment total", id: "Jumlah yang sudah dibayar historis tidak boleh melebihi total pembayaran barang historis" }),
  "se.050": Object.freeze({ zh: "历史 CI 幂等键长度不能超过200个字符", en: "Historical CI idempotency key length cannot exceed 200 characters", id: "Panjang kunci idempotensi CI historis tidak boleh melebihi 200 karakter" }),
  "se.051": Object.freeze({ zh: "该历史 CI 幂等键已用于不同的单据内容，不能重复使用", en: "This historical CI idempotency key has been used for different document content and cannot be reused", id: "Kunci idempotensi CI historis ini telah digunakan untuk konten dokumen yang berbeda dan tidak dapat digunakan kembali" }),
  "se.053": Object.freeze({ zh: "付款申请号为空", en: "Payment request number is empty", id: "Nomor permintaan pembayaran kosong" }),
  // --- 模板匹配 (12) ---
  "se.tmpl.001": Object.freeze({ zh: "费用归属国家“{requested}”不存在或已停用", en: "Cost attribution country \u201c{requested}\u201d does not exist or is disabled", id: "Negara atribusi biaya \u201c{requested}\u201d tidak ada atau dinonaktifkan" }),
  "se.tmpl.002": Object.freeze({ zh: "{sourceLabel}未设置国家，不能创建非货款付款申请", en: "{sourceLabel} has no country set and a non-goods payment request cannot be created", id: "{sourceLabel} tidak memiliki negara yang ditetapkan dan permintaan pembayaran non-barang tidak dapat dibuat" }),
  "se.tmpl.003": Object.freeze({ zh: "付款申请 {request_no} 未设置费用归属国家，请先由财务补录后再付款", en: "Payment request {request_no} has no cost attribution country set; please have finance supplement it before making payment", id: "Permintaan pembayaran {request_no} tidak memiliki negara atribusi biaya; silakan dilengkapi oleh keuangan sebelum pembayaran" }),
  "se.tmpl.004": Object.freeze({ zh: "来源国家“{countryName}”未配置本国货币，不能完成付款折算", en: "Source country \u201c{countryName}\u201d has no local currency configured and payment conversion cannot be completed", id: "Negara sumber \u201c{countryName}\u201d tidak memiliki mata uang lokal yang dikonfigurasi dan konversi pembayaran tidak dapat diselesaikan" }),
  "se.tmpl.005": Object.freeze({ zh: "缺少 {paidDate} {fromCurrency}→{toCurrency} 的 realtime 付款汇率", en: "Missing realtime payment exchange rate for {paidDate} {fromCurrency}\u2192{toCurrency}", id: "Kurs pembayaran real-time tidak ditemukan untuk {paidDate} {fromCurrency}\u2192{toCurrency}" }),
  "se.tmpl.006": Object.freeze({ zh: "付款申请 {request_no} 未配置原币币种", en: "Payment request {request_no} has no original currency configured", id: "Permintaan pembayaran {request_no} tidak memiliki mata uang asli yang dikonfigurasi" }),
  "se.tmpl.007": Object.freeze({ zh: "{label}必须为 YYYY-MM-DD", en: "{label} must be YYYY-MM-DD", id: "{label} harus YYYY-MM-DD" }),
  "se.tmpl.008": Object.freeze({ zh: "{label}无效", en: "{label} is invalid", id: "{label} tidak valid" }),
  "se.tmpl.009": Object.freeze({ zh: "供应商 {supplierId} 不存在", en: "Supplier {supplierId} does not exist", id: "Supplier {supplierId} tidak ada" }),
  "se.tmpl.010": Object.freeze({ zh: "币种 {val} 不存在或已停用", en: "Currency {val} does not exist or is disabled", id: "Mata uang {val} tidak ada atau dinonaktifkan" }),
  "se.tmpl.011": Object.freeze({ zh: "历史 CI“{historical_ci_no}”在该供应商和国家下已存在，不能重复导入", en: "Historical CI \u201c{historical_ci_no}\u201d already exists under this supplier and country and cannot be imported again", id: "CI historis \u201c{historical_ci_no}\u201d sudah ada di bawah supplier dan negara ini dan tidak dapat diimpor lagi" }),
  "se.tmpl.012": Object.freeze({ zh: "付款申请号 {request_no} 不存在", en: "Payment request number {request_no} does not exist", id: "Nomor permintaan pembayaran {request_no} tidak ada" })
});

const COST_ALLOCATION_ERROR_CATALOG = Object.freeze({
  // --- 静态精确匹配 (6) ---
  "ca.001": Object.freeze({ zh: "CI明细为空，无法确认或分摊成本", en: "CI details are empty; cost confirmation or allocation cannot proceed", id: "Detail CI kosong; konfirmasi atau alokasi biaya tidak dapat dilanjutkan" }),
  "ca.002": Object.freeze({ zh: "CI明细存在空SKU，无法分摊成本", en: "CI details contain an empty SKU; cost cannot be allocated", id: "Detail CI mengandung SKU kosong; biaya tidak dapat dialokasikan" }),
  "ca.003": Object.freeze({ zh: "该CI存在运输类费用，请先明确选择本票实际运输计费基础（CBM或KG）", en: "This CI has transport costs; please explicitly select the actual transport billing basis (CBM or KG)", id: "CI ini memiliki biaya transportasi; silakan pilih basis penagihan transportasi aktual (CBM atau KG)" }),
  "ca.005": Object.freeze({ zh: "CI Import Duty大于0，但全部SKU的关税权重合计为0", en: "CI Import Duty is greater than 0, but the total tariff weight of all SKUs is 0", id: "Bea Masuk CI lebih besar dari 0, tetapi total bobot bea semua SKU adalah 0" }),
  "ca.006": Object.freeze({ zh: "CI实际商品金额合计为0，无法分摊成本", en: "CI actual goods amount total is 0; cost cannot be allocated", id: "Total jumlah barang aktual CI adalah 0; biaya tidak dapat dialokasikan" }),
  "ca.007": Object.freeze({ zh: "CI明细不存在或不属于当前CI", en: "CI detail does not exist or does not belong to the current CI", id: "Detail CI tidak ada atau bukan milik CI saat ini" }),
  // --- 模板匹配 (11) ---
  "ca.tmpl.001": Object.freeze({ zh: "SKU {skuCode} 缺少有效的CI实际金额或数量", en: "SKU {skuCode} is missing valid CI actual amount or quantity", id: "SKU {skuCode} kehilangan jumlah atau kuantitas aktual CI yang valid" }),
  "ca.tmpl.002": Object.freeze({ zh: "SKU {skuCode} 的实际关税税率必须为不小于0的数字", en: "SKU {skuCode} actual tariff rate must be a number not less than 0", id: "Tarif bea aktual SKU {skuCode} harus angka tidak kurang dari 0" }),
  "ca.tmpl.003": Object.freeze({ zh: "运输类费用使用{basisUpper}分摊，以下SKU缺少PL实际{basisLabel}：{skuList}", en: "Transport costs are allocated using {basisUpper}; the following SKUs are missing PL actual {basisLabel}: {skuList}", id: "Biaya transportasi dialokasikan menggunakan {basisUpper}; SKU berikut kekurangan {basisLabel} aktual PL: {skuList}" }),
  "ca.tmpl.004": Object.freeze({ zh: "运输类费用使用{basisUpper}分摊，但PL明细basis_total为0", en: "Transport costs are allocated using {basisUpper}, but PL detail basis_total is 0", id: "Biaya transportasi dialokasikan menggunakan {basisUpper}, tetapi basis_total detail PL adalah 0" }),
  "ca.tmpl.005": Object.freeze({ zh: "不支持的运输费用小类：{subcategoryList}", en: "Unsupported transport cost subcategory: {subcategoryList}", id: "Subkategori biaya transportasi tidak didukung: {subcategoryList}" }),
  "ca.tmpl.006": Object.freeze({ zh: "CI Import Duty大于0，以下SKU未填写本票实际关税税率：{skuList}", en: "CI Import Duty is greater than 0; the following SKUs have no actual tariff rate filled in: {skuList}", id: "Bea Masuk CI lebih besar dari 0; SKU berikut belum diisi tarif bea aktual: {skuList}" }),
  "ca.tmpl.007": Object.freeze({ zh: "{label}金额必须为不小于0的数字", en: "{label} amount must be a number not less than 0", id: "Jumlah {label} harus angka tidak kurang dari 0" }),
  "ca.tmpl.008": Object.freeze({ zh: "{label}使用{basis}分摊，但basis_total为0", en: "{label} is allocated using {basis}, but basis_total is 0", id: "{label} dialokasikan menggunakan {basis}, tetapi basis_total adalah 0" }),
  "ca.tmpl.009": Object.freeze({ zh: "{label}分摊产生负金额，已拒绝", en: "{label} allocation produced a negative amount; rejected", id: "Alokasi {label} menghasilkan jumlah negatif; ditolak" }),
  "ca.tmpl.010": Object.freeze({ zh: "{label}分摊未守恒", en: "{label} allocation is not conserved", id: "Alokasi {label} tidak seimbang" }),
  "ca.tmpl.011": Object.freeze({ zh: "费用 {cost_category}/{cost_subcategory} 尚未配置分摊规则", en: "Cost {cost_category}/{cost_subcategory} has no allocation rule configured", id: "Biaya {cost_category}/{cost_subcategory} tidak memiliki aturan alokasi yang dikonfigurasi" })
});

// ==================== I18N-100P-CLOSEOUT-01: 通用动态模板 (B2/B3/B4) ====================
// 审批流校验、抄送人校验、PO提交校验、来源映射、SKU删除、入库、费用归属等动态消息。
// 中文原文保持不变；EN/ID 沿用系统既有术语机械映射。
const GENERAL_TEMPLATE_CATALOG = Object.freeze({
  // --- B2: 审批流配置校验 (6) ---
  "gt.tmpl.001": Object.freeze({ zh: "第 {lvl} 级审批人不能为空", en: "Level {lvl} approver cannot be empty", id: "Penyetuju level {lvl} tidak boleh kosong" }),
  "gt.tmpl.002": Object.freeze({ zh: "第 {lvl} 级审批用户不存在（可能已被删除）", en: "Level {lvl} approval user does not exist (may have been deleted)", id: "Pengguna persetujuan level {lvl} tidak ada (mungkin telah dihapus)" }),
  "gt.tmpl.003": Object.freeze({ zh: "第 {lvl} 级审批用户「{name}」状态非 active，不可选为审批人", en: "Level {lvl} approval user \u300c{name}\u300d status is not active and cannot be selected as approver", id: "Status pengguna persetujuan level {lvl} \u300c{name}\u300d bukan active dan tidak dapat dipilih sebagai penyetuju" }),
  "gt.tmpl.004": Object.freeze({ zh: "第 {lvl} 级审批用户「{name}」未绑定有效角色", en: "Level {lvl} approval user \u300c{name}\u300d has no valid role bound", id: "Pengguna persetujuan level {lvl} \u300c{name}\u300d tidak memiliki peran yang valid" }),
  "gt.tmpl.005": Object.freeze({ zh: "第 {lvl} 级审批用户「{name}」绑定的角色不存在", en: "The role bound to level {lvl} approval user \u300c{name}\u300d does not exist", id: "Peran yang terikat pada pengguna persetujuan level {lvl} \u300c{name}\u300d tidak ada" }),
  "gt.tmpl.006": Object.freeze({ zh: "第 {lvl} 级审批用户「{name}」的角色「{roleName}」不具备 po_approve 权限，不可选为审批人", en: "The role \u300c{roleName}\u300d of level {lvl} approval user \u300c{name}\u300d does not have po_approve permission and cannot be selected as approver", id: "Peran \u300c{roleName}\u300d pengguna persetujuan level {lvl} \u300c{name}\u300d tidak memiliki izin po_approve dan tidak dapat dipilih sebagai penyetuju" }),
  // --- B3: 抄送人校验 (2) ---
  "gt.tmpl.007": Object.freeze({ zh: "抄送人「{uid}」不存在", en: "Cc recipient \u300c{uid}\u300d does not exist", id: "Penerima cc \u300c{uid}\u300d tidak ada" }),
  "gt.tmpl.008": Object.freeze({ zh: "抄送人「{name}」已停用，无法抄送", en: "Cc recipient \u300c{name}\u300d is disabled and cannot be cc'd", id: "Penerima cc \u300c{name}\u300d dinonaktifkan dan tidak dapat di-cc" }),
  // --- B4-1: PO提交审批流校验外层消息 (1) ---
  "gt.tmpl.009": Object.freeze({ zh: "审批流配置无效，无法提交：{msg}。请先在系统管理修正 PO 审批流配置（指定具体审批人）。", en: "Approval flow configuration is invalid and cannot be submitted: {msg}. Please fix the PO approval flow configuration in System Settings (specify concrete approvers).", id: "Konfigurasi alur persetujuan tidak valid dan tidak dapat diajukan: {msg}. Silakan perbaiki konfigurasi alur persetujuan PO di Pengaturan Sistem (tentukan penyetuju konkret)." }),
  // --- B4-2: 来源映射校验 (6) ---
  "gt.tmpl.010": Object.freeze({ zh: "不支持的来源类型：{source_type}", en: "Unsupported source type: {source_type}", id: "Tipe sumber tidak didukung: {source_type}" }),
  "gt.tmpl.011": Object.freeze({ zh: "{sourceLabel}（{source_type}）不支持费用事件{fee_type}", en: "{sourceLabel} ({source_type}) does not support fee event {fee_type}", id: "{sourceLabel} ({source_type}) tidak mendukung event biaya {fee_type}" }),
  "gt.tmpl.012": Object.freeze({ zh: "所属一级类目\u201c{category_name}（{category_code}）\u201d已停用，来源映射只能保存为停用状态。", en: "Parent category \u201c{category_name} ({category_code})\u201d is disabled; the source mapping can only be saved as disabled.", id: "Kategori induk \u201c{category_name} ({category_code})\u201d dinonaktifkan; pemetaan sumber hanya dapat disimpan sebagai dinonaktifkan." }),
  "gt.tmpl.013": Object.freeze({ zh: "所属二级类目\u201c{subcategory_name}（{subcategory_code}）\u201d已停用，来源映射只能保存为停用状态。", en: "Subcategory \u201c{subcategory_name} ({subcategory_code})\u201d is disabled; the source mapping can only be saved as disabled.", id: "Subkategori \u201c{subcategory_name} ({subcategory_code})\u201d dinonaktifkan; pemetaan sumber hanya dapat disimpan sebagai dinonaktifkan." }),
  "gt.tmpl.014": Object.freeze({ zh: "{sourceLabel}（{source_type}）+ {feeLabel}（{fee_type}）已经映射到\u2018{targetName}（{targetCode}）\u2019，不能重复启用。", en: "{sourceLabel} ({source_type}) + {feeLabel} ({fee_type}) is already mapped to \u2018{targetName} ({targetCode})\u2019 and cannot be enabled again.", id: "{sourceLabel} ({source_type}) + {feeLabel} ({fee_type}) sudah dipetakan ke \u2018{targetName} ({targetCode})\u2019 dan tidak dapat diaktifkan lagi." }),
  "gt.tmpl.015": Object.freeze({ zh: "有效来源映射冲突：{sourceLabel}（{source_type}）+ {feeLabel}（{fee_type}）已被其他有效映射占用。", en: "Active source mapping conflict: {sourceLabel} ({source_type}) + {feeLabel} ({fee_type}) is already occupied by another active mapping.", id: "Konflik pemetaan sumber aktif: {sourceLabel} ({source_type}) + {feeLabel} ({fee_type}) sudah diduduki oleh pemetaan aktif lain." }),
  // --- B4-3: SKU/库存删除关联检查 (3) ---
  "gt.tmpl.016": Object.freeze({ zh: "SKU已关联{label}数据（{cnt}条），不允许删除，请改为停用", en: "SKU is associated with {label} data ({cnt} records) and cannot be deleted; please disable it instead", id: "SKU terkait dengan data {label} ({cnt} catatan) dan tidak dapat dihapus; silakan nonaktifkan" }),
  "gt.tmpl.017": Object.freeze({ zh: "已关联{label}数据（{cnt}条），不允许删除", en: "Associated with {label} data ({cnt} records); cannot delete", id: "Terkait dengan data {label} ({cnt} catatan); tidak dapat dihapus" }),
  "gt.tmpl.018": Object.freeze({ zh: "已关联{label}（{cnt}条），不允许删除", en: "Associated with {label} ({cnt} records); cannot delete", id: "Terkait dengan {label} ({cnt} catatan); tidak dapat dihapus" }),
  // --- B4-4: 出库快照截止日期缺失 (1) ---
  "gt.tmpl.019": Object.freeze({ zh: "找不到国家「{country}」仓库「{warehouse}」对应的库存快照截止日期，无法自动判断是否扣减库存。请先在库存总表导入该国家+仓库的库存快照。", en: "Cannot find the inventory snapshot cutoff date for country \u300c{country}\u300d warehouse \u300c{warehouse}\u300d; unable to automatically determine whether to deduct stock. Please import the inventory snapshot for that country+warehouse in the inventory master table first.", id: "Tidak dapat menemukan tanggal batas snapshot inventaris untuk negara \u300c{country}\u300d gudang \u300c{warehouse}\u300d; tidak dapat menentukan secara otomatis apakah stok dikurangi. Silakan impor snapshot inventaris untuk negara+gudang tersebut di tabel induk inventaris terlebih dahulu." }),
  // --- B4-5: PO采购价缺失 (1, 变量在前) ---
  "gt.tmpl.020": Object.freeze({ zh: "{currency}采购价缺失", en: "{currency} purchase price is missing", id: "Harga pembelian {currency} tidak ditemukan" }),
  // --- B4-6: 入库数量超余量 (1) ---
  "gt.tmpl.021": Object.freeze({ zh: "入库数量超过可入库余量（最大 {maxInbound}）", en: "Inbound quantity exceeds the available inbound remainder (max {maxInbound})", id: "Kuantitas masuk melebihi sisa masuk yang tersedia (maks {maxInbound})" }),
  // --- B4-7: 费用归属国家快照 (1) ---
  "gt.tmpl.022": Object.freeze({ zh: "费用归属国家已快照为\u201c{existing}\u201d，不能直接修改", en: "Cost attribution country has been snapshotted as \u201c{existing}\u201d and cannot be modified directly", id: "Negara atribusi biaya telah di-snapshot sebagai \u201c{existing}\u201d dan tidak dapat diubah langsung" }),
  // --- B4-8: CI入库批次SKU校验 (3) ---
  "gt.tmpl.023": Object.freeze({ zh: "SKU {skuCode} 不存在", en: "SKU {skuCode} does not exist", id: "SKU {skuCode} tidak ada" }),
  "gt.tmpl.024": Object.freeze({ zh: "SKU {skuCode} 不属于该CI明细", en: "SKU {skuCode} does not belong to this CI detail", id: "SKU {skuCode} bukan milik detail CI ini" }),
  "gt.tmpl.025": Object.freeze({ zh: "SKU {skuCode} 原库存数量不能为负数", en: "SKU {skuCode} original stock quantity cannot be negative", id: "Kuantitas stok asli SKU {skuCode} tidak boleh negatif" })
});

// ==================== I18N-100P-B1：飞书通知模板三语 catalog ====================
// 8 类真实通知模板（以 server.js FEISHU_NOTIFY_TEMPLATES 实际代码为准）。
// 独立于 ALL_CATALOGS：不参与 API 错误翻译匹配，仅通过 notifyT() 按收件人语言生成。
// 动态参数（po_no/ci_no/request_no/due_date/amount/level/plan_date）保持原样不翻译。
// ci_ops_assigned 的"待定"场景拆为两个 key（_tbd 后缀），避免在模板内做条件判断。
const NOTIFY_TEMPLATE_CATALOG = Object.freeze({
  // 1. PO 提交审批 → 通知第 1 级审批人 + CC
  "notify.submit": Object.freeze({ zh: "【审批通知】PO {po_no} 已提交审批，请您审批。", en: "[Approval Notice] PO {po_no} has been submitted for approval. Please review.", id: "[Pemberitahuan Persetujuan] PO {po_no} telah diajukan untuk persetujuan. Mohon tinjau." }),
  // 2. PO 中间级审批通过 → 通知下一级审批人 + CC
  "notify.approved_intermediate": Object.freeze({ zh: "【审批通知】PO {po_no} 第{level}级已通过，请您审批。", en: "[Approval Notice] PO {po_no} Level {level} approved. Please review.", id: "[Pemberitahuan Persetujuan] PO {po_no} Level {level} disetujui. Mohon tinjau." }),
  // 3. PO 最终审批通过 → 通知提交人 + CC
  "notify.approved_final": Object.freeze({ zh: "【审批通知】PO {po_no} 审批已全部通过。", en: "[Approval Notice] PO {po_no} has been fully approved.", id: "[Pemberitahuan Persetujuan] PO {po_no} telah sepenuhnya disetujui." }),
  // 4. PO 审批驳回 → 通知提交人 + CC
  "notify.reject": Object.freeze({ zh: "【审批通知】PO {po_no} 已被驳回。", en: "[Approval Notice] PO {po_no} has been rejected.", id: "[Pemberitahuan Persetujuan] PO {po_no} telah ditolak." }),
  // 5a. CI 分配上架准备任务（有计划日期）
  "notify.ci_ops_assigned": Object.freeze({ zh: "【上架准备】CI {ci_no} 已分配上架准备任务，计划上架日期：{plan_date}。", en: "[Listing Prep] CI {ci_no} has been assigned a listing preparation task. Planned listing date: {plan_date}.", id: "[Persiapan Listing] CI {ci_no} telah ditugaskan tugas persiapan listing. Tanggal rencana listing: {plan_date}." }),
  // 5b. CI 分配上架准备任务（无计划日期 → 待定）
  "notify.ci_ops_assigned_tbd": Object.freeze({ zh: "【上架准备】CI {ci_no} 已分配上架准备任务，计划上架日期待定。", en: "[Listing Prep] CI {ci_no} has been assigned a listing preparation task. Planned listing date: TBD.", id: "[Persiapan Listing] CI {ci_no} telah ditugaskan tugas persiapan listing. Tanggal rencana listing: belum ditentukan." }),
  // 6. CI 上架准备完成（Ready）
  "notify.ci_ops_ready": Object.freeze({ zh: "【上架准备】CI {ci_no} 上架准备已完成（Ready），可安排上架。", en: "[Listing Prep] CI {ci_no} listing preparation is complete (Ready). Listing can be scheduled.", id: "[Persiapan Listing] CI {ci_no} persiapan listing selesai (Ready). Listing dapat dijadwalkan." }),
  // 7. 付款申请到期提醒（7 日内）
  "notify.payment_due": Object.freeze({ zh: "【付款提醒】付款申请 {request_no} 将于 {due_date} 到期，应付金额 {amount}，请及时安排付款。", en: "[Payment Reminder] Payment request {request_no} will be due on {due_date}. Amount payable: {amount}. Please arrange payment promptly.", id: "[Pengingat Pembayaran] Permintaan pembayaran {request_no} akan jatuh tempo pada {due_date}. Jumlah terutang: {amount}. Mohon segera atur pembayaran." }),
  // 8. 付款申请逾期提醒
  "notify.payment_overdue": Object.freeze({ zh: "【付款逾期】付款申请 {request_no} 已于 {due_date} 逾期，应付金额 {amount}，请尽快处理。", en: "[Payment Overdue] Payment request {request_no} is overdue since {due_date}. Amount payable: {amount}. Please process as soon as possible.", id: "[Pembayaran Terlambat] Permintaan pembayaran {request_no} terlambat sejak {due_date}. Jumlah terutang: {amount}. Mohon segera proses." }),

  // ==================== PAY-CORE Phase 1：付款审批通知（4 事件 × 3 语言） ====================
  // 与 PO 审批通知解耦：使用独立 ctx（business_no/business_type_label/amount/currency/applicant/approver/level/remark）。
  // business_type_label 通过 PAYMENT_BUSINESS_TYPE_LABEL_CATALOG 按收件人语言派生。
  // 9. 付款提交审批 → 通知第 1 级审批人 + CC
  "notify.payment.submit": Object.freeze({ zh: "【付款审批】{business_type_label} {business_no}（金额 {currency} {amount}）已提交审批，请您审批。", en: "[Payment Approval] {business_type_label} {business_no} (Amount: {currency} {amount}) has been submitted for approval. Please review.", id: "[Persetujuan Pembayaran] {business_type_label} {business_no} (Jumlah: {currency} {amount}) telah diajukan untuk persetujuan. Mohon tinjau." }),
  // 10. 付款中间级审批通过 → 通知下一级审批人 + CC
  "notify.payment.approved_intermediate": Object.freeze({ zh: "【付款审批】{business_type_label} {business_no} 第{level}级已通过，请您审批。", en: "[Payment Approval] {business_type_label} {business_no} Level {level} approved. Please review.", id: "[Persetujuan Pembayaran] {business_type_label} {business_no} Level {level} disetujui. Mohon tinjau." }),
  // 11. 付款最终审批通过 → 通知提交人 + CC
  "notify.payment.approved_final": Object.freeze({ zh: "【付款审批】{business_type_label} {business_no}（金额 {currency} {amount}）审批已全部通过。", en: "[Payment Approval] {business_type_label} {business_no} (Amount: {currency} {amount}) has been fully approved.", id: "[Persetujuan Pembayaran] {business_type_label} {business_no} (Jumlah: {currency} {amount}) telah disetujui sepenuhnya." }),
  // 12. 付款审批驳回 → 通知提交人 + CC（含 remark）
  "notify.payment.reject": Object.freeze({ zh: "【付款审批】{business_type_label} {business_no} 已被驳回。原因：{remark}", en: "[Payment Approval] {business_type_label} {business_no} has been rejected. Reason: {remark}", id: "[Persetujuan Pembayaran] {business_type_label} {business_no} telah ditolak. Alasan: {remark}" }),

  // ==================== LOGISTICS-LISTING-01：物流单 Listing 上架状态通知（4 事件 × 3 语言） ====================
  // 收件人 = 上架负责人 + CC（business_participants business_type='logistics'）。
  // status_label 由 LISTING_STATUS_LABEL_CATALOG 按收件人语言派生；eta_date/days/batch_no 为动态参数不翻译。
  // 13a. 物流单创建 → 通知上架负责人 + CC（有预计到货日期）
  "notify.logistics_listing_created": Object.freeze({ zh: "【上架任务】物流单 {batch_no} 已创建，预计到货日期：{eta_date}。当前上架状态：{status_label}，请及时提交上架计划。", en: "[Listing Task] Logistics order {batch_no} has been created. ETA: {eta_date}. Current listing status: {status_label}. Please submit the listing plan promptly.", id: "[Tugas Listing] Order logistik {batch_no} telah dibuat. Perkiraan tiba: {eta_date}. Status listing saat ini: {status_label}. Mohon segera ajukan rencana listing." }),
  // 13b. 物流单创建（无预计到货日期 → 待定）
  "notify.logistics_listing_created_tbd": Object.freeze({ zh: "【上架任务】物流单 {batch_no} 已创建，预计到货日期待定。当前上架状态：{status_label}，请及时提交上架计划。", en: "[Listing Task] Logistics order {batch_no} has been created. ETA: TBD. Current listing status: {status_label}. Please submit the listing plan promptly.", id: "[Tugas Listing] Order logistik {batch_no} telah dibuat. Perkiraan tiba: belum ditentukan. Status listing saat ini: {status_label}. Mohon segera ajukan rencana listing." }),
  // 14. 上架状态停滞提醒（创建/上次变更后 N 天未更新）
  "notify.logistics_listing_stalled": Object.freeze({ zh: "【上架提醒】物流单 {batch_no} 的上架状态已停留在「{status_label}」{days} 天未更新，请及时处理。", en: "[Listing Reminder] Logistics order {batch_no} has remained in \"{status_label}\" for {days} days without update. Please take action.", id: "[Pengingat Listing] Order logistik {batch_no} tetap berstatus \"{status_label}\" selama {days} hari tanpa pembaruan. Mohon segera ditindaklanjuti." }),
  // 15. 预计到货临近催办（ETA 前 N 天且未达已准备完成/已上架）
  "notify.logistics_listing_eta_due": Object.freeze({ zh: "【上架催办】物流单 {batch_no} 预计 {eta_date} 到货，当前上架状态「{status_label}」尚未准备完成，请优先处理。", en: "[Listing Urgent] Logistics order {batch_no} is expected to arrive on {eta_date}, but the listing status \"{status_label}\" is not yet ready. Please prioritize.", id: "[Listing Mendesak] Order logistik {batch_no} diperkirakan tiba pada {eta_date}, namun status listing \"{status_label}\" belum siap. Mohon diprioritaskan." })
});

// LOGISTICS-LISTING-01：Listing 上架状态三语 label（4 态 × 3 语言）
// 与 logistics_batches.listing_status 取值严格对齐：pending_plan / preparing / ready / listed。
const LISTING_STATUS_LABEL_CATALOG = Object.freeze({
  pending_plan: Object.freeze({ zh: "待提交上架计划", en: "Pending Listing Plan", id: "Menunggu Rencana Listing" }),
  preparing:    Object.freeze({ zh: "准备中",         en: "Preparing",            id: "Sedang Dipersiapkan" }),
  ready:        Object.freeze({ zh: "已准备完成",     en: "Ready",                id: "Siap" }),
  listed:       Object.freeze({ zh: "已上架",         en: "Listed",               id: "Sudah Listing" })
});

// 按收件人语言返回 Listing 状态 label；未配置状态回退原值（不抛错，保证通知可用）
function listingStatusLabel(lang, status) {
  const normalized = normalizeLanguage(lang);
  const row = LISTING_STATUS_LABEL_CATALOG[status];
  if (!row) return status || '';
  return normalized === 'zh' ? row.zh : (row[normalized] || row.zh);
}

// PAY-CORE Phase 1：付款审批业务类型三语 label（6 类 × 3 语言）
// 由 notifyPaymentApprovalParticipants 在构造 ctx 时按收件人语言派生 business_type_label。
// 与 approval_records.business_type 取值严格对齐：pi_deposit / ci_balance / freight / warehouse / customs / inspection。
const PAYMENT_BUSINESS_TYPE_LABEL_CATALOG = Object.freeze({
  pi_deposit:   Object.freeze({ zh: "PI定金付款", en: "PI Deposit Payment",       id: "Pembayaran Deposit PI" }),
  ci_balance:   Object.freeze({ zh: "CI尾款付款", en: "CI Balance Payment",       id: "Pembayaran Saldo CI" }),
  freight:      Object.freeze({ zh: "运费付款",   en: "Freight Payment",         id: "Pembayaran Ongkos Kirim" }),
  warehouse:    Object.freeze({ zh: "仓储费付款", en: "Warehouse Fee Payment",    id: "Pembayaran Biaya Gudang" }),
  customs:      Object.freeze({ zh: "关税付款",   en: "Customs Duty Payment",     id: "Pembayaran Bea Cukai" }),
  inspection:   Object.freeze({ zh: "商检费付款", en: "Inspection Fee Payment",   id: "Pembayaran Biaya Inspeksi" })
});

// 按收件人语言返回付款业务类型 label；未配置类型回退原值（不抛错，保证通知可用）
function paymentBusinessTypeLabel(lang, businessType) {
  const normalized = normalizeLanguage(lang);
  const row = PAYMENT_BUSINESS_TYPE_LABEL_CATALOG[businessType];
  if (!row) return businessType || '';
  return normalized === 'zh' ? row.zh : (row[normalized] || row.zh);
}

// 按收件人语言生成通知文本。lang 非法/缺失时回退 zh。
function notifyT(lang, key, vars) {
  const normalized = normalizeLanguage(lang);
  const row = NOTIFY_TEMPLATE_CATALOG[key];
  if (!row) return key;
  const text = normalized === 'zh' ? row.zh : (row[normalized] || row.zh);
  return interpolate(text, vars);
}

// ==================== 订单预测展示层三语：sales_reason / ai_business_advice / sales_status / action / risk_tags ====================
// 这些字段由 classifySkuState / buildAiAdvice 生成中文确定性模板并存入数据库。
// GET 端点读取数据库后按请求语言翻译为显示文案。
// 模板无动态参数（阈值 0.5/1.5/2/30/180 硬编码在字符串中），翻译内容与中文信息等价。
// 不修改 classifySkuState / buildAiAdvice 判断逻辑、公式、阈值和 API 字段结构。
const FORECAST_DISPLAY_CATALOG = Object.freeze({
  // --- sales_status ---
  "正常动销": Object.freeze({ zh: "正常动销", en: "Normal Sales", id: "Penjualan Normal" }),
  "清仓": Object.freeze({ zh: "清仓", en: "Clearance", id: "Clearance" }),
  "停采/停产": Object.freeze({ zh: "停采/停产", en: "Discontinued", id: "Dihentikan" }),
  "新品/销售数据不足": Object.freeze({ zh: "新品/销售数据不足", en: "New Product / Insufficient Sales", id: "Produk Baru / Data Penjualan Tidak Cukup" }),
  "无有效销售": Object.freeze({ zh: "无有效销售", en: "No Effective Sales", id: "Tidak Ada Penjualan Efektif" }),
  "缺货": Object.freeze({ zh: "缺货", en: "Out of Stock", id: "Kehabisan Stok" }),
  "缺货风险": Object.freeze({ zh: "缺货风险", en: "Stockout Risk", id: "Risiko Kehabisan Stok" }),
  "呆滞": Object.freeze({ zh: "呆滞", en: "Stagnant", id: "Stagnan" }),
  "慢销": Object.freeze({ zh: "慢销", en: "Slow Sales", id: "Penjualan Lambat" }),
  "停采/清库存": Object.freeze({ zh: "停采/清库存", en: "Discontinued / Clear Inventory", id: "Dihentikan / Bersihkan Persediaan" }),

  // --- sales_reason ---
  "销量与周转正常": Object.freeze({ zh: "销量与周转正常", en: "Sales and turnover are normal", id: "Penjualan dan perputaran normal" }),
  "生命周期为清仓期": Object.freeze({ zh: "生命周期为清仓期", en: "Lifecycle is in clearance phase", id: "Siklus hidup berada di fase clearance" }),
  "生命周期为停采/停产": Object.freeze({ zh: "生命周期为停采/停产", en: "Lifecycle is discontinued", id: "Siklus hidup telah dihentikan" }),
  "尚在新品保护期内，销售时间不足": Object.freeze({ zh: "尚在新品保护期内，销售时间不足", en: "Still within new product protection period, sales time insufficient", id: "Masih dalam masa perlindungan produk baru, waktu penjualan tidak cukup" }),
  "已过新品保护期，但历史无有效销量": Object.freeze({ zh: "已过新品保护期，但历史无有效销量", en: "Past new product protection period, but no historical effective sales", id: "Lewat masa perlindungan produk baru, tetapi tidak ada penjualan efektif historis" }),
  "当前可用库存为0，近期销量可能被缺货压低": Object.freeze({ zh: "当前可用库存为0，近期销量可能被缺货压低", en: "Available inventory is 0, recent sales may be depressed by stockout", id: "Persediaan tersedia 0, penjualan terbaru mungkin tertekan oleh kehabisan stok" }),
  "可用库存周转<0.5个月，近期销量可能被缺货压低": Object.freeze({ zh: "可用库存周转<0.5个月，近期销量可能被缺货压低", en: "Available inventory turnover < 0.5 months, recent sales may be depressed by stockout", id: "Perputaran persediaan tersedia < 0,5 bulan, penjualan terbaru mungkin tertekan oleh kehabisan stok" }),
  "近30天无有效销量且仍有库存": Object.freeze({ zh: "近30天无有效销量且仍有库存", en: "No effective sales in last 30 days while inventory remains", id: "Tidak ada penjualan efektif dalam 30 hari terakhir dan stok masih ada" }),
  "有销量但周转超目标2倍": Object.freeze({ zh: "有销量但周转超目标2倍", en: "Has sales but turnover exceeds 2x target", id: "Ada penjualan tetapi perputaran melebihi 2x target" }),
  "销量失真：当前可用库存为0，近期销量可能被缺货压低，已按过去4个月最高月销量作为补货参考。": Object.freeze({ zh: "销量失真：当前可用库存为0，近期销量可能被缺货压低，已按过去4个月最高月销量作为补货参考。", en: "Sales distortion: available inventory is 0, recent sales may be depressed by stockout, using peak monthly sales of past 4 months as replenishment reference.", id: "Distorsi penjualan: persediaan tersedia 0, penjualan terbaru mungkin tertekan oleh kehabisan stok, menggunakan penjualan bulanan tertinggi 4 bulan terakhir sebagai referensi pengisian ulang." }),
  "品牌已设为停采（停止合作），不参与补货建议，优先消化库存": Object.freeze({ zh: "品牌已设为停采（停止合作），不参与补货建议，优先消化库存", en: "Brand is set to discontinued (cooperation stopped), not included in replenishment suggestions, prioritize inventory clearance", id: "Merek diatur sebagai dihentikan (kerja sama dihentikan), tidak termasuk dalam saran pengisian ulang, prioritaskan pengurangan stok" }),

  // --- action ---
  "停止采购，优先消化库存": Object.freeze({ zh: "停止采购，优先消化库存", en: "Stop purchasing, prioritize inventory clearance", id: "Hentikan pembelian, prioritaskan pengurangan stok" }),
  "停止采购，不参与补货": Object.freeze({ zh: "停止采购，不参与补货", en: "Stop purchasing, not included in replenishment", id: "Hentikan pembelian, tidak termasuk dalam pengisian ulang" }),
  "人工复核目标周转，暂缓补货": Object.freeze({ zh: "人工复核目标周转，暂缓补货", en: "Manually review target turnover, delay replenishment", id: "Tinjau manual perputaran target, tunda pengisian ulang" }),
  "检查上架/价格/渠道，暂缓补货": Object.freeze({ zh: "检查上架/价格/渠道，暂缓补货", en: "Check listing/price/channel, delay replenishment", id: "Periksa listing/harga/kanal, tunda pengisian ulang" }),
  "优先复核补货，确认现货": Object.freeze({ zh: "优先复核补货，确认现货", en: "Prioritize replenishment review, confirm stock", id: "Prioritaskan tinjauan pengisian ulang, konfirmasi stok" }),
  "优先复核补货，避免断货": Object.freeze({ zh: "优先复核补货，避免断货", en: "Prioritize replenishment review, avoid stockout", id: "Prioritaskan tinjauan pengisian ulang, hindari kehabisan stok" }),
  "暂停补货，先清库存": Object.freeze({ zh: "暂停补货，先清库存", en: "Pause replenishment, clear inventory first", id: "Jeda pengisian ulang, bersihkan stok dahulu" }),
  "谨慎补货，先消化库存": Object.freeze({ zh: "谨慎补货，先消化库存", en: "Replenish cautiously, digest inventory first", id: "Isi ulang dengan hati-hati, cerna stok dahulu" }),
  "按目标周转正常补货": Object.freeze({ zh: "按目标周转正常补货", en: "Replenish per target turnover normally", id: "Isi ulang sesuai perputaran target secara normal" }),
  "停止采购，优先清库存": Object.freeze({ zh: "停止采购，优先清库存", en: "Stop purchasing, prioritize inventory clearance", id: "Hentikan pembelian, prioritaskan pengurangan stok" }),
  "人工复核后决定": Object.freeze({ zh: "人工复核后决定", en: "Decide after manual review", id: "Putuskan setelah tinjauan manual" }),

  // --- ai_business_advice MAIN ---
  "生命周期不适合正常补货，停止采购，优先消化库存。": Object.freeze({ zh: "生命周期不适合正常补货，停止采购，优先消化库存。", en: "Lifecycle is not suitable for normal replenishment, stop purchasing, prioritize inventory clearance.", id: "Siklus hidup tidak cocok untuk pengisian ulang normal, hentikan pembelian, prioritaskan pengurangan stok." }),
  "销售时间不足，先人工复核目标周转，避免短期误判。": Object.freeze({ zh: "销售时间不足，先人工复核目标周转，避免短期误判。", en: "Insufficient sales time, manually review target turnover first to avoid short-term misjudgement.", id: "Waktu penjualan tidak cukup, tinjau manual perputaran target dahulu untuk menghindari kesalahan penilaian jangka pendek." }),
  "暂无有效销量，先检查上架、价格、渠道和库存状态。": Object.freeze({ zh: "暂无有效销量，先检查上架、价格、渠道和库存状态。", en: "No effective sales yet, check listing, price, channel and inventory status first.", id: "Belum ada penjualan efektif, periksa listing, harga, kanal dan status stok dahulu." }),
  "现货为0，先复核补货；低销量可能由缺货造成。": Object.freeze({ zh: "现货为0，先复核补货；低销量可能由缺货造成。", en: "Stock is 0, review replenishment first; low sales may be caused by stockout.", id: "Stok 0, tinjau pengisian ulang dahulu; penjualan rendah mungkin disebabkan kehabisan stok." }),
  "现货周转低于0.5个月，优先复核补货，避免断货压低销量。": Object.freeze({ zh: "现货周转低于0.5个月，优先复核补货，避免断货压低销量。", en: "Available turnover is below 0.5 months, prioritize replenishment review to avoid stockout depressing sales.", id: "Perputaran tersedia di bawah 0,5 bulan, prioritaskan tinjauan pengisian ulang untuk menghindari kehabisan stok yang menekan penjualan." }),
  "30天无销量且仍有库存，暂停补货，先清库存。": Object.freeze({ zh: "30天无销量且仍有库存，暂停补货，先清库存。", en: "No sales in 30 days while inventory remains, pause replenishment and clear inventory first.", id: "Tidak ada penjualan dalam 30 hari dan stok masih ada, jeda pengisian ulang dan bersihkan stok dahulu." }),
  "有销量但周转超目标2倍，谨慎补货，先消化库存。": Object.freeze({ zh: "有销量但周转超目标2倍，谨慎补货，先消化库存。", en: "Has sales but turnover exceeds 2x target, replenish cautiously and digest inventory first.", id: "Ada penjualan tetapi perputaran melebihi 2x target, isi ulang dengan hati-hati dan cerna stok dahulu." }),
  "销量和周转正常，按目标周转正常补货。": Object.freeze({ zh: "销量和周转正常，按目标周转正常补货。", en: "Sales and turnover are normal, replenish per target turnover.", id: "Penjualan dan perputaran normal, isi ulang sesuai perputaran target." }),
  "数据不足，建议人工复核销量、库存、周转和生命周期。": Object.freeze({ zh: "数据不足，建议人工复核销量、库存、周转和生命周期。", en: "Insufficient data, recommend manual review of sales, inventory, turnover and lifecycle.", id: "Data tidak cukup, disarankan tinjauan manual penjualan, stok, perputaran dan siklus hidup." }),

  // --- ai_business_advice RISK ---
  "周转超目标1.5倍，控制采购，避免库存资金堆高。": Object.freeze({ zh: "周转超目标1.5倍，控制采购，避免库存资金堆高。", en: "Turnover exceeds 1.5x target, control purchasing to avoid inventory capital buildup.", id: "Perputaran melebihi 1,5x target, kendalikan pembelian untuk menghindari penumpukan modal persediaan." }),
  "周转超目标2倍，减少采购，优先消化库存。": Object.freeze({ zh: "周转超目标2倍，减少采购，优先消化库存。", en: "Turnover exceeds 2x target, reduce purchasing and prioritize inventory clearance.", id: "Perputaran melebihi 2x target, kurangi pembelian dan prioritaskan pengurangan stok." }),
  "库龄超180天且周转偏高，排查老库存、价格和渠道问题。": Object.freeze({ zh: "库龄超180天且周转偏高，排查老库存、价格和渠道问题。", en: "Age exceeds 180 days with high turnover, investigate old inventory, price and channel issues.", id: "Usia melebihi 180 hari dengan perputaran tinggi, periksa masalah stok lama, harga dan kanal." }),
  "缺少入库日期，先补全数据，避免库龄判断失真。": Object.freeze({ zh: "缺少入库日期，先补全数据，避免库龄判断失真。", en: "Missing inbound date, complete the data first to avoid distorted age judgement.", id: "Tanggal masuk hilang, lengkapi data dahulu untuk menghindari penilaian usia yang distorsi." }),

  // --- risk_tags (单个标签) ---
  "高库存关注": Object.freeze({ zh: "高库存关注", en: "High Stock Attention", id: "Perhatian Stok Tinggi" }),
  "高库存严重": Object.freeze({ zh: "高库存严重", en: "High Stock Severe", id: "Stok Tinggi Parah" }),
  "高库龄风险": Object.freeze({ zh: "高库龄风险", en: "High Age Risk", id: "Risiko Usia Tinggi" }),
  "库龄未知": Object.freeze({ zh: "库龄未知", en: "Age Unknown", id: "Usia Tidak Diketahui" }),
  "销量失真": Object.freeze({ zh: "销量失真", en: "Sales Distortion", id: "Distorsi Penjualan" }),
  "新品无销量": Object.freeze({ zh: "新品无销量", en: "New Product No Sales", id: "Produk Baru Tanpa Penjualan" }),

  // --- sales_group ---
  "滞销": Object.freeze({ zh: "滞销", en: "Stagnant", id: "Stagnan" }),
  "低动销": Object.freeze({ zh: "低动销", en: "Low Sales", id: "Penjualan Rendah" }),
  "中动销": Object.freeze({ zh: "中动销", en: "Medium Sales", id: "Penjualan Sedang" }),
  "高动销": Object.freeze({ zh: "高动销", en: "High Sales", id: "Penjualan Tinggi" })
});

// 按请求语言翻译订单预测展示字段（仅 sales_reason / ai_business_advice）
// 全量匹配原则：完整文本或其所有组成部分必须全部精确命中已知模板才翻译；
// 任意组成部分未知 → 整段原文返回（禁止部分翻译，保护用户输入/自由文本）
// 阈值 0.5/1.5/2/30/180/4 等价保留；MAIN/RISK 顺序不变
function forecastDisplayT(lang, zhText) {
  if (!zhText || normalizeLanguage(lang) === 'zh') return zhText;
  const normalized = normalizeLanguage(lang);
  var text = String(zhText);
  // 1. 完整文本精确命中一个已知模板（sales_reason 单句、ai_business_advice 单 MAIN 句子）
  var row = FORECAST_DISPLAY_CATALOG[text];
  if (row) return row[normalized] || row.zh;
  // 2. ai_business_advice = MAIN句 + 空格 + RISK句（零个或多个），按空格分割
  //    全量匹配：所有组成部分必须全部精确命中，否则整段原文返回
  var parts = text.split(' ');
  // 空格分割后只有一段且未命中 → 整段原文返回
  if (parts.length <= 1) return text;
  var translated = [];
  for (var i = 0; i < parts.length; i++) {
    var r = FORECAST_DISPLAY_CATALOG[parts[i]];
    if (!r) return text; // 任意组成部分未知 → 整段原文返回
    translated.push(r[normalized] || r.zh);
  }
  return translated.join(' ');
}
// forecastTagT 已撤回：枚举字段（sales_status/action/risk_tags/sales_group）保持数据库原始值，由前端格式化三语

// 合并目录：F1A (api.*) + F1B (se.* / ca.*) + CLOSEOUT-01 (gt.tmpl.*)
const ALL_CATALOGS = Object.freeze(
  Object.assign({}, API_CATALOG, SETTLEMENT_ERROR_CATALOG, COST_ALLOCATION_ERROR_CATALOG, GENERAL_TEMPLATE_CATALOG)
);

// api.112 已改为 gt.tmpl.009 全模板匹配（外层消息含动态 badMsg + 固定后缀），
// 不再作为前缀匹配，避免仅翻译前缀导致 badMsg 和后缀中文泄漏。
const PREFIX_KEYS = Object.freeze(["api.184","api.138","api.195","api.151","api.035","api.041","api.086","api.020","api.109","api.205","api.150","api.188","api.063","api.142","api.143"]);
const EXACT_INDEX = new Map(Object.entries(ALL_CATALOGS).map(([key, row]) => [row.zh, key]));
const PREFIX_ROWS = PREFIX_KEYS
  .map(key => ({ key, zh: API_CATALOG[key].zh }))
  .sort((a, b) => b.zh.length - a.zh.length);
const ORDER_DATE_TEMPLATE = API_CATALOG['api.059'];

// ---- 模板匹配器：为带 {placeholder} 的 zh 模板编译正则 ----
function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function _buildTemplateMatcher(key, zhTemplate) {
  const placeholderNames = [];
  const parts = zhTemplate.split(/\{(\w+)\}/g);
  let regexStr = '^';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      regexStr += _escapeRegex(parts[i]);
    } else {
      placeholderNames.push(parts[i]);
      regexStr += '(.+?)';
    }
  }
  regexStr += '$';
  return { key, zh: zhTemplate, regex: new RegExp(regexStr), placeholderNames };
}
const TEMPLATE_MATCHERS = [];
for (const [key, row] of Object.entries(SETTLEMENT_ERROR_CATALOG)) {
  if (key.startsWith('se.tmpl.')) {
    TEMPLATE_MATCHERS.push(_buildTemplateMatcher(key, row.zh));
  }
}
for (const [key, row] of Object.entries(COST_ALLOCATION_ERROR_CATALOG)) {
  if (key.startsWith('ca.tmpl.')) {
    TEMPLATE_MATCHERS.push(_buildTemplateMatcher(key, row.zh));
  }
}
for (const [key, row] of Object.entries(GENERAL_TEMPLATE_CATALOG)) {
  if (key.startsWith('gt.tmpl.')) {
    TEMPLATE_MATCHERS.push(_buildTemplateMatcher(key, row.zh));
  }
}
Object.freeze(TEMPLATE_MATCHERS);

function parseSupportedLanguage(raw) {
  if (raw == null) return null;
  const first = String(raw).split(',')[0].split(';')[0].trim().replace(/_/g, '-').toLowerCase();
  if (first === 'zh' || first.startsWith('zh-')) return 'zh';
  if (first === 'en' || first.startsWith('en-')) return 'en';
  if (first === 'id' || first.startsWith('id-')) return 'id';
  return null;
}

function normalizeLanguage(raw) {
  return parseSupportedLanguage(raw) || 'zh';
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const pair of String(cookieHeader).split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(pair.slice(index + 1).trim()); }
    catch (e) { return pair.slice(index + 1).trim(); }
  }
  return null;
}

function resolveRequestLanguage(req, options) {
  const preferCookie = !!(options && options.preferCookie);
  const headerPresent = !!(req && req.headers && Object.prototype.hasOwnProperty.call(req.headers, 'accept-language'));
  const headerValue = headerPresent ? req.headers['accept-language'] : null;
  const cookieValue = readCookie(req && req.headers && req.headers.cookie, LANGUAGE_COOKIE_NAME);
  if (preferCookie) {
    if (cookieValue != null) return normalizeLanguage(cookieValue);
    if (headerPresent) return normalizeLanguage(headerValue);
    return 'zh';
  }
  if (headerPresent) return normalizeLanguage(headerValue);
  if (cookieValue != null) return normalizeLanguage(cookieValue);
  return 'zh';
}

function interpolate(text, vars) {
  if (!vars || typeof text !== 'string') return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  ));
}

function serverT(lang, key, fallbackZh, vars) {
  const normalized = normalizeLanguage(lang);
  const row = ALL_CATALOGS[key];
  const text = normalized === 'zh' || !row ? fallbackZh : row[normalized];
  return interpolate(text == null ? fallbackZh : text, vars);
}

function translateApprovedText(lang, value) {
  if (typeof value !== 'string' || normalizeLanguage(lang) === 'zh') return value;
  const exactKey = EXACT_INDEX.get(value);
  if (exactKey) return serverT(lang, exactKey, value);

  const orderDatePrefix = ORDER_DATE_TEMPLATE.zh.replace('{0}', '');
  if (value.startsWith(orderDatePrefix)) {
    return serverT(lang, 'api.059', ORDER_DATE_TEMPLATE.zh, { 0: value.slice(orderDatePrefix.length) });
  }

  for (const row of PREFIX_ROWS) {
    if (value.startsWith(row.zh)) {
      return serverT(lang, row.key, row.zh) + value.slice(row.zh.length);
    }
  }

  // Phase 3-F1B: SettlementError & CostAllocationError 模板匹配
  for (const matcher of TEMPLATE_MATCHERS) {
    const m = matcher.regex.exec(value);
    if (m) {
      const vars = {};
      for (let i = 0; i < matcher.placeholderNames.length; i++) {
        vars[matcher.placeholderNames[i]] = m[i + 1];
      }
      return serverT(lang, matcher.key, matcher.zh, vars);
    }
  }

  return value;
}

function localizeValue(lang, value, active) {
  if (typeof value === 'string') return active ? translateApprovedText(lang, value) : value;
  if (Array.isArray(value)) return value.map(item => localizeValue(lang, item, active));
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return value;
  const out = {};
  const isSettlementLog = isSettlementLogObject(value);
  for (const key of Object.keys(value)) {
    if (key === 'error_report' && typeof value[key] === 'string') {
      // error_report 应为 JSON 字符串（由 finishBatchTask 中 JSON.stringify(errors||[]) 写入）。
      // 解析后按 RESPONSE_TEXT_FIELDS 规则递归；非 JSON（DB 损坏/旧数据/业务原文）保持原样，不翻译。
      try { out[key] = JSON.stringify(localizeValue(lang, JSON.parse(value[key]), false)); }
      catch (e) { out[key] = value[key]; }
      continue;
    }
    const operationLogReason = key === 'reason' && value.operation_type != null && value.target_ids != null;
    const settlementLogReason = key === 'reason' && isSettlementLog;
    out[key] = localizeValue(lang, value[key], active || (RESPONSE_TEXT_FIELDS.has(key) && !operationLogReason && !settlementLogReason));
  }
  return out;
}

function localizeResponseBody(req, body) {
  const lang = req && req.i18nLang ? req.i18nLang : resolveRequestLanguage(req);
  if (normalizeLanguage(lang) === 'zh') return body;
  return localizeValue(lang, body, false);
}

module.exports = Object.freeze({
  API_CATALOG,
  SETTLEMENT_ERROR_CATALOG,
  COST_ALLOCATION_ERROR_CATALOG,
  GENERAL_TEMPLATE_CATALOG,
  NOTIFY_TEMPLATE_CATALOG,
  PAYMENT_BUSINESS_TYPE_LABEL_CATALOG,
  LISTING_STATUS_LABEL_CATALOG,
  FORECAST_DISPLAY_CATALOG,
  ALL_CATALOGS,
  TEMPLATE_MATCHERS,
  LANGUAGE_COOKIE_NAME,
  RESPONSE_TEXT_FIELDS,
  normalizeLanguage,
  resolveRequestLanguage,
  serverT,
  notifyT,
  forecastDisplayT,
  translateApprovedText,
  localizeResponseBody,
  paymentBusinessTypeLabel,
  listingStatusLabel
});
