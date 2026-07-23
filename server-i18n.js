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

// 合并目录：F1A (api.*) + F1B (se.* / ca.*)
const ALL_CATALOGS = Object.freeze(
  Object.assign({}, API_CATALOG, SETTLEMENT_ERROR_CATALOG, COST_ALLOCATION_ERROR_CATALOG)
);

const PREFIX_KEYS = Object.freeze(["api.184","api.112","api.138","api.195","api.151","api.035","api.041","api.086","api.020","api.109","api.205","api.150","api.188","api.063","api.142","api.143"]);
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
  ALL_CATALOGS,
  TEMPLATE_MATCHERS,
  LANGUAGE_COOKIE_NAME,
  RESPONSE_TEXT_FIELDS,
  normalizeLanguage,
  resolveRequestLanguage,
  serverT,
  translateApprovedText,
  localizeResponseBody
});
