(function () {
'use strict';
const TXT={
zh:{title:'价格体系',subtitle:'按国家、品牌、电商平台和店铺维护独立价格方案',scheme:'价格方案',newScheme:'新增价格方案',blankScheme:'新建空白方案',copyScheme:'复制已有方案',copySource:'选择要复制的方案',copySourcePlaceholder:'请选择已有价格方案',copySchemeHelp:'复制费用字段、类目适用范围、字段顺序和 SRP 公式设置；不复制 SKU 手工价格、费用值和 WAC 数据。',copyAndCreate:'复制并新建',copySchemeEmpty:'暂无可复制的价格方案',copySourceRequired:'请选择要复制的价格方案',copySchemeCreated:'价格方案复制成功',fields:'费用字段设置',fieldOrderTitle:'字段顺序',fieldOrderHint:'按住左侧手柄拖动，调整字段在价格表中的列顺序。',fieldEditorHint:'设置字段名称、类型及适用范围。保存后将应用于当前价格方案。',basicInfo:'基础信息',scopeInfo:'适用范围',calculationInfo:'计算设置',systemField:'系统字段',savingOrder:'正在保存顺序…',orderSaved:'字段顺序已保存',fieldCount:'个字段',formula:'SRP 计算公式',history:'历史版本',import:'导入 Excel',export:'导出 Excel',save:'保存修改',saved:'保存成功',loading:'正在加载价格数据…',emptyTitle:'还没有价格方案',emptyHint:'先建立国家、品牌、平台和店铺对应的价格方案，再维护 SKU 价格。',country:'国家',brand:'品牌',platform:'电商平台',shop:'店铺',currency:'价格币种',category:'类目',sku:'SKU 编码',stock:'库存数量',srp:'SRP',noData:'当前品牌暂无 SKU 主数据',noFields:'尚未设置费用字段，可先添加需要维护的价格项目。',add:'新增',edit:'编辑',delete:'删除',cancel:'取消',confirm:'确认',close:'关闭',fieldName:'字段名称',fieldKey:'字段编码',fieldType:'字段类型',unit:'显示单位',displayFormat:'单元格格式',decimalPlaces:'小数位数',formatAuto:'自动',formatAmount:'金额',formatNumber:'数字',formatPercent:'百分比',amount:'金额',percent:'百分比',number:'数值',calc:'公式计算',syncWacField:'\u81ea\u52a8\u540c\u6b65 WAC',syncWacFieldHelp:'\u5f00\u542f\u540e\uff0c\u7cfb\u7edf\u6309 SKU\u3001\u56fd\u5bb6\u548c\u54c1\u724c\u81ea\u52a8\u5339\u914d\u6700\u65b0\u6709\u6548\u4e14\u5df2\u786e\u8ba4\u7684 WAC\uff1b\u8be5\u5b57\u6bb5\u81ea\u52a8\u66f4\u65b0\uff0c\u4e0d\u9700\u8981\u624b\u52a8\u7ef4\u62a4\u3002',wacSource:'WAC\u81ea\u52a8\u540c\u6b65',allCategoriesHelp:'\u4e0d\u9009\u62e9\u5177\u4f53\u7c7b\u76ee\u65f6\uff0c\u9ed8\u8ba4\u5168\u90e8\u9002\u7528\u3002',selectAllCategories:'全选',percentSettings:'百分比设置',defaultPercent:'默认百分比',batchApplyPercent:'批量应用到已匹配 SKU',percentBatchHint:'批量应用后，将为当前适用范围内的 SKU 填入该百分比；之后仍可在价格列表中按 SKU 单独修改。',percentRequired:'请输入有效的非负百分比。',percentApplied:'百分比已批量应用到适用 SKU',noPercentSkus:'当前适用范围内没有可更新的 SKU。',formulaText:'计算公式',categoryFormulaRules:'按类目配置计算公式',addCategoryRule:'新增类目规则',previewCategoryFormula:'校验并预览',categoryFormulaEmpty:'当前品牌没有可配置的产品类目，请先维护 SKU 主数据类目。',categoryFormulaPreviewEmpty:'填写公式后点击校验并预览。',categoryFormulaPreviewOk:'公式校验通过',allCategories:'适用全部类目',categoryScope:'适用类目',formulaHelp:'支持 +、-、*、/、括号、百分号及 MIN()/MAX()；公式开头可选写 =。例如 MIN(srp*6.5%,80000)。百分比字段按 8 录入 8%，引用时需要 /100。',formulaFields:'可用字段',formulaRulesTitle:'公式规则',addFormulaRule:'新增公式',copyFormulaRule:'复制',formulaRuleLabel:'公式',formulaText:'计算公式',formulaApplyCategories:'适用类目',formulaApplyCategoriesHint:'选择该计算公式要应用的产品类目，可多选。',searchCategories:'搜索类目',clearCategories:'清空',selectedCount:'已选',selectedCategories:'已选类目',formulaAppliedToCategories:'该公式将应用于以上',chooseFormulaCategories:'请选择该公式的适用类目',formulaEnterHint:'填写公式后点击校验并预览。',formulaValidating:'正在校验并预览…',formulaValidPreview:'校验通过',formulaValidationFailed:'公式校验失败',formulaRequired:'请先填写计算公式。',formulaRuleIncomplete:'每条公式规则都需要填写公式并至少选择一个适用类目。',formulaCategoryDuplicate:'类目被多个公式规则重复选择，请调整适用类目。',formulaCategoryAssigned:'该类目已分配给其他公式规则。',noFormulaRules:'尚未添加公式规则，请点击「新增公式」。',noProductCategories:'暂无产品类目。',formulaBaseFields:'基础数据字段',formulaFeeFields:'其他费用字段',formulaPriceFields:'价格字段',formulaNoFeeFields:'当前没有其他费用字段',formulaOperators:'运算符',formulaFunctions:'函数',formulaPreviewHint:'输入公式后自动校验；预览使用当前价格方案首个 SKU 的实际数据。',formulaPreviewValid:'公式校验通过',formulaPreviewResult:'预览结果',formulaPreviewSample:'预览 SKU',formulaPreviewEmpty:'请输入公式，系统会自动校验并预览。',formulaPreviewNoSku:'当前没有 SKU 数据，按 0 值预览。',formulaPreviewError:'公式错误',formulaBuilderHint:'点击字段、函数或运算符即可插入公式，也可以直接输入。填写公式后自动切换为公式计算。',systemLandingCost:'系统 Landing Cost',srpManualHint:'可直接在列表修改 SRP。手动填写会覆盖公式计算；清空后恢复公式值。',purchasePriceRmb:'采购价 RMB',purchasePriceUsd:'采购价 USD',standardPurchasePrice:'标准采购价',weightedAvgCost:'SKU 加权平均成本',inventoryWac:'库存 WAC',customsRate:'参考关税税率',inventoryQty:'库存数量',formulaEmpty:'留空表示暂不计算 SRP。',version:'版本',restore:'恢复此版本',importHint:'Excel \u6a21\u677f\u5305\u542b SKU\u3001SRP \u548c\u624b\u52a8\u8d39\u7528\u5b57\u6bb5\uff1bWAC \u6765\u6e90\u5b57\u6bb5\u7531\u7cfb\u7edf\u81ea\u52a8\u66f4\u65b0\uff0c\u5e93\u5b58\u6570\u91cf\u81ea\u52a8\u540c\u6b65\u3002',importDone:'Excel 导入完成',exportDone:'Excel 已导出',unsaved:'有未保存的修改，确定切换方案吗？',discardChanges:'有未保存修改，继续操作会丢弃这些修改。是否继续？',schemeCreated:'价格方案创建成功',fieldSaved:'费用字段已保存',formulaSaved:'SRP 公式已保存',restored:'历史版本已恢复',noHistory:'暂无历史版本',stop:'停用方案',stopConfirm:'确定停用该价格方案？停用后不会出现在方案列表中。',actions:'操作',deleteScheme:'删除方案',deleteSchemeTitle:'删除价格方案',deleteSchemeConfirm:'确定要永久删除这个价格方案吗？',deleteSchemeWarning:'该方案关联的 SKU 价格、费用字段、WAC 成本关联及历史版本都会被删除；原始 WAC 历史记录不会受影响。此操作不可恢复。',schemeDeleted:'价格方案已删除',selectCountry:'请选择国家',selectBrand:'请选择品牌',enterPlatform:'请输入平台名称',fieldKeyHint:'仅英文小写字母、数字和下划线，例如 platform_fee',saveFailed:'保存失败',skuRequired:'Excel 中找不到 SKU 编码列',missingCategories:'个 SKU 尚未在 SKU 主数据维护类目，按类目匹配费用时请先补齐类目',landingCost:'Landing Cost',selectWac:'\u9009\u62e9 WAC',wacHistory:'WAC \u5386\u53f2\u8bb0\u5f55',noWacHistory:'\u8be5 SKU \u6ca1\u6709\u53ef\u7528\u7684\u5df2\u786e\u8ba4 WAC \u5386\u53f2\u8bb0\u5f55',latest:'\u6700\u65b0',choose:'\u4f7f\u7528\u6b64 WAC',current:'\u5f53\u524d\u4f7f\u7528',clearLandingCost:'\u6e05\u9664 Landing Cost',warehouse:'\u4ed3\u5e93',ciNo:'CI \u7f16\u53f7',confirmedAt:'\u786e\u8ba4\u65f6\u95f4',inboundDate:'\u5165\u5e93\u65e5\u671f',manualSrp:'\u624b\u52a8\u5bfc\u5165',formulaSrp:'\u516c\u5f0f\u8ba1\u7b97',syncWac:'WAC \u6279\u91cf\u540c\u6b65',syncWacTitle:'Landing Cost \u6279\u91cf\u540c\u6b65',syncWacDesc:'\u6309\u5f53\u524d\u4ef7\u683c\u65b9\u6848\u7684\u56fd\u5bb6\u548c\u54c1\u724c\uff0c\u6309 SKU \u5339\u914d WAC \u5386\u53f2\u8bb0\u5f55\uff0c\u5e76\u4f7f\u7528\u6bcf\u4e2a SKU \u6700\u65b0\u7684\u6709\u6548 WAC\u3002\u672a\u5339\u914d\u7684 SKU \u4fdd\u7559\u539f\u503c\u3002',matched:'\u5339\u914d\u6210\u529f',unmatched:'\u672a\u5339\u914d',willUpdate:'\u5c06\u66f4\u65b0',unchanged:'\u65e0\u9700\u66f4\u65b0',unmatchedSamples:'\u672a\u5339\u914d SKU',noWacMatch:'\u6ca1\u6709\u627e\u5230\u53ef\u7528 WAC\uff0c\u4e0d\u4f1a\u4fee\u6539\u73b0\u6709 Landing Cost\u3002',syncWacDone:'WAC \u6279\u91cf\u540c\u6b65\u5b8c\u6210',downloadTemplate:'\u4e0b\u8f7d\u5bfc\u5165\u6a21\u677f',templateInstructions:'\u586b\u5199\u8bf4\u660e',templateSku:'SKU \u7f16\u7801\u7531\u7cfb\u7edf\u63d0\u4f9b\uff0c\u8bf7\u52ff\u4fee\u6539\u3002',templateSrp:'\u586b\u5199 SRP \u548c\u9002\u7528\u7c7b\u76ee\u7684\u8d39\u7528\u5b57\u6bb5\uff1b\u7559\u7a7a\u8868\u793a\u4e0d\u4fee\u6539\u3002',templateLanding:'Landing Cost \u4e0d\u901a\u8fc7 Excel \u5bfc\u5165\uff1b\u52fe\u9009\u4e86 WAC \u81ea\u52a8\u540c\u6b65\u7684\u5b57\u6bb5\u7531\u7cfb\u7edf\u66f4\u65b0\u3002',templateStock:'\u7c7b\u76ee\u4ec5\u4f9b\u53c2\u8003\uff1b\u5e93\u5b58\u81ea\u52a8\u540c\u6b65\uff0c\u4e0d\u9700\u8981\u586b\u5199\u3002'},
en:{title:'Price System',subtitle:'Maintain separate pricing schemes by country, brand, platform and shop',scheme:'Pricing Scheme',newScheme:'New Scheme',blankScheme:'Create Blank Scheme',copyScheme:'Copy Existing Scheme',copySource:'Choose a scheme to copy',copySourcePlaceholder:'Select an existing pricing scheme',copySchemeHelp:'Copies fee fields, category scopes, field order and SRP formulas. SKU-specific prices, fee values and WAC data are not copied.',copyAndCreate:'Copy & Create',copySchemeEmpty:'No pricing schemes available to copy',copySourceRequired:'Select a pricing scheme to copy',copySchemeCreated:'Pricing scheme copied',fields:'Fee Fields',fieldOrderTitle:'Field Order',fieldOrderHint:'Drag the handle on the left to change the column order in the price table.',fieldEditorHint:'Set the field name, type and applicable categories. Changes apply to this pricing scheme.',basicInfo:'Basic Information',scopeInfo:'Applicable Scope',calculationInfo:'Calculation Settings',systemField:'System Field',savingOrder:'Saving order…',orderSaved:'Field order saved',fieldCount:'fields',formula:'SRP Formula',history:'Version History',import:'Import Excel',export:'Export Excel',save:'Save Changes',saved:'Saved successfully',loading:'Loading price data…',emptyTitle:'No pricing scheme yet',emptyHint:'Create a scheme for a country, brand, platform and shop before maintaining SKU prices.',country:'Country',brand:'Brand',platform:'Platform',shop:'Shop',currency:'Currency',category:'Category',sku:'SKU',stock:'Stock Qty',srp:'SRP',noData:'No SKU master data for this brand',noFields:'No fee fields configured. Add the price items you need to maintain.',add:'Add',edit:'Edit',delete:'Delete',cancel:'Cancel',confirm:'Confirm',close:'Close',fieldName:'Field Name',fieldKey:'Field Key',fieldType:'Field Type',unit:'Display Unit',displayFormat:'Cell Format',decimalPlaces:'Decimal Places',formatAuto:'Auto',formatAmount:'Amount',formatNumber:'Number',formatPercent:'Percentage',amount:'Amount',percent:'Percentage',number:'Number',calc:'Formula',syncWacField:'Sync WAC automatically',syncWacFieldHelp:'When enabled, the system matches the latest valid confirmed WAC by SKU, country and brand. This field updates automatically and does not need manual maintenance.',wacSource:'WAC auto sync',formulaText:'Formula',categoryFormulaRules:'Formula Rules by Category',addCategoryRule:'Add Category Rule',previewCategoryFormula:'Validate & Preview',categoryFormulaEmpty:'No product categories are available. Maintain categories in SKU master first.',categoryFormulaPreviewEmpty:'Enter a formula, then validate and preview it.',categoryFormulaPreviewOk:'Formula validated',allCategories:'Apply to all categories',categoryScope:'Applicable Categories',allCategoriesHelp:'Leave blank to apply to all categories.',selectAllCategories:'Select all',percentSettings:'Percentage Settings',defaultPercent:'Default Percentage',batchApplyPercent:'Apply to matched SKUs',percentBatchHint:'Apply this percentage to SKUs in the current scope. You can still edit each SKU separately in the price list.',percentRequired:'Enter a valid non-negative percentage.',percentApplied:'Percentage applied to applicable SKUs',noPercentSkus:'No SKUs match the current scope.',formulaHelp:'Supports +, -, *, /, parentheses, %, MIN() and MAX(). A leading = is optional. Example: MIN(srp*6.5%,80000). Percentage fields store 8 for 8%; divide by 100 when referencing them.',formulaFields:'Available Fields',formulaRulesTitle:'Formula Rules',addFormulaRule:'Add Formula',copyFormulaRule:'Copy',formulaRuleLabel:'Formula',formulaText:'Formula',formulaApplyCategories:'Applicable Categories',formulaApplyCategoriesHint:'Choose the product categories this formula applies to. Multiple selections are allowed.',searchCategories:'Search categories',clearCategories:'Clear',selectedCount:'Selected',selectedCategories:'Selected Categories',formulaAppliedToCategories:'This formula applies to',chooseFormulaCategories:'Select the categories for this formula.',formulaEnterHint:'Enter a formula, then validate and preview.',formulaValidating:'Validating and previewing…',formulaValidPreview:'Validation passed',formulaValidationFailed:'Formula validation failed',formulaRequired:'Enter a formula first.',formulaRuleIncomplete:'Each formula rule needs an expression and at least one category.',formulaCategoryDuplicate:'A category is selected in multiple formula rules. Please resolve the overlap.',formulaCategoryAssigned:'This category is already assigned to another formula rule.',noFormulaRules:'No formula rules yet. Click “Add Formula”.',noProductCategories:'No product categories.',formulaBaseFields:'Base Data',formulaFeeFields:'Other Fee Fields',formulaPriceFields:'Price Fields',formulaNoFeeFields:'No other fee fields configured',formulaOperators:'Operators',formulaFunctions:'Functions',formulaPreviewHint:'The formula is validated automatically. Preview uses the first SKU in this pricing scheme.',formulaPreviewValid:'Formula is valid',formulaPreviewResult:'Preview result',formulaPreviewSample:'Preview SKU',formulaPreviewEmpty:'Enter a formula to validate and preview it.',formulaPreviewNoSku:'No SKU data; preview uses zero values.',formulaPreviewError:'Formula error',formulaBuilderHint:'Click a field, function, or operator to insert it, or type directly. Entering a formula switches this field to Formula automatically.',systemLandingCost:'System Landing Cost',srpManualHint:'Edit SRP directly in the list. A manual value overrides the formula; clear it to restore the formula result.',purchasePriceRmb:'Purchase Price RMB',purchasePriceUsd:'Purchase Price USD',standardPurchasePrice:'Standard Purchase Price',weightedAvgCost:'SKU Weighted Average Cost',inventoryWac:'Inventory WAC',customsRate:'Reference Customs Rate',inventoryQty:'Inventory Quantity',formulaEmpty:'Leave blank to keep SRP calculation disabled.',version:'Version',restore:'Restore this version',importHint:'Use the template for SRP and manual fee fields. WAC-enabled fields are updated automatically from confirmed WAC; stock is synced automatically.',importDone:'Excel import completed',exportDone:'Excel exported',unsaved:'You have unsaved changes. Switch scheme anyway?',discardChanges:'You have unsaved changes. Continuing will discard them. Continue?',schemeCreated:'Pricing scheme created',fieldSaved:'Fee field saved',formulaSaved:'SRP formula saved',restored:'Historical version restored',noHistory:'No version history',stop:'Deactivate Scheme',stopConfirm:'Deactivate this pricing scheme? It will no longer appear in the scheme list.',actions:'Actions',deleteScheme:'Delete Scheme',deleteSchemeTitle:'Delete Pricing Scheme',deleteSchemeConfirm:'Are you sure you want to permanently delete this pricing scheme?',deleteSchemeWarning:'All SKU prices, fee fields, WAC cost links and version history for this scheme will be deleted. Original WAC history will not be affected. This action cannot be undone.',schemeDeleted:'Pricing scheme deleted',selectCountry:'Select a country',selectBrand:'Select a brand',enterPlatform:'Enter platform name',fieldKeyHint:'Lowercase letters, numbers and underscores only, e.g. platform_fee',saveFailed:'Save failed',skuRequired:'SKU column was not found in Excel',missingCategories:' SKUs have no category in SKU master. Maintain categories before applying category-specific fees.',landingCost:'Landing Cost',selectWac:'Select WAC',wacHistory:'WAC History',noWacHistory:'No confirmed WAC history is available for this SKU',latest:'Latest',choose:'Use this WAC',current:'Current',clearLandingCost:'Clear Landing Cost',warehouse:'Warehouse',ciNo:'CI No.',confirmedAt:'Confirmed At',inboundDate:'Inbound Date',manualSrp:'Manual Import',formulaSrp:'Formula',syncWac:'Sync WAC in Bulk',syncWacTitle:'Bulk Sync Landing Cost',syncWacDesc:'Match WAC history by SKU within this pricing scheme country and brand. The latest valid WAC is used for each SKU. Unmatched SKUs keep their existing values.',matched:'Matched',unmatched:'Unmatched',willUpdate:'To update',unchanged:'Unchanged',unmatchedSamples:'Unmatched SKUs',noWacMatch:'No valid WAC found. Existing Landing Cost values will not be changed.',syncWacDone:'Bulk WAC sync completed',downloadTemplate:'Download Import Template',templateInstructions:'Instructions',templateSku:'SKU codes are generated by the system. Do not edit them.',templateSrp:'Fill in SRP and fee fields applicable to each SKU category. Blank cells are not changed.',templateLanding:'Landing Cost is not imported from Excel. Fields configured for WAC auto sync are updated by the system.',templateStock:'Category is for reference. Stock is synced automatically.'},
id:{title:'Sistem Harga',subtitle:'Kelola skema harga berdasarkan negara, merek, platform, dan toko',scheme:'Skema Harga',newScheme:'Skema Baru',blankScheme:'Buat Skema Kosong',copyScheme:'Salin Skema yang Ada',copySource:'Pilih skema untuk disalin',copySourcePlaceholder:'Pilih skema harga yang ada',copySchemeHelp:'Menyalin kolom biaya, cakupan kategori, urutan kolom, dan rumus SRP. Harga dan nilai biaya per SKU serta data WAC tidak disalin.',copyAndCreate:'Salin & Buat',copySchemeEmpty:'Tidak ada skema harga untuk disalin',copySourceRequired:'Pilih skema harga yang akan disalin',copySchemeCreated:'Skema harga berhasil disalin',fields:'Kolom Biaya',fieldOrderTitle:'Urutan Kolom',fieldOrderHint:'Tarik pegangan di kiri untuk mengubah urutan kolom pada tabel harga.',fieldEditorHint:'Atur nama, jenis, dan kategori yang berlaku. Perubahan diterapkan pada skema harga ini.',basicInfo:'Informasi Dasar',scopeInfo:'Cakupan Kategori',calculationInfo:'Pengaturan Perhitungan',systemField:'Kolom Sistem',savingOrder:'Menyimpan urutan…',orderSaved:'Urutan kolom disimpan',fieldCount:'kolom',formula:'Rumus SRP',history:'Riwayat Versi',import:'Impor Excel',export:'Ekspor Excel',save:'Simpan Perubahan',saved:'Berhasil disimpan',loading:'Memuat data harga…',emptyTitle:'Belum ada skema harga',emptyHint:'Buat skema berdasarkan negara, merek, platform, dan toko terlebih dahulu.',country:'Negara',brand:'Merek',platform:'Platform',shop:'Toko',currency:'Mata Uang',category:'Kategori',sku:'SKU',stock:'Jumlah Stok',srp:'SRP',noData:'Belum ada data SKU untuk merek ini',noFields:'Belum ada kolom biaya. Tambahkan item harga yang perlu dikelola.',add:'Tambah',edit:'Edit',delete:'Hapus',cancel:'Batal',confirm:'Konfirmasi',close:'Tutup',fieldName:'Nama Kolom',fieldKey:'Kode Kolom',fieldType:'Jenis Kolom',unit:'Satuan Tampilan',displayFormat:'Format Sel',decimalPlaces:'Jumlah Desimal',formatAuto:'Otomatis',formatAmount:'Jumlah',formatNumber:'Angka',formatPercent:'Persentase',amount:'Jumlah',percent:'Persentase',number:'Angka',calc:'Rumus',syncWacField:'Sinkronkan WAC otomatis',syncWacFieldHelp:'Jika diaktifkan, sistem mencocokkan WAC terkonfirmasi terbaru berdasarkan SKU, negara, dan merek. Kolom ini diperbarui otomatis.',wacSource:'Sinkronisasi WAC otomatis',formulaText:'Rumus',categoryFormulaRules:'Aturan Rumus per Kategori',addCategoryRule:'Tambah Aturan Kategori',previewCategoryFormula:'Validasi & Pratinjau',categoryFormulaEmpty:'Tidak ada kategori produk. Atur kategori di master SKU terlebih dahulu.',categoryFormulaPreviewEmpty:'Masukkan rumus, lalu validasi dan pratinjau.',categoryFormulaPreviewOk:'Rumus valid',allCategories:'Semua kategori',categoryScope:'Kategori yang Berlaku',allCategoriesHelp:'Kosongkan untuk menerapkan ke semua kategori.',selectAllCategories:'Pilih semua',percentSettings:'Pengaturan Persentase',defaultPercent:'Persentase Default',batchApplyPercent:'Terapkan ke SKU yang cocok',percentBatchHint:'Terapkan persentase ini ke SKU dalam cakupan saat ini. Setiap SKU tetap dapat diedit secara terpisah di daftar harga.',percentRequired:'Masukkan persentase non-negatif yang valid.',percentApplied:'Persentase berhasil diterapkan ke SKU terkait',noPercentSkus:'Tidak ada SKU yang cocok dengan cakupan ini.',formulaHelp:'Mendukung +, -, *, /, tanda kurung, %, MIN(), dan MAX(). Awalan = opsional. Contoh: MIN(srp*6.5%,80000). Nilai kolom persentase 8 berarti 8%; bagi dengan 100 saat digunakan dalam rumus.',formulaFields:'Kolom yang Tersedia',formulaRulesTitle:'Aturan Rumus',addFormulaRule:'Tambah Rumus',copyFormulaRule:'Salin',formulaRuleLabel:'Rumus',formulaText:'Rumus',formulaApplyCategories:'Kategori Berlaku',formulaApplyCategoriesHint:'Pilih kategori produk untuk rumus ini. Anda dapat memilih beberapa kategori.',searchCategories:'Cari kategori',clearCategories:'Hapus Pilihan',selectedCount:'Dipilih',selectedCategories:'Kategori Terpilih',formulaAppliedToCategories:'Rumus ini berlaku untuk',chooseFormulaCategories:'Pilih kategori untuk rumus ini.',formulaEnterHint:'Masukkan rumus, lalu validasi dan pratinjau.',formulaValidating:'Memvalidasi dan melihat pratinjau…',formulaValidPreview:'Validasi berhasil',formulaValidationFailed:'Validasi rumus gagal',formulaRequired:'Masukkan rumus terlebih dahulu.',formulaRuleIncomplete:'Setiap aturan rumus harus memiliki rumus dan minimal satu kategori.',formulaCategoryDuplicate:'Satu kategori dipilih pada beberapa aturan rumus. Periksa kembali pilihan kategori.',formulaCategoryAssigned:'Kategori ini sudah ditetapkan ke aturan rumus lain.',noFormulaRules:'Belum ada aturan rumus. Klik “Tambah Rumus”.',noProductCategories:'Tidak ada kategori produk.',formulaBaseFields:'Data Dasar',formulaFeeFields:'Kolom Biaya Lain',formulaPriceFields:'Kolom Harga',formulaNoFeeFields:'Belum ada kolom biaya lain',formulaOperators:'Operator',formulaFunctions:'Fungsi',formulaPreviewHint:'Rumus divalidasi otomatis. Pratinjau menggunakan SKU pertama pada skema harga ini.',formulaPreviewValid:'Rumus valid',formulaPreviewResult:'Hasil pratinjau',formulaPreviewSample:'SKU pratinjau',formulaPreviewEmpty:'Masukkan rumus untuk validasi dan pratinjau.',formulaPreviewNoSku:'Tidak ada data SKU; pratinjau menggunakan nilai nol.',formulaPreviewError:'Kesalahan rumus',formulaBuilderHint:'Klik kolom, fungsi, atau operator untuk menyisipkannya, atau ketik langsung. Mengisi rumus otomatis mengubah jenis kolom menjadi Rumus.',systemLandingCost:'Landing Cost Sistem',srpManualHint:'SRP dapat diedit langsung di daftar. Nilai manual menggantikan hasil rumus; kosongkan untuk kembali ke hasil rumus.',purchasePriceRmb:'Harga Beli RMB',purchasePriceUsd:'Harga Beli USD',standardPurchasePrice:'Harga Beli Standar',weightedAvgCost:'Biaya Rata-rata Tertimbang SKU',inventoryWac:'WAC Persediaan',customsRate:'Tarif Bea Cukai Referensi',inventoryQty:'Jumlah Persediaan',formulaEmpty:'Kosongkan jika SRP belum dihitung.',version:'Versi',restore:'Pulihkan versi ini',importHint:'Gunakan template untuk SRP dan kolom biaya manual. Kolom dengan sinkronisasi WAC aktif diperbarui otomatis dari WAC terkonfirmasi; stok juga disinkronkan otomatis.',importDone:'Impor Excel selesai',exportDone:'Excel diekspor',unsaved:'Ada perubahan yang belum disimpan. Tetap ganti skema?',discardChanges:'Ada perubahan yang belum disimpan. Melanjutkan akan membuang perubahan tersebut. Lanjutkan?',schemeCreated:'Skema harga dibuat',fieldSaved:'Kolom biaya disimpan',formulaSaved:'Rumus SRP disimpan',restored:'Versi sebelumnya dipulihkan',noHistory:'Belum ada riwayat versi',stop:'Nonaktifkan Skema',stopConfirm:'Nonaktifkan skema harga ini? Skema tidak akan muncul lagi di daftar.',actions:'Tindakan',deleteScheme:'Hapus Skema',deleteSchemeTitle:'Hapus Skema Harga',deleteSchemeConfirm:'Yakin ingin menghapus skema harga ini secara permanen?',deleteSchemeWarning:'Harga SKU, kolom biaya, tautan biaya WAC, dan riwayat versi untuk skema ini akan dihapus. Riwayat WAC asli tidak akan terpengaruh. Tindakan ini tidak dapat dibatalkan.',schemeDeleted:'Skema harga dihapus',selectCountry:'Pilih negara',selectBrand:'Pilih merek',enterPlatform:'Masukkan nama platform',fieldKeyHint:'Gunakan huruf kecil, angka, dan garis bawah, contoh platform_fee',saveFailed:'Gagal menyimpan',skuRequired:'Kolom SKU tidak ditemukan di Excel',missingCategories:' SKU belum memiliki kategori pada data master. Lengkapi kategori sebelum menerapkan biaya per kategori.',landingCost:'Landing Cost',selectWac:'Pilih WAC',wacHistory:'Riwayat WAC',noWacHistory:'Tidak ada riwayat WAC terkonfirmasi untuk SKU ini',latest:'Terbaru',choose:'Gunakan WAC ini',current:'Digunakan',clearLandingCost:'Hapus Landing Cost',warehouse:'Gudang',ciNo:'No. CI',confirmedAt:'Waktu Konfirmasi',inboundDate:'Tanggal Masuk',manualSrp:'Impor Manual',formulaSrp:'Rumus',syncWac:'Sinkronkan WAC Massal',syncWacTitle:'Sinkronisasi Landing Cost Massal',syncWacDesc:'Cocokkan riwayat WAC berdasarkan SKU, negara, dan merek pada skema ini. Gunakan WAC valid terbaru untuk setiap SKU. SKU tanpa kecocokan mempertahankan nilai lama.',matched:'Cocok',unmatched:'Tidak cocok',willUpdate:'Akan diperbarui',unchanged:'Tidak berubah',unmatchedSamples:'SKU tidak cocok',noWacMatch:'WAC valid tidak ditemukan. Landing Cost yang ada tidak akan diubah.',syncWacDone:'Sinkronisasi WAC massal selesai',downloadTemplate:'Unduh Template Impor',templateInstructions:'Petunjuk',templateSku:'Kode SKU dibuat oleh sistem. Jangan diubah.',templateSrp:'Isi SRP dan kolom biaya yang berlaku untuk kategori SKU. Sel kosong tidak akan mengubah data.',templateLanding:'Landing Cost tidak diimpor dari Excel. Kolom dengan sinkronisasi WAC aktif diperbarui otomatis oleh sistem.',templateStock:'Kategori hanya referensi. Stok disinkronkan otomatis.'}
};
const state={countries:[],skus:[],brands:[],schemes:[],schemeId:'',scheme:null,fields:[],rows:[],dirty:{},orderSaving:false,draggingFieldId:'',schemeCreateMode:'blank',schemeCopySourceId:''};
function tr(k){const l=typeof getLang==='function'?getLang():'zh';return (TXT[l]&&TXT[l][k])||TXT.zh[k]||k;}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmt(v){const n=Number(v);return v==null||v===''||!Number.isFinite(n)?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function cats(f){if(Array.isArray(f.applicable_categories))return f.applicable_categories;try{const x=JSON.parse(f.applicable_categories||'[]');return Array.isArray(x)?x:[];}catch(e){return [];}}
function applies(f,r){const a=cats(f);return !a.length||a.includes(String(r.category||'').trim());}
function currency(){return esc(state.scheme&&state.scheme.currency||'');}
function err(e){if(typeof showToast==='function')showToast(e&&e.message||String(e),'danger');else if(typeof showFlash==='function')showFlash(e&&e.message||String(e),'danger');}
function styles(){
 if(document.getElementById('price-system-styles'))return;
 const s=document.createElement('style');s.id='price-system-styles';
 s.textContent=[
 '#ps-root{color:#1d1d1f;font-size:13px}',
 '#ps-root .ps-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:4px 2px 14px}',
 '#ps-root .ps-title{font-size:22px;font-weight:650;letter-spacing:-.02em}',
 '#ps-root .ps-subtitle{font-size:12px;color:#86868b;margin-top:3px}',
 '#ps-root .ps-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
 '#ps-root .ps-btn{border:1px solid #d2d2d7;background:#fff;color:#333;border-radius:7px;padding:7px 11px;font:inherit;cursor:pointer;white-space:nowrap}',
 '#ps-root .ps-btn:hover{background:#f5f5f7}#ps-root .ps-btn.primary{background:#0071e3;border-color:#0071e3;color:#fff}',
 '#ps-root .ps-btn:disabled{opacity:.4;cursor:not-allowed}',
 '#ps-root .ps-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:#fff;border:1px solid #e8e8ed;border-radius:10px;padding:10px 12px;margin-bottom:10px}',
 '#ps-root .ps-toolbar label{font-size:12px;color:#777}#ps-root .ps-select{height:32px;border:1px solid #d2d2d7;border-radius:6px;background:#fff;padding:0 9px;color:#222;min-width:230px;font:inherit}',
 '#ps-root .ps-actions-menu-wrap{position:relative;display:inline-flex}#ps-root .ps-actions-toggle{display:inline-flex;align-items:center;gap:10px}#ps-root .ps-actions-caret{font-size:11px;color:inherit;transition:transform .15s}#ps-root .ps-actions-toggle[aria-expanded="true"] .ps-actions-caret{transform:rotate(180deg)}#ps-root .ps-actions-menu{position:absolute;top:calc(100% + 7px);right:0;z-index:40;min-width:205px;max-height:min(70vh,560px);overflow-y:auto;padding:5px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12)}#ps-root .ps-actions-menu[hidden]{display:none}#ps-root .ps-actions-menu button{display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:0 10px;border:0;border-radius:7px;background:#fff;color:#30343b;text-align:left;font:inherit;cursor:pointer}#ps-root .ps-actions-menu button:hover{background:#f2f6fb}#ps-root .ps-actions-menu button:disabled{opacity:.4;cursor:not-allowed}#ps-root .ps-actions-menu button.danger{color:#d93025}#ps-root .ps-actions-menu button.danger:hover{background:#fff2f0}#ps-root .ps-actions-menu .ps-menu-divider{height:1px;margin:5px 4px;background:#ececf0}#ps-root .ps-actions-menu .ps-menu-icon{width:16px;color:#727b87;text-align:center}#ps-root .ps-actions-menu button.danger .ps-menu-icon{color:#d93025}',
 '#ps-root .ps-meta{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 12px}#ps-root .ps-pill{background:#f5f5f7;color:#555;border-radius:6px;padding:4px 8px;font-size:11px}',
 '#ps-root .ps-card{background:#fff;border:1px solid #e8e8ed;border-radius:10px;overflow:hidden}#ps-root .ps-table-wrap{overflow:auto;max-height:calc(100vh - 270px);min-height:180px}',
 '#ps-root table{border-collapse:separate;border-spacing:0;width:max-content;min-width:0;table-layout:auto;font-size:12px}',
 '#ps-root th{position:sticky;top:0;z-index:2;background:#f7f7f9;color:#666;font-weight:600;text-align:center;padding:10px 9px;border-bottom:1px solid #e8e8ed;white-space:nowrap}',
 '#ps-root td{padding:7px 9px;border-bottom:1px solid #f0f0f2;white-space:nowrap;vertical-align:middle;text-align:center}#ps-root tbody tr:hover{background:#fafafa}',
 '#ps-root th:nth-child(-n+2),#ps-root td:nth-child(-n+2){position:sticky;background:#fff}',
 '#ps-root th:nth-child(1),#ps-root td:nth-child(1){left:0;width:120px;min-width:120px;max-width:120px;z-index:4}',
 '#ps-root th:nth-child(2),#ps-root td:nth-child(2){left:120px;width:170px;min-width:170px;max-width:170px;z-index:4;box-shadow:2px 0 5px rgba(0,0,0,.07)}',
 '#ps-root th:nth-child(-n+2){top:0;background:#f7f7f9;z-index:6}',
 '#ps-root tbody tr:hover td:nth-child(-n+2){background:#fafafa}',
 '#ps-root .ps-category{color:#666;text-align:center}#ps-root .ps-sku{font-weight:600;color:#252525;text-align:center}#ps-root .ps-name{color:#555;max-width:220px;overflow:hidden;text-overflow:ellipsis}',
 '#ps-root .ps-stock{text-align:center;font-variant-numeric:tabular-nums}#ps-root .ps-stock.zero{color:#ff3b30;font-weight:700}',
 '#ps-root .ps-landing{min-width:0;display:flex;align-items:center;justify-content:center;gap:8px;text-align:center}#ps-root .ps-landing-value{font-weight:650;color:#222;text-align:center}#ps-root .ps-landing-meta{font-size:9px;line-height:1.3;color:#a1a1a6;margin-top:1px}#ps-root .ps-btn.ps-mini{padding:4px 7px;font-size:11px}',
 '#ps-root .ps-value{text-align:center;font-variant-numeric:tabular-nums}#ps-root .ps-input{width:112px;height:29px;border:1px solid #dedee3;border-radius:5px;padding:3px 7px;text-align:center;font:inherit;background:#fff}',
 '#ps-root .ps-input:focus{outline:2px solid rgba(0,113,227,.18);border-color:#0071e3}#ps-root .ps-input.dirty{background:#fff8e7;border-color:#e5a000}',
 '#ps-root .ps-unit{color:#999;font-size:10px;margin-left:4px}#ps-root .ps-srp{font-weight:700;color:#1d1d1f;text-align:center}#ps-root .ps-muted{color:#aaa}#ps-root .ps-warning{margin:8px 0 12px;padding:8px 11px;border:1px solid #f3d28a;background:#fff9e8;color:#8a6500;border-radius:7px;font-size:12px}',
 '#ps-root .ps-empty{padding:42px 18px;text-align:center;color:#86868b}#ps-root .ps-empty strong{display:block;color:#444;font-size:15px;margin-bottom:6px}',
 '#ps-root .ps-bottom{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;color:#888;font-size:11px;border-top:1px solid #eee}#ps-root .ps-dirty{color:#a66b00}',
 '#ps-root .ps-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}#ps-root .ps-form-group{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}#ps-root .ps-form-group.full{grid-column:1/-1}',
 '#ps-root .ps-form-group label{font-size:12px;color:#666}#ps-root .ps-form-group input,#ps-root .ps-form-group select,#ps-root .ps-form-group textarea{width:100%;border:1px solid #d2d2d7;border-radius:6px;padding:8px 9px;font:inherit;background:#fff;color:#222}',
 '#ps-root .ps-form-group textarea{min-height:84px;resize:vertical}#ps-root .ps-help{font-size:11px;color:#999;line-height:1.6}',
 '.ps-scheme-create{width:min(100%,760px);margin:0 auto;padding:8px 12px 12px;box-sizing:border-box;color:#252a31;font-size:14px}',
 '.ps-scheme-create .ps-scheme-intro{margin:0 0 20px;color:#7b8491;font-size:13px;line-height:1.6}',
 '.ps-scheme-create .ps-scheme-mode-switch{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}',
 '.ps-scheme-create .ps-scheme-mode-switch .ps-btn{min-width:142px}',
 '.ps-scheme-create .ps-scheme-copy-help{margin:0 0 16px;padding:11px 13px;border:1px solid #e5e9ef;border-radius:8px;background:#f8fafc;color:#697586;font-size:12px;line-height:1.6}',
 '.ps-scheme-create .ps-scheme-section{padding:20px 22px 10px;border:1px solid #e5e9ef;border-radius:12px;background:#fff}',
 '.ps-scheme-create .ps-scheme-section-title{margin:0 0 18px;font-size:15px;font-weight:650;color:#252a31}',
 '.ps-scheme-create .ps-scheme-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px;row-gap:2px}',
 '.ps-scheme-create .ps-scheme-field{display:flex;min-width:0;flex-direction:column;gap:7px;margin:0 0 15px}',
 '.ps-scheme-create .ps-scheme-field label{font-size:12px;font-weight:600;color:#596273;line-height:1.4}',
 '.ps-scheme-create .ps-scheme-field input,.ps-scheme-create .ps-scheme-field select{box-sizing:border-box;width:100%;height:40px;min-width:0;padding:0 12px;border:1px solid #d9dfe8;border-radius:8px;background:#fff;color:#252a31;font:inherit;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}',
 '.ps-scheme-create .ps-scheme-field input::placeholder{color:#a0a8b4}',
 '.ps-scheme-create .ps-scheme-field input:focus,.ps-scheme-create .ps-scheme-field select:focus{border-color:#3478e5;box-shadow:0 0 0 3px rgba(52,120,229,.12)}',
 '.ps-scheme-create .ps-scheme-field .ps-scheme-help{font-size:11px;color:#929baa;line-height:1.5}',
 '.ps-scheme-create .ps-scheme-field.full{grid-column:1/-1}',
 '@media(max-width:640px){.ps-scheme-create{padding:4px 0}.ps-scheme-create .ps-scheme-section{padding:16px 14px 6px}.ps-scheme-create .ps-scheme-grid{grid-template-columns:1fr;column-gap:0}.ps-scheme-create .ps-scheme-field.full{grid-column:auto}}',
 '#ps-root .ps-form-group input[type=checkbox]{width:auto;padding:0;accent-color:#27833b}#ps-root .ps-form-group input.ps-wac-switch{appearance:none;width:38px;height:22px;border:0;border-radius:99px;background-color:#b8bec8;background-image:radial-gradient(circle,#fff 0 8px,transparent 8.5px);background-repeat:no-repeat;background-size:16px 16px;background-position:3px center;position:relative;padding:0;flex:0 0 auto;cursor:pointer;transition:background-color .15s,background-position .15s}#ps-root .ps-form-group input.ps-wac-switch:checked{background-color:#27833b;background-position:19px center}',
 '#ps-root .ps-cat-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:130px;overflow:auto;border:1px solid #eee;border-radius:6px;padding:8px}#ps-root .ps-cat-list label{display:flex;align-items:center;gap:6px;color:#555;font-size:12px}',
 '#ps-root .ps-field-list{width:100%;border-collapse:collapse;min-width:0}#ps-root .ps-field-list th,#ps-root .ps-field-list td{position:static;padding:8px;border-bottom:1px solid #eee}',
 '#modal-content.modal-price-fields{width:min(900px,calc(100vw - 32px));max-width:900px;max-height:calc(100vh - 28px);border-radius:14px;overflow:hidden}#modal-content.modal-price-field-editor{width:min(760px,calc(100vw - 32px));max-width:760px;max-height:calc(100vh - 28px);border-radius:14px;overflow:hidden}',
 '#modal-content.modal-price-fields .modal-body,#modal-content.modal-price-field-editor .modal-body{max-height:calc(100vh - 130px);overflow-y:auto;padding:18px 22px 22px}',
 '#modal-content.modal-price-fields .modal-header,#modal-content.modal-price-field-editor .modal-header{padding:17px 22px;border-bottom:1px solid #e8e8ed}',
 '#modal-content.modal-price-fields .modal-footer,#modal-content.modal-price-field-editor .modal-footer{padding:12px 22px;border-top:1px solid #e8e8ed}',
 '.ps-fields-manager{color:#20242b;font-size:13px;line-height:1.5}',
 '.ps-fields-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}',
 '.ps-fields-title{font-size:14px;font-weight:650;color:#252a33}.ps-fields-hint{margin-top:3px;color:#858d98;font-size:11px}',
 '.ps-fields-toolbar-actions{display:flex;align-items:center;gap:9px;flex-shrink:0}.ps-fields-count{color:#858d98;font-size:11px}',
 '.ps-fields-add{height:34px;padding:0 13px;border:1px solid #0071e3;border-radius:8px;background:#0071e3;color:#fff;font:inherit;font-weight:600;cursor:pointer}.ps-fields-add:hover{background:#0066cc}',
 '.ps-field-list{display:flex;flex-direction:column;gap:8px}',
 '.ps-field-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 13px;border:1px solid #e8eaef;border-radius:11px;background:#fff;transition:border-color .15s,background .15s,box-shadow .15s}',
 '.ps-field-row:hover{border-color:#d8dce3;background:#fcfcfd}.ps-field-row.is-dragging{opacity:.45}.ps-field-row.is-drag-over{border-color:#0071e3;background:#f3f8ff;box-shadow:inset 0 0 0 1px rgba(0,113,227,.12)}',
 '.ps-drag-handle{display:flex;align-items:center;justify-content:center;width:30px;height:36px;border:0;border-radius:7px;background:transparent;color:#a1a7b0;font-size:21px;line-height:1;cursor:grab;touch-action:none}.ps-drag-handle:hover{background:#f0f2f5;color:#626b78}.ps-drag-handle:active{cursor:grabbing}',
 '.ps-field-main{min-width:0}.ps-field-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.ps-field-name{min-width:0;font-size:13px;font-weight:650;color:#252a33}.ps-field-key{display:block;margin-top:2px;color:#8a919c;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
 '.ps-field-badges{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}.ps-field-badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border-radius:999px;background:#f1f3f5;color:#626b78;font-size:10px;font-weight:600;white-space:nowrap}.ps-field-badge.type-amount{background:#edf4ff;color:#3769a8}.ps-field-badge.type-percent{background:#f3efff;color:#7554a5}.ps-field-badge.type-formula{background:#f1f2f4;color:#5e6672}.ps-field-badge.is-wac{background:#edf7f0;color:#267344}.ps-field-badge.is-system{background:#fff5e7;color:#946200}',
 '.ps-field-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:8px}.ps-field-category{display:inline-flex;padding:3px 7px;border:1px solid #eceef2;border-radius:6px;background:#fafbfc;color:#737b87;font-size:10px}.ps-field-category.all{background:#f5f5f7;border-color:#f5f5f7}',
 '.ps-field-actions{display:flex;align-items:center;gap:6px}.ps-field-action{height:30px;padding:0 10px;border:1px solid #dfe3e9;border-radius:7px;background:#fff;color:#3f4752;font:inherit;font-size:12px;cursor:pointer}.ps-field-action:hover{background:#f5f7f9}.ps-field-action.danger{color:#c33;border-color:#f0d7d7}.ps-field-action.danger:hover{background:#fff5f5}',
 '.ps-fields-empty{padding:30px 16px;border:1px dashed #dfe3e9;border-radius:10px;text-align:center;color:#858d98;background:#fafbfc}.ps-fields-footnote{margin-top:12px;padding:0 2px;color:#858d98;font-size:11px}',
 '.ps-field-editor{display:flex;flex-direction:column;gap:13px;color:#20242b;font-size:13px;line-height:1.5}.ps-editor-intro{color:#858d98;font-size:12px;margin:0 1px 1px}',
 '.ps-editor-section{padding:14px 15px;border:1px solid #e8eaef;border-radius:11px;background:#fff}.ps-editor-section-title{margin-bottom:12px;color:#252a33;font-size:13px;font-weight:650}',
 '.ps-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}.ps-editor-control{display:flex;flex-direction:column;gap:6px;min-width:0}.ps-editor-control label{color:#6e7682;font-size:11px;font-weight:600}',
 '.ps-editor-control input,.ps-editor-control select,.ps-editor-control textarea{width:100%;min-height:36px;border:1px solid #dfe3e9;border-radius:8px;padding:7px 10px;background:#fff;color:#252a33;font:inherit;box-shadow:none}.ps-editor-control input:focus,.ps-editor-control select:focus,.ps-editor-control textarea:focus{outline:0;border-color:#7db4ed;box-shadow:0 0 0 3px rgba(0,113,227,.10)}.ps-editor-control input:disabled{background:#f6f7f9;color:#858d98}.ps-editor-control textarea{min-height:92px;resize:vertical}',
 '.ps-editor-help{color:#858d98;font-size:11px;line-height:1.55}.ps-category-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;max-height:190px;overflow:auto}',
 '.ps-category-chip{display:flex;align-items:center;gap:7px;min-width:0;padding:8px 9px;border:1px solid #eceef2;border-radius:8px;background:#fafbfc;color:#525b67;font-size:11px;cursor:pointer}.ps-category-chip:has(input:checked){border-color:#a9c9eb;background:#f2f8ff;color:#245e99}.ps-category-chip input{margin:0;accent-color:#0071e3}',
 '.ps-category-toolbar{display:flex;align-items:center;justify-content:flex-end;margin-bottom:7px}.ps-category-select-all{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid #dfe3e9;border-radius:7px;background:#fff;color:#3f4854;font:inherit;font-size:11px;cursor:pointer}.ps-category-select-all:hover{background:#f4f8fc;border-color:#b9cde3}.ps-category-select-all .ps-checkmark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid #b9c1cc;border-radius:4px;color:#fff;font-size:10px}.ps-category-select-all.is-all .ps-checkmark{background:#0071e3;border-color:#0071e3}',
 '.ps-percent-setting{padding:12px;border:1px solid #e8eaef;border-radius:9px;background:#fafbfc}.ps-percent-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.ps-percent-label{min-width:92px;color:#586170;font-size:12px;font-weight:600}.ps-percent-input-wrap{display:inline-flex;align-items:center;gap:0}.ps-percent-input{width:140px!important;min-height:36px;border:1px solid #dfe3e9;border-right:0;border-radius:8px 0 0 8px;padding:7px 10px;background:#fff;color:#252a33;font:inherit}.ps-percent-suffix{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:36px;border:1px solid #dfe3e9;border-radius:0 8px 8px 0;background:#f3f5f8;color:#687385}.ps-percent-apply{height:36px;padding:0 12px;border:1px solid #cfd6e0;border-radius:8px;background:#fff;color:#354052;font:inherit;font-size:12px;cursor:pointer}.ps-percent-apply:hover{border-color:#8bb9e8;background:#f3f8ff}.ps-percent-hint{margin-top:8px;color:#858d98;font-size:11px;line-height:1.55}', '.ps-editor-switch-line{display:flex;align-items:center;justify-content:space-between;gap:14px}.ps-editor-switch-copy{min-width:0}.ps-editor-switch-copy strong{display:block;color:#303743;font-size:12px}.ps-editor-switch-copy p{margin:4px 0 0;color:#858d98;font-size:11px;line-height:1.55}',
 '.ps-editor-switch-line input.ps-wac-switch{appearance:none;width:40px;height:23px;border:0;border-radius:99px;background-color:#b8bec8;background-image:radial-gradient(circle,#fff 0 8px,transparent 8.5px);background-repeat:no-repeat;background-size:16px 16px;background-position:3px center;position:relative;padding:0;flex:0 0 auto;cursor:pointer;transition:background-color .15s,background-position .15s}.ps-editor-switch-line input.ps-wac-switch:checked{background-color:#27833b;background-position:21px center}',
 '.ps-editor-formula-help{margin-top:8px;color:#858d98;font-size:11px;line-height:1.6}.ps-formula-preview{margin-top:10px;padding:10px 12px;border:1px solid #e6eaf0;border-radius:8px;background:#fafbfc;font-size:12px;line-height:1.6}.ps-formula-preview-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.ps-formula-preview-ok{color:#16803c;font-weight:650}.ps-formula-preview-result{color:#273444;font-weight:650}.ps-formula-preview-meta{margin-top:3px;color:#818a96;font-size:11px}.ps-formula-preview-error{color:#c43c3c;font-size:12px}.ps-field-modal-btn{height:34px;padding:0 14px;border:1px solid #dfe3e9;border-radius:8px;background:#fff;color:#4b5563;font:inherit;font-size:12px;cursor:pointer}.ps-field-modal-btn.primary{background:#0071e3;border-color:#0071e3;color:#fff;font-weight:600}.ps-field-modal-btn:hover{filter:brightness(.98)}',
 '.ps-formula-palette{display:flex;flex-direction:column;gap:10px;margin-bottom:10px}.ps-formula-palette-title{margin-bottom:6px;color:#6e7682;font-size:11px;font-weight:650}.ps-formula-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:118px;overflow:auto;padding:1px}.ps-formula-token{display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:4px 8px;border:1px solid #e3e7ed;border-radius:7px;background:#f8fafc;color:#3e4855;font:inherit;font-size:11px;cursor:pointer}.ps-formula-token:hover{border-color:#8bb9e8;background:#f0f7ff;color:#145c9e}.ps-formula-token code{color:#7d8794;font-size:10px}.ps-formula-operators .ps-formula-token{min-width:31px;justify-content:center;font-size:14px;font-weight:650}.ps-formula-empty{color:#9aa1aa;font-size:11px;padding:5px 0}',
 '.ps-category-formula-list{display:flex;flex-direction:column;gap:10px}.ps-category-formula-row{border:1px solid #e5e9ef;border-radius:9px;padding:10px;background:#fff}.ps-category-formula-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;color:#303743;font-size:12px}.ps-category-formula-input{width:100%;min-height:64px;resize:vertical;border:1px solid #dfe3e9;border-radius:7px;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#263445;background:#fbfcfe}.ps-category-formula-input:focus{outline:none;border-color:#6aa5e8;box-shadow:0 0 0 2px rgba(0,113,227,.1)}.ps-category-formula-preview{margin-top:6px;color:#818a96;font-size:11px;min-height:16px}',
 '.ps-formula-rules-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.ps-formula-rules-title .ps-btn{font-size:12px;padding:6px 10px}.ps-formula-rules-list{display:flex;flex-direction:column;gap:12px}.ps-formula-rule-card{border:1px solid #dfe5ee;border-radius:10px;padding:11px;background:#fff}.ps-formula-rule-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;color:#303743}.ps-formula-rule-top>div{display:flex;gap:8px}.ps-formula-rule-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(300px,1fr);gap:10px}.ps-formula-rule-editor,.ps-formula-rule-categories{border:1px solid #e3e8f0;border-radius:9px;padding:10px;min-width:0}.ps-formula-rule-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.ps-formula-rule-input{width:100%;min-height:112px;resize:vertical;border:1px solid #d9e0ea;border-radius:8px;padding:10px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#263445;background:#fbfcfe}.ps-formula-rule-input:focus,.ps-rule-category-search:focus{outline:none;border-color:#6aa5e8;box-shadow:0 0 0 2px rgba(0,113,227,.1)}.ps-formula-rule-preview{margin-top:7px;min-height:16px;color:#818a96;font-size:11px}.ps-rule-category-search{width:100%;height:31px;margin-top:8px;border:1px solid #dfe3e9;border-radius:7px;padding:5px 9px;font:inherit;font-size:12px}.ps-rule-category-toolbar{display:flex;align-items:center;gap:12px;margin:7px 0;color:#1671c9;font-size:12px}.ps-rule-category-toolbar button{border:0;background:none;padding:0;color:#1671c9;cursor:pointer}.ps-rule-category-toolbar span{margin-left:auto;color:#818a96}.ps-rule-category-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 10px;border:1px solid #e5e9ef;border-radius:8px;padding:8px;max-height:125px;overflow:auto}.ps-rule-category-option{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px;cursor:pointer}.ps-rule-category-option.is-disabled{opacity:.4;cursor:not-allowed}.ps-rule-category-option input{accent-color:#1677df}.ps-formula-rule-summary{display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px 10px;border:1px solid #e5e9ef;border-radius:8px;background:#f8fafc;min-width:0}.ps-formula-rule-summary>strong{white-space:nowrap;font-size:11px}.ps-formula-rule-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}.ps-rule-category-chip{border:1px solid #d4e3f4;background:#eef6ff;color:#34516e;border-radius:6px;padding:3px 7px;font:inherit;font-size:11px;cursor:pointer}.ps-rule-category-chip span{margin-left:4px;color:#6f8195}.ps-formula-rule-summary-note{margin-left:auto;color:#818a96;font-size:11px;white-space:nowrap}.ps-formula-rule-card .ps-field-action.danger{color:#c43b36}@media(max-width:760px){.ps-formula-rule-grid{grid-template-columns:1fr}.ps-formula-rule-summary{align-items:flex-start;flex-wrap:wrap}.ps-formula-rule-summary-note{width:100%;margin-left:0}.ps-rule-category-list{grid-template-columns:1fr}}',
 '@media(max-width:640px){#modal-content.modal-price-fields .modal-body,#modal-content.modal-price-field-editor .modal-body{padding:13px}.ps-fields-toolbar{align-items:flex-start;flex-direction:column}.ps-field-row{grid-template-columns:30px minmax(0,1fr);gap:8px}.ps-field-actions{grid-column:2;justify-content:flex-end}.ps-field-top{align-items:flex-start;flex-direction:column}.ps-field-badges{justify-content:flex-start}.ps-editor-grid,.ps-category-chips{grid-template-columns:1fr}.ps-editor-switch-line{align-items:flex-start}}',
 '#ps-root .ps-version{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eee}#ps-root .ps-version-meta{color:#888;font-size:11px;margin-top:3px}',
 '@media(max-width:900px){#ps-root .ps-head{flex-direction:column}#ps-root .ps-table-wrap{max-height:none}#ps-root .ps-select{min-width:180px}}'
 ].join('');
 document.head.appendChild(s);
}
function navI18n(){
 if(typeof window.t!=='function'||window.__priceSystemNavTranslationSet)return;
 const old=window.t;
 window.t=function(key,fallback,vars){if(key==='nav.price_system'){const l=typeof getLang==='function'?getLang():'zh';return l==='en'?'Price System':(l==='id'?'Sistem Harga':'价格体系');}return old(key,fallback,vars);};
 window.__priceSystemNavTranslationSet=true;
}
function shell(){
 const root=document.getElementById('content-inner');if(!root)return;
 root.innerHTML='<div id="flash-container"></div><div id="ps-root"><div id="ps-main"><div class="ps-empty">'+tr('loading')+'</div></div><input id="ps-import-file" type="file" accept=".xlsx,.xls" style="display:none" onchange="psHandleImport(this)"></div>';
 if(!window.__psActionsMenuDismissBound){document.addEventListener('click',function(e){if(!e.target.closest||!e.target.closest('.ps-actions-menu-wrap'))window.psCloseActionsMenu&&window.psCloseActionsMenu();});window.__psActionsMenuDismissBound=true;}
}
async function meta(){
 const r=await Promise.all([api('/api/countries').catch(()=>[]),api('/api/skus').catch(()=>[])]);
 state.countries=(r[0]||[]).filter(c=>c.status!=='disabled');state.skus=r[1]||[];
 state.brands=Array.from(new Set(state.skus.map(s=>String(s.brand||'').trim()).filter(Boolean))).sort();
}
async function loadSchemes(preferred){
 state.schemes=await api('/api/price-system/schemes');
 if(preferred&&state.schemes.some(s=>s.id===preferred))state.schemeId=preferred;
 else if(!state.schemes.some(s=>s.id===state.schemeId))state.schemeId=state.schemes.length?state.schemes[0].id:'';
 if(state.schemeId)await loadData(state.schemeId);else{state.scheme=null;state.fields=[];state.rows=[];state.dirty={};main();}
}
async function loadData(id){
 state.schemeId=id||'';state.dirty={};state.scheme=null;state.fields=[];state.rows=[];main();if(!id)return;
 try{const d=await api('/api/price-system/schemes/'+encodeURIComponent(id)+'/data');if(state.schemeId!==id)return;state.scheme=d.scheme;state.fields=d.fields||[];state.rows=d.rows||[];main();}
 catch(e){err(e);main();}
}
async function refreshDataPreservingDirty(id){
 const dirty=state.dirty;const d=await api('/api/price-system/schemes/'+encodeURIComponent(id)+'/data');if(state.schemeId!==id)return;
 state.scheme=d.scheme;state.fields=d.fields||[];state.rows=d.rows||[];state.dirty=dirty;main();
}
function schemeLabel(s){return [s.country,s.brand,s.platform,s.shop_name].filter(Boolean).join(' / ');}
function allowDiscardDirty(){const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);if(!n)return true;if(!confirm(tr('discardChanges')))return false;state.dirty={};main();return true;}
function fieldText(v,f){
 if(v==null||v==='')return '—';
 const format=String(f.display_format||'auto'),places=Math.max(0,Math.min(6,Number.isFinite(Number(f.decimal_places))?Number(f.decimal_places):2));
 const raw=Number(v);if(!Number.isFinite(raw))return '—';
 const number=value=>value.toLocaleString('en-US',{minimumFractionDigits:places,maximumFractionDigits:places});
 if(format==='percent')return number(f.field_type==='formula'?raw*100:raw)+'%';
 if(format==='amount')return (f.unit?esc(f.unit):currency())+' '+number(raw);
 if(format==='number')return number(raw);
 const n=fmt(v);
 if(f.field_type==='percent')return n+'%';
 if(f.field_type==='amount')return (f.unit?esc(f.unit):currency())+' '+n;
 return f.unit?n+' '+esc(f.unit):n;
}
function main(){
 const el=document.getElementById('ps-main');if(!el)return;
 if(!state.schemes.length){el.innerHTML='<div class="ps-card"><div class="ps-empty"><strong>'+tr('emptyTitle')+'</strong>'+tr('emptyHint')+'<div style="margin-top:15px"><button class="ps-btn primary" onclick="psOpenSchemeModal()">＋ '+tr('newScheme')+'</button></div></div></div>';return;}
 const opts=state.schemes.map(s=>'<option value="'+esc(s.id)+'" '+(s.id===state.schemeId?'selected':'')+'>'+esc(schemeLabel(s))+'</option>').join('');
 const scheme=state.scheme;
  const acts='<button class="ps-btn" onclick="psOpenFieldsModal()" '+(!scheme?'disabled':'')+'>'+tr('fields')+'</button><div class="ps-actions-menu-wrap"><button type="button" class="ps-btn primary ps-actions-toggle" aria-haspopup="true" aria-expanded="false" onclick="psToggleActionsMenu(event)">'+tr('actions')+' <span class="ps-actions-caret">⌄</span></button><div class="ps-actions-menu" id="ps-actions-menu" hidden><button type="button" onclick="psCloseActionsMenu();psOpenSchemeModal()"><span class="ps-menu-icon">＋</span>'+tr('newScheme')+'</button><div class="ps-menu-divider"></div><button type="button" onclick="psCloseActionsMenu();psOpenVersionsModal()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">◷</span>'+tr('history')+'</button><button type="button" onclick="psCloseActionsMenu();psDeactivateScheme()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">Ⅱ</span>'+tr('stop')+'</button><div class="ps-menu-divider"></div><button type="button" onclick="psCloseActionsMenu();psClickImport()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">↑</span>'+tr('import')+'</button><button type="button" onclick="psCloseActionsMenu();psDownloadImportTemplate()" '+(!scheme||!state.rows.length?'disabled':'')+'><span class="ps-menu-icon">↓</span>'+tr('downloadTemplate')+'</button><button type="button" onclick="psCloseActionsMenu();psExportExcel()" '+(!scheme||!state.rows.length?'disabled':'')+'><span class="ps-menu-icon">⇩</span>'+tr('export')+'</button><div class="ps-menu-divider"></div><button type="button" id="ps-save-btn" onclick="psCloseActionsMenu();psSaveChanges()" disabled><span class="ps-menu-icon">✓</span>'+tr('save')+'</button><div class="ps-menu-divider"></div><button type="button" class="danger" onclick="psCloseActionsMenu();psDeleteScheme()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">×</span>'+tr('deleteScheme')+'</button></div></div>';
 let html='<div class="ps-toolbar"><label>'+tr('scheme')+'</label><select class="ps-select" onchange="psSelectScheme(this.value)">'+opts+'</select><div style="margin-left:auto;display:flex;align-items:center;gap:7px;flex-wrap:wrap">'+acts+'</div></div>';
 if(!scheme){html+='<div class="ps-card"><div class="ps-empty">'+tr('loading')+'</div></div>';el.innerHTML=html;return;}
 html+='<div class="ps-meta"><span class="ps-pill">'+tr('country')+': '+esc(scheme.country)+'</span><span class="ps-pill">'+tr('brand')+': '+esc(scheme.brand)+'</span><span class="ps-pill">'+tr('platform')+': '+esc(scheme.platform)+'</span>'+(scheme.shop_name?'<span class="ps-pill">'+tr('shop')+': '+esc(scheme.shop_name)+'</span>':'')+'<span class="ps-pill">'+tr('currency')+': '+esc(scheme.currency||'')+'</span><span class="ps-pill">'+state.rows.length+' SKU</span></div>';
 const missingCategoryCount=state.rows.filter(r=>!String(r.category||'').trim()||String(r.category||'').trim()==='未分类').length;
 if(missingCategoryCount) html+='<div class="ps-warning">'+missingCategoryCount+tr('missingCategories')+'</div>';
 if(!state.rows.length){html+='<div class="ps-card"><div class="ps-empty"><strong>'+tr('noData')+'</strong></div></div>';el.innerHTML=html;return;}
  const head='<th>'+tr('category')+'</th><th>'+tr('sku')+'</th><th>'+tr('stock')+'</th>'+state.fields.map(f=>'<th title="'+esc(f.formula||'')+'">'+esc(f.field_name)+(f.display_format==='percent'?'<span class="ps-unit">%</span>':((f.display_format==='amount'||(f.display_format!=='number'&&f.display_format!=='percent'&&(f.unit||f.field_type==='amount')))?'<span class="ps-unit">'+esc(f.unit||scheme.currency||'')+'</span>':''))+'</th>').join('');
  const rows=state.rows.map(r=>{
   const cells=state.fields.map(f=>{
    if(!applies(f,r))return '<td class="ps-value ps-muted">&mdash;</td>';
    const v=r.values?r.values[f.field_key]:null;
    if(f.field_key==='srp'){
     const dirty=state.dirty[r.sku_code]&&Object.prototype.hasOwnProperty.call(state.dirty[r.sku_code],'srp');const shown=dirty?state.dirty[r.sku_code].srp:r.srp;
     return '<td class="ps-value ps-srp"><input class="ps-input ps-srp-input '+(dirty?'dirty':'')+'" type="number" min="0" step="0.01" value="'+(shown==null?'':esc(shown))+'" data-sku="'+esc(r.sku_code)+'" data-field="srp" oninput="psMarkDirty(this)" title="'+esc(tr('srpManualHint'))+'"><span class="ps-unit">'+currency()+'</span></td>';
    }
    if(Number(f.sync_wac||0)===1){const lc=r.landing_cost||null,unit=(lc&&lc.currency)||f.unit||scheme.currency||'';const rawDate=lc&&(lc.last_inbound_date||lc.confirmed_at)||'',wacDate=String(rawDate).slice(0,10),meta=wacDate?esc(wacDate):'';return '<td class="ps-value" title="'+meta+'"><div class="ps-landing-value">'+(v==null?'&mdash;':esc(unit)+' '+fmt(v))+'</div>'+(meta?'<div class="ps-landing-meta">'+meta+'</div>':'')+'</td>';}
    if(f.field_type==='formula'){const shown=f.field_key==='srp'?(v==null?'&mdash;':esc(scheme.currency||'')+' '+fmt(v)):fieldText(v,f);return '<td class="ps-value" title="'+esc(r.formula_errors&&r.formula_errors[f.field_key]||f.formula||'')+'">'+(r.formula_errors&&r.formula_errors[f.field_key]?'<span style="color:#d97706">!</span> ':'')+shown+'</td>';}
    const dirty=state.dirty[r.sku_code]&&Object.prototype.hasOwnProperty.call(state.dirty[r.sku_code],f.field_key);const shown=dirty?state.dirty[r.sku_code][f.field_key]:v;return '<td class="ps-value"><input class="ps-input '+(dirty?'dirty':'')+'" type="number" step="0.01" value="'+(shown==null?'':esc(shown))+'" data-sku="'+esc(r.sku_code)+'" data-field="'+esc(f.field_key)+'" oninput="psMarkDirty(this)" title="'+esc(f.unit||scheme.currency||'')+'">'+(f.field_type==='percent'?'<span class="ps-unit">%</span>':(f.field_type==='amount'?'<span class="ps-unit">'+esc(f.unit||scheme.currency||'')+'</span>':(f.unit?'<span class="ps-unit">'+esc(f.unit)+'</span>':'')))+'</td>';
   }).join('');
   return '<tr><td class="ps-category">'+(r.category?esc(r.category):'&mdash;')+'</td><td class="ps-sku">'+esc(r.sku_code)+'</td><td class="ps-stock '+(Number(r.stock_qty)===0?'zero':'')+'">'+Number(r.stock_qty||0).toLocaleString('en-US')+'</td>'+cells+'</tr>';
  }).join('');
 const dirtyCount=Object.keys(state.dirty).reduce((n,k)=>n+Object.keys(state.dirty[k]||{}).length,0);
 html+='<div class="ps-card"><div class="ps-table-wrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table></div><div class="ps-bottom"><span>'+tr('importHint')+'</span><span class="'+(dirtyCount?'ps-dirty':'')+'">'+(dirtyCount?dirtyCount+' unsaved':'')+'</span></div></div>';
 el.innerHTML=html;updateSave();
}
function updateSave(){const b=document.getElementById('ps-save-btn');if(!b)return;const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);b.disabled=!n;b.innerHTML='<span class="ps-menu-icon">✓</span>'+tr('save')+(n?' ('+n+')':'');}
window.psSelectScheme=async function(id){const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);if(n&&!confirm(tr('unsaved'))){main();return;}await loadData(id);};
window.psMarkDirty=function(input){const sku=input.getAttribute('data-sku'),key=input.getAttribute('data-field');if(!state.dirty[sku])state.dirty[sku]={};state.dirty[sku][key]=input.value===''?null:Number(input.value);input.classList.add('dirty');updateSave();const b=document.querySelector('#ps-root .ps-bottom span:last-child');if(b){const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);b.textContent=n?n+' unsaved':'';b.classList.toggle('ps-dirty',n>0);}};
window.psSaveChanges=async function(){const rows=Object.keys(state.dirty).map(sku=>{const values=Object.assign({},state.dirty[sku]||{}),row={sku_code:sku,values};if(Object.prototype.hasOwnProperty.call(values,'srp')){row.srp=values.srp;delete row.values.srp;}return row;}).filter(row=>Object.keys(row.values).length||Object.prototype.hasOwnProperty.call(row,'srp'));if(!rows.length)return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/values','POST',{rows});state.dirty={};if(typeof showToast==='function')showToast(tr('saved'),'success');await loadSchemes(state.schemeId);}catch(e){err(e);updateSave();}};
function readSchemeCreateFormValues(){
 return {
  country:document.getElementById('ps-country')?.value||'',
  brand:document.getElementById('ps-brand')?.value||'',
  platform:document.getElementById('ps-platform')?.value||'',
  shop_name:document.getElementById('ps-shop')?.value||'',
  currency:document.getElementById('ps-currency')?.value||'',
  sourceId:document.getElementById('ps-copy-source')?.value||state.schemeCopySourceId||''
 };
}
function renderSchemeCreateModal(values){
 const v=values||{};
 const mode=state.schemeCreateMode==='copy'?'copy':'blank';
 const countries=state.countries.map(x=>'<option value="'+esc(x.name)+'" data-currency="'+esc(x.default_currency||'')+'" '+(x.name===v.country?'selected':'')+'>'+esc(x.name)+'</option>').join('');
 const brands=state.brands.map(x=>'<option value="'+esc(x)+'" '+(x===v.brand?'selected':'')+'>'+esc(x)+'</option>').join('');
 const sourceSchemes=state.schemes.slice().sort((a,b)=>schemeLabel(a).localeCompare(schemeLabel(b)));
 if(!state.schemeCopySourceId&&sourceSchemes.length)state.schemeCopySourceId=sourceSchemes[0].id;
 const sourceId=v.sourceId||state.schemeCopySourceId||'';
 const sourceOptions=sourceSchemes.map(s=>'<option value="'+esc(s.id)+'" '+(String(s.id)===String(sourceId)?'selected':'')+'>'+esc(schemeLabel(s))+'</option>').join('');
 const modeSwitch='<div class="ps-scheme-mode-switch"><button type="button" class="ps-btn '+(mode==='blank'?'primary':'')+'" onclick="psSetSchemeCreateMode(\'blank\')">'+tr('blankScheme')+'</button><button type="button" class="ps-btn '+(mode==='copy'?'primary':'')+'" onclick="psSetSchemeCreateMode(\'copy\')" '+(!sourceSchemes.length?'disabled':'')+'>'+tr('copyScheme')+'</button></div>';
 const sourceSection=mode==='copy'
  ? '<section class="ps-scheme-section" style="margin-bottom:14px"><h3 class="ps-scheme-section-title">'+tr('copyScheme')+'</h3><div class="ps-scheme-grid"><div class="ps-scheme-field full"><label for="ps-copy-source">'+tr('copySource')+'</label><select id="ps-copy-source" onchange="psCopySourceChanged()"><option value="">'+tr('copySourcePlaceholder')+'</option>'+sourceOptions+'</select></div></div></section><p class="ps-scheme-copy-help">'+tr('copySchemeHelp')+'</p>'
  : '';
 const body='<div class="ps-scheme-create"><p class="ps-scheme-intro">'+tr('subtitle')+'</p>'+modeSwitch+sourceSection+'<section class="ps-scheme-section"><h3 class="ps-scheme-section-title">'+tr('basicInfo')+'</h3><div class="ps-scheme-grid"><div class="ps-scheme-field"><label for="ps-country">'+tr('country')+'</label><select id="ps-country" onchange="psCountryChanged()"><option value="">'+tr('selectCountry')+'</option>'+countries+'</select></div><div class="ps-scheme-field"><label for="ps-brand">'+tr('brand')+'</label><select id="ps-brand"><option value="">'+tr('selectBrand')+'</option>'+brands+'</select></div><div class="ps-scheme-field"><label for="ps-platform">'+tr('platform')+'</label><input id="ps-platform" value="'+esc(v.platform||'')+'" placeholder="Shopee / TikTok Shop / Tokopedia"></div><div class="ps-scheme-field"><label for="ps-shop">'+tr('shop')+'</label><input id="ps-shop" value="'+esc(v.shop_name||'')+'" placeholder="Store name (optional)"></div><div class="ps-scheme-field"><label for="ps-currency">'+tr('currency')+'</label><input id="ps-currency" value="'+esc(v.currency||'')+'" placeholder="IDR / MYR / THB / SGD"><span class="ps-scheme-help">根据所选国家自动带入默认币种，也可以手动调整</span></div></div></section></div>';
 const submitLabel=mode==='copy'?tr('copyAndCreate'):tr('confirm');
 openModal(tr('newScheme'),body,'<button class="btn btn-secondary" onclick="closeModal()">'+tr('cancel')+'</button><button class="btn btn-primary" onclick="psSaveScheme()">'+submitLabel+'</button>');
}
window.psOpenSchemeModal=function(){
 if(!allowDiscardDirty())return;
 state.schemeCreateMode='blank';
 state.schemeCopySourceId=state.schemes.length?state.schemes[0].id:'';
 renderSchemeCreateModal({});
};
window.psSetSchemeCreateMode=function(mode){
 if(mode==='copy'&&!state.schemes.length)return;
 const values=readSchemeCreateFormValues();
 state.schemeCreateMode=mode==='copy'?'copy':'blank';
 if(state.schemeCreateMode==='copy'){
  const source=state.schemes.find(s=>String(s.id)===String(values.sourceId))||state.schemes[0];
  values.sourceId=source?source.id:'';
  if(source&&!values.brand)values.brand=source.brand||'';
  state.schemeCopySourceId=values.sourceId;
 }
 renderSchemeCreateModal(values);
};
window.psCopySourceChanged=function(){
 const sourceId=document.getElementById('ps-copy-source')?.value||'';
 state.schemeCopySourceId=sourceId;
 const source=state.schemes.find(s=>String(s.id)===String(sourceId));
 const brand=document.getElementById('ps-brand');
 if(source&&brand&&!brand.value)brand.value=source.brand||'';
};
window.psCountryChanged=function(){const s=document.getElementById('ps-country'),o=s&&s.options[s.selectedIndex],c=document.getElementById('ps-currency');if(o&&c&&!c.value)c.value=o.getAttribute('data-currency')||'';};
window.psSaveScheme=async function(){
 const country=document.getElementById('ps-country')?.value||'';
 const brand=document.getElementById('ps-brand')?.value||'';
 const platform=document.getElementById('ps-platform')?.value.trim()||'';
 const shop_name=document.getElementById('ps-shop')?.value.trim()||'';
 const currencyValue=document.getElementById('ps-currency')?.value.trim()||'';
 const isCopy=state.schemeCreateMode==='copy';
 const sourceId=isCopy?(document.getElementById('ps-copy-source')?.value||''):'';
 if(isCopy&&!sourceId){err(new Error(tr('copySourceRequired')));return;}
 if(!country||!brand||!platform){err(new Error(!country?tr('selectCountry'):(!brand?tr('selectBrand'):tr('enterPlatform'))));return;}
 try{
  const endpoint=isCopy?'/api/price-system/schemes/'+encodeURIComponent(sourceId)+'/copy':'/api/price-system/schemes';
  const x=await api(endpoint,'POST',{country,brand,platform,shop_name,currency:currencyValue});
  closeModal();
  await loadSchemes(x.id);
  if(typeof showToast==='function')showToast(isCopy?tr('copySchemeCreated'):tr('schemeCreated'),'success');
 }catch(e){err(e);}
};
window.psOpenFieldsModal=function(){
 if(!state.scheme||!allowDiscardDirty())return;
 const rows=state.fields.map(f=>{
  const typeKey=f.field_type==='amount'?'amount':(f.field_type==='percent'?'percent':(f.field_type==='formula'?'calc':'number'));
  const typeClass=f.field_type==='amount'?'type-amount':(f.field_type==='percent'?'type-percent':(f.field_type==='formula'?'type-formula':''));
  const ruleCategories=f.field_type==='formula'&&f.formula_rules?Object.keys(typeof f.formula_rules==='string'?JSON.parse(f.formula_rules||'{}'):f.formula_rules||{}):[];
  const displayCategories=ruleCategories.length?ruleCategories:cats(f);
  const categoryTags=displayCategories.length?displayCategories.map(c=>'<span class="ps-field-category">'+esc(c)+'</span>').join(''):'<span class="ps-field-category all">'+tr('allCategories')+'</span>';
  const badges='<span class="ps-field-badge '+typeClass+'">'+tr(typeKey)+'</span>'+(Number(f.sync_wac||0)===1?'<span class="ps-field-badge is-wac">'+tr('wacSource')+'</span>':'')+(f.is_builtin_srp?'<span class="ps-field-badge is-system">'+tr('systemField')+'</span>':'');
  const remove=f.is_builtin_srp?'':'<button type="button" class="ps-field-action danger" onclick="psDeleteField(\''+esc(f.id)+'\')">'+tr('delete')+'</button>';
  return '<div class="ps-field-row" data-field-id="'+esc(f.id)+'" ondragover="psFieldDragOver(event,this)" ondragleave="psFieldDragLeave(event,this)" ondrop="psFieldDrop(event,this)"><button type="button" class="ps-drag-handle" draggable="'+(state.orderSaving?'false':'true')+'" title="'+tr('fieldOrderHint')+'" aria-label="'+tr('fieldOrderHint')+'" ondragstart="psFieldDragStart(event,\''+esc(f.id)+'\')" ondragend="psFieldDragEnd(event)">⠿</button><div class="ps-field-main"><div class="ps-field-top"><div><div class="ps-field-name">'+esc(priceFieldDisplayName(f))+'</div><code class="ps-field-key">'+esc(f.field_key)+'</code></div><div class="ps-field-badges">'+badges+'</div></div><div class="ps-field-meta">'+categoryTags+'</div></div><div class="ps-field-actions"><button type="button" class="ps-field-action" onclick="psOpenFieldEditor(\''+esc(f.id)+'\')">'+tr('edit')+'</button>'+remove+'</div></div>';
 }).join('');
 const list=rows||'<div class="ps-fields-empty">'+tr('noFields')+'</div>';
 const body='<div class="ps-fields-manager"><div class="ps-fields-toolbar"><div><div class="ps-fields-title">'+tr('fieldOrderTitle')+'</div><div class="ps-fields-hint">'+(state.orderSaving?tr('savingOrder'):tr('fieldOrderHint'))+'</div></div><div class="ps-fields-toolbar-actions"><span class="ps-fields-count">'+state.fields.length+' '+tr('fieldCount')+'</span><button type="button" class="ps-fields-add" onclick="psOpenFieldEditor()" '+(state.orderSaving?'disabled':'')+'>＋ '+tr('add')+'</button></div></div><div class="ps-field-list">'+list+'</div><div class="ps-fields-footnote">'+tr('fieldOrderHint')+'</div></div>';
 const footer='<button type="button" class="ps-field-modal-btn" onclick="closeModal()">'+tr('close')+'</button>';
 openModal(tr('fields'),body,footer,'modal-lg');
 const modal=document.getElementById('modal-content');if(modal)modal.classList.add('modal-price-fields');
};
window.psFieldDragStart=function(e,id){
 if(state.orderSaving){e.preventDefault();return;}
 state.draggingFieldId=String(id||'');
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',state.draggingFieldId);}
 const row=e.target&&e.target.closest?e.target.closest('.ps-field-row'):null;if(row)row.classList.add('is-dragging');
};
window.psFieldDragOver=function(e,row){
 if(!state.draggingFieldId||state.orderSaving)return;
 e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';
 document.querySelectorAll('#modal-content.modal-price-fields .ps-field-row.is-drag-over').forEach(x=>x.classList.remove('is-drag-over'));
 if(row&&row.getAttribute('data-field-id')!==state.draggingFieldId)row.classList.add('is-drag-over');
};
window.psFieldDragLeave=function(e,row){if(row&&(!e.relatedTarget||!row.contains(e.relatedTarget)))row.classList.remove('is-drag-over');};
window.psFieldDragEnd=function(){
 state.draggingFieldId='';
 document.querySelectorAll('#modal-content.modal-price-fields .ps-field-row').forEach(x=>x.classList.remove('is-dragging','is-drag-over'));
};
window.psFieldDrop=function(e,row){
 e.preventDefault();if(state.orderSaving||!state.draggingFieldId||!row)return;
 const from=state.fields.findIndex(f=>String(f.id)===state.draggingFieldId),target=state.fields.findIndex(f=>String(f.id)===String(row.getAttribute('data-field-id')));
 if(from<0||target<0){window.psFieldDragEnd();return;}
 const rect=row.getBoundingClientRect(),after=e.clientY>rect.top+rect.height/2;
 let insertAt=target+(after?1:0);if(from<insertAt)insertAt--;
 const next=state.fields.slice(),moved=next.splice(from,1)[0];next.splice(Math.max(0,Math.min(insertAt,next.length)),0,moved);
 window.psFieldDragEnd();if(next.every((f,i)=>f.id===state.fields[i].id))return;
 window.psPersistFieldOrder(next);
};
window.psPersistFieldOrder=async function(next){
 if(state.orderSaving)return;
 const previous=state.fields.slice();state.orderSaving=true;
 state.fields=next.map((f,i)=>Object.assign({},f,{sort_order:(i+1)*10}));
 window.psOpenFieldsModal();
 try{
  await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/fields/order','PUT',{field_ids:state.fields.map(f=>f.id)});
  state.orderSaving=false;main();window.psOpenFieldsModal();
  if(typeof showToast==='function')showToast(tr('orderSaved'),'success');
 }catch(e){state.fields=previous;state.orderSaving=false;main();window.psOpenFieldsModal();err(e);}
};
const FORMULA_BASE_FIELDS=[
 {key:'purchase_price_rmb',label:'purchasePriceRmb'},
 {key:'purchase_price_usd',label:'purchasePriceUsd'},
 {key:'standard_purchase_price',label:'standardPurchasePrice'},
 {key:'weighted_avg_cost',label:'weightedAvgCost'},
 {key:'inventory_wac',label:'inventoryWac'},
 {key:'reference_customs_rate',label:'customsRate'},
 {key:'landing_cost',label:'systemLandingCost'},
 {key:'stock_qty',label:'stock'}
];
function priceFieldDisplayName(field){return String(field&&field.field_name||'');}
function formulaTokenLabel(token){
 const builtin=FORMULA_BASE_FIELDS.find(x=>x.key===token);
 if(builtin)return tr(builtin.label);
 if(token==='srp')return 'SRP';
 const field=state.fields.find(x=>x.field_key===token);
 return field?priceFieldDisplayName(field):token;
}
function formulaDisplayExpression(expression){
 let result=String(expression||'');
 const tokens=FORMULA_BASE_FIELDS.map(x=>[x.key,tr(x.label)]).concat(state.fields.map(x=>[x.field_key,priceFieldDisplayName(x)||x.field_key]),[['srp','SRP']]);
 tokens.sort((a,b)=>b[0].length-a[0].length);
 tokens.forEach(([key,label])=>{
  if(key&&key!==label)result=result.replace(new RegExp('(^|[^A-Za-z0-9_])'+key+'(?=$|[^A-Za-z0-9_])','g'),'$1'+label);
 });
 return result;
}
function formulaBuilderHtml(field){
 const excluded=field&&field.field_key||'';
 const baseKeys=new Set(FORMULA_BASE_FIELDS.map(x=>x.key));
 const base=FORMULA_BASE_FIELDS.map(x=>"<button type=\"button\" class=\"ps-formula-token\" onclick=\"psInsertFormulaToken('"+x.key+"')\">"+tr(x.label)+"</button>").join('');
 const customFields=state.fields.filter(x=>x.field_key!==excluded&&x.field_key!=='srp'&&!x.is_builtin_srp&&!baseKeys.has(x.field_key)&&x.field_key!=='inventory_qty'&&Number(x.sync_wac||0)!==1);
 const custom=customFields.length?customFields.map(x=>"<button type=\"button\" class=\"ps-formula-token\" title=\""+esc(priceFieldDisplayName(x))+"\" onclick=\"psInsertFormulaToken('"+esc(x.field_key)+"')\">"+esc(priceFieldDisplayName(x))+"</button>").join(''):'<span class="ps-formula-empty">'+tr('formulaNoFeeFields')+'</span>';
 const price=excluded==='srp'?'':"<button type=\"button\" class=\"ps-formula-token\" onclick=\"psInsertFormulaToken('srp')\">SRP</button>";
 const functions=['MIN','MAX'].map(x=>"<button type=\"button\" class=\"ps-formula-token\" onclick=\"psInsertFormulaToken('"+x+"')\">"+x+"( )</button>").join('');
 const operators=['+','-','*','/','(',')','%'].map(x=>"<button type=\"button\" class=\"ps-formula-token\" onclick=\"psInsertFormulaToken('"+x+"')\">"+(x==='*'?'×':(x==='/'?'÷':x))+"</button>").join('');
 return '<div class="ps-formula-palette"><div><div class="ps-formula-palette-title">'+tr('formulaBaseFields')+'</div><div class="ps-formula-chips">'+base+'</div></div><div><div class="ps-formula-palette-title">'+tr('formulaFeeFields')+'</div><div class="ps-formula-chips">'+custom+'</div></div>'+(price?'<div><div class="ps-formula-palette-title">'+tr('formulaPriceFields')+'</div><div class="ps-formula-chips">'+price+'</div></div>':'')+'<div><div class="ps-formula-palette-title">'+tr('formulaFunctions')+'</div><div class="ps-formula-chips ps-formula-functions">'+functions+'</div></div><div><div class="ps-formula-palette-title">'+tr('formulaOperators')+'</div><div class="ps-formula-chips ps-formula-operators">'+operators+'</div></div></div>';
}
window.psInsertFormulaToken=function(token){
 const active=document.activeElement;
 if(active&&active.classList&&(active.classList.contains('ps-category-formula-input')||active.classList.contains('ps-formula-rule-input')))window.__psFormulaTargetInput=active;
 const remembered=window.__psFormulaTargetInput;
 const isRuleInput=el=>el&&el.classList&&(el.classList.contains('ps-category-formula-input')||el.classList.contains('ps-formula-rule-input'));
 const input=isRuleInput(active)?active:(remembered&&document.contains(remembered)?remembered:document.getElementById('ps-field-formula'));if(!input)return;
 const start=Number.isInteger(input.selectionStart)?input.selectionStart:input.value.length;
 const end=Number.isInteger(input.selectionEnd)?input.selectionEnd:start;
 const operator=['+','-','*','/'].includes(token);
 const isFunction=['MIN','MAX'].includes(token);
 const displayToken=(operator||isFunction||['%','(',')'].includes(token))?token:formulaTokenLabel(token);
 const text=isFunction?token+'(':(token==='%'?'%':(operator?' '+token+' ':(token==='('? '(': (token===')'?')':' '+displayToken+' '))));
 input.value=input.value.slice(0,start)+text+input.value.slice(end);
 const caret=start+text.length;input.focus();input.setSelectionRange(caret,caret);
 if(input.classList.contains('ps-formula-rule-input'))window.psFormulaRuleChanged(Number(input.getAttribute('data-rule-index')),input);
 else window.psFormulaInputChanged();
};
window.psFormulaInputChanged=function(){
 const input=document.getElementById('ps-field-formula'),type=document.getElementById('ps-field-type');
 const preview=document.getElementById('ps-formula-preview');
 if(input&&type&&input.value.trim()){type.value='formula';window.psToggleFormula();}
 if(window.__psFormulaPreviewTimer)clearTimeout(window.__psFormulaPreviewTimer);
 const seq=(Number(window.__psFormulaPreviewSeq)||0)+1;window.__psFormulaPreviewSeq=seq;
 if(!preview)return;
 if(!input||!input.value.trim()){
  preview.innerHTML='<div class="ps-formula-preview-meta">'+tr('formulaPreviewEmpty')+'</div>';
  return;
 }
 preview.innerHTML='<div class="ps-formula-preview-meta">'+tr('formulaPreviewHint')+'</div>';
 window.__psFormulaPreviewTimer=setTimeout(function(){window.psRunFormulaPreview(seq);},300);
};
window.psRunFormulaPreview=async function(seq){
 const input=document.getElementById('ps-field-formula'),preview=document.getElementById('ps-formula-preview');
 if(!input||!preview||!input.value.trim()||seq!==window.__psFormulaPreviewSeq)return;
 const fieldKey=document.getElementById('ps-field-key')?.value.trim().toLowerCase()||'';
 const row=state.rows.find(x=>x&&x.sku_code)||null;
 const variables=Object.assign({},row&&row.formula_context||{},row&&row.values||{});
 if(row&&row.srp!=null)variables.srp=Number(row.srp);
 if(fieldKey)delete variables[fieldKey];
 try{
  const result=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/formula/preview','POST',{
   formula:input.value.trim(),exclude_key:fieldKey,variables
  });
  if(seq!==window.__psFormulaPreviewSeq||document.getElementById('ps-formula-preview')!==preview)return;
  const money=state.scheme&&state.scheme.currency?esc(state.scheme.currency)+' ':'';
  const sample=row?row.sku_code:tr('formulaPreviewNoSku');
  preview.innerHTML='<div class="ps-formula-preview-head"><span class="ps-formula-preview-ok">'+tr('formulaPreviewValid')+'</span><strong class="ps-formula-preview-result">'+tr('formulaPreviewResult')+'：'+money+fmt(result.result)+'</strong></div><div class="ps-formula-preview-meta">'+tr('formulaPreviewSample')+'：'+esc(sample)+'</div>';
 }catch(e){
  if(seq!==window.__psFormulaPreviewSeq||document.getElementById('ps-formula-preview')!==preview)return;
  const message=e&&e.message?e.message:String(e||'');
  preview.innerHTML='<div class="ps-formula-preview-error">'+tr('formulaPreviewError')+'：'+esc(message)+'</div>';
 }
};
function collectFieldEditorValues(){
 const field_name=document.getElementById('ps-field-name')?.value.trim()||'';
 const field_key=document.getElementById('ps-field-key')?.value.trim().toLowerCase()||'';
 const unit=document.getElementById('ps-field-unit')?.value.trim()||'';
 const display_format=document.getElementById('ps-field-display-format')?.value||'auto';
 const decimalPlacesInput=document.getElementById('ps-field-decimal-places')?.value;
 const decimal_places=Math.max(0,Math.min(6,Math.round(decimalPlacesInput==null||decimalPlacesInput===''?2:Number(decimalPlacesInput))));
 const formula=document.getElementById('ps-field-formula')?.value.trim()||'';
 const sync_wac=!!document.getElementById('ps-field-sync-wac')?.checked;
 const checked=Array.from(document.querySelectorAll('.ps-cat-check:checked')).map(x=>x.value);
 const total=document.querySelectorAll('.ps-cat-check').length;
 let field_type=document.getElementById('ps-field-type')?.value||'amount';
 const formula_rules={};
 if(field_type==='formula'){
  const used=new Map();
  (window.__psFormulaRulesDraft||[]).forEach((rule,index)=>{
   const expression=String(rule.formula||'').trim(),categories=Array.isArray(rule.categories)?rule.categories:[];
   if(!expression&&!categories.length)return;
   if(!expression||!categories.length)throw new Error(tr('formulaRuleIncomplete'));
   categories.forEach(category=>{
    if(used.has(category))throw new Error(tr('formulaCategoryDuplicate'));
    used.set(category,index);formula_rules[category]=expression;
   });
  });
 }
 const applicable_categories=field_type==='formula'?[]:((!checked.length||checked.length===total)?[]:checked);
 return {field_name,field_key,unit,display_format,decimal_places,formula:'',formula_rules,sync_wac,applicable_categories,field_type};
}
window.psSelectAllCategories=function(){
 const checks=Array.from(document.querySelectorAll('.ps-cat-check'));
 if(!checks.length)return;
 const selectAll=!checks.every(x=>x.checked);
 checks.forEach(x=>{x.checked=selectAll;});
 window.psUpdateCategorySelectAll();
};
function formulaRuleDraftsFromMap(map,legacyFormula,legacyCategories,categoryList){
 const grouped=[];
 Object.keys(map||{}).forEach(category=>{
  const expression=String(map[category]||'').trim();if(!expression)return;
  let rule=grouped.find(x=>x.formula===expression);
  if(!rule){rule={formula:expression,categories:[]};grouped.push(rule);}
  if(!rule.categories.includes(category))rule.categories.push(category);
 });
 if(!grouped.length&&String(legacyFormula||'').trim()){
  const categories=legacyCategories&&legacyCategories.length?legacyCategories:categoryList;
  if(categories.length)grouped.push({formula:String(legacyFormula).trim(),categories:categories.slice()});
 }
 return grouped;
}
window.psRenderFormulaRules=function(){
 const host=document.getElementById('ps-formula-rules-list');if(!host)return;
 const rules=window.__psFormulaRulesDraft||[],all=window.__psFormulaCategoryList||[];
 host.innerHTML=rules.map((rule,index)=>{
  const assigned=new Set();rules.forEach((other,otherIndex)=>{if(otherIndex!==index)(other.categories||[]).forEach(c=>assigned.add(c));});
  const selected=new Set(rule.categories||[]);
  const categories=all.map(category=>{
   const disabled=assigned.has(category),checked=selected.has(category);
   return '<label class="ps-rule-category-option '+(disabled?'is-disabled':'')+'"><input type="checkbox" value="'+esc(category)+'" '+(checked?'checked ':'')+(disabled?'disabled ':'')+'onchange="psSetRuleCategory('+index+',this.value,this.checked)"><span>'+esc(category)+'</span></label>';
  }).join('');
  const chips=(rule.categories||[]).map(category=>'<button type="button" class="ps-rule-category-chip" data-category="'+esc(category)+'" onclick="psRemoveRuleCategory('+index+',this.dataset.category)">'+esc(category)+' <span>×</span></button>').join('');
  const count=(rule.categories||[]).length,formula=String(rule.formula||'');
  return '<article class="ps-formula-rule-card" data-rule-index="'+index+'"><div class="ps-formula-rule-top"><strong>'+tr('formulaRuleLabel')+' '+(index+1)+'</strong><div><button type="button" class="ps-field-action" onclick="psCopyFormulaRule('+index+')">'+tr('copyFormulaRule')+'</button><button type="button" class="ps-field-action danger" onclick="psDeleteFormulaRule('+index+')">'+tr('delete')+'</button></div></div><div class="ps-formula-rule-grid"><section class="ps-formula-rule-editor"><div class="ps-formula-rule-section-head"><strong>'+tr('formulaText')+'</strong><button type="button" class="ps-field-action" onclick="psPreviewFormulaRule('+index+')">'+tr('previewCategoryFormula')+'</button></div><textarea class="ps-formula-rule-input" data-rule-index="'+index+'" onfocus="window.__psFormulaTargetInput=this" oninput="psFormulaRuleChanged('+index+',this)" placeholder="=MIN(SRP*8.5%,60000)">'+esc(formulaDisplayExpression(formula))+'</textarea><div class="ps-formula-rule-preview" id="ps-formula-rule-preview-'+index+'">'+tr('formulaEnterHint')+'</div></section><section class="ps-formula-rule-categories"><strong>'+tr('formulaApplyCategories')+'</strong><div class="ps-editor-help">'+tr('formulaApplyCategoriesHint')+'</div><input class="ps-rule-category-search" type="search" placeholder="'+tr('searchCategories')+'" oninput="psFilterRuleCategories('+index+',this.value)"><div class="ps-rule-category-toolbar"><button type="button" onclick="psSelectAllRuleCategories('+index+')">'+tr('selectAllCategories')+'</button><button type="button" onclick="psClearRuleCategories('+index+')">'+tr('clearCategories')+'</button><span>'+tr('selectedCount')+' '+count+' / '+all.length+'</span></div><div class="ps-rule-category-list" id="ps-rule-category-list-'+index+'">'+(categories||'<span class="ps-editor-help">'+tr('noProductCategories')+'</span>')+'</div></section></div><div class="ps-formula-rule-summary"><strong>'+tr('selectedCategories')+'（'+count+'）</strong><div class="ps-formula-rule-chips">'+(chips||'<span class="ps-editor-help">'+tr('chooseFormulaCategories')+'</span>')+'</div><span class="ps-formula-rule-summary-note">'+(count?tr('formulaAppliedToCategories')+' '+count+' '+tr('category'):'')+'</span></div></article>';
 }).join('')||'<div class="ps-editor-help">'+tr('noFormulaRules')+'</div>';
};
window.psAddFormulaRule=function(){if(!window.__psFormulaRulesDraft)window.__psFormulaRulesDraft=[];window.__psFormulaRulesDraft.push({formula:'',categories:[]});window.psRenderFormulaRules();};
window.psCopyFormulaRule=function(index){const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule)return;window.__psFormulaRulesDraft.splice(index+1,0,{formula:String(rule.formula||''),categories:[]});window.psRenderFormulaRules();};
window.psDeleteFormulaRule=function(index){(window.__psFormulaRulesDraft||[]).splice(index,1);window.psRenderFormulaRules();};
window.psSetRuleCategory=function(index,category,checked){
 const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule)return;
 if(checked){const taken=(window.__psFormulaRulesDraft||[]).some((x,i)=>i!==index&&(x.categories||[]).includes(category));if(taken){err(new Error(tr('formulaCategoryAssigned')));window.psRenderFormulaRules();return;}if(!rule.categories.includes(category))rule.categories.push(category);}
 else rule.categories=rule.categories.filter(x=>x!==category);
 window.psRenderFormulaRules();
};
window.psRemoveRuleCategory=function(index,category){window.psSetRuleCategory(index,category,false);};
window.psSelectAllRuleCategories=function(index){
 const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule)return;
 const taken=new Set();(window.__psFormulaRulesDraft||[]).forEach((x,i)=>{if(i!==index)(x.categories||[]).forEach(c=>taken.add(c));});
 (window.__psFormulaCategoryList||[]).forEach(c=>{if(!taken.has(c)&&!rule.categories.includes(c))rule.categories.push(c);});
 window.psRenderFormulaRules();
};
window.psClearRuleCategories=function(index){const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule)return;rule.categories=[];window.psRenderFormulaRules();};
window.psFilterRuleCategories=function(index,query){
 const host=document.getElementById('ps-rule-category-list-'+index);if(!host)return;const q=String(query||'').trim().toLowerCase();
 host.querySelectorAll('.ps-rule-category-option').forEach(label=>{label.style.display=label.textContent.toLowerCase().includes(q)?'':'none';});
};
window.psFormulaRuleChanged=function(index,input){
 const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule||!input)return;rule.formula=String(input.value||'');
 const preview=document.getElementById('ps-formula-rule-preview-'+index);if(preview)preview.textContent='填写公式后点击校验并预览。';
 const type=document.getElementById('ps-field-type');if(input.value.trim()&&type&&type.value!=='formula'){type.value='formula';window.psToggleFormula();}
};
window.psPreviewFormulaRule=async function(index){
 const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule)return;const expression=String(rule.formula||'').trim(),preview=document.getElementById('ps-formula-rule-preview-'+index);
 if(!expression){if(preview)preview.textContent=tr('formulaRequired');return;}
 const category=(rule.categories||[])[0],row=category?state.rows.find(x=>String(x.category||'').trim()===category):state.rows[0]||null;
 const variables=Object.assign({},row&&row.formula_context||{},row&&row.values||{});if(row&&row.srp!=null)variables.srp=Number(row.srp);
 const fieldKey=document.getElementById('ps-field-key')?.value.trim().toLowerCase()||'';if(fieldKey)delete variables[fieldKey];
 if(preview)preview.textContent=tr('formulaValidating');
 try{const result=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/formula/preview','POST',{formula:expression,exclude_key:fieldKey,variables});if(preview)preview.textContent=tr('formulaValidPreview')+' · '+(state.scheme.currency||'')+' '+fmt(result.result)+(row?' · '+row.sku_code:'');}
 catch(e){if(preview)preview.textContent=tr('formulaValidationFailed')+'：'+String(e&&e.message||e);}
};
window.psOpenFieldEditor=function(id,percentDefault){
 const f=state.fields.find(x=>x.id===id)||null,selected=new Set(f?cats(f):[]);
 const categoryList=Array.from(new Set(state.rows.map(x=>String(x.category||'').trim()).filter(Boolean).concat(Array.from(selected)))).sort();
 let formulaRules={};if(f&&f.formula_rules){try{formulaRules=typeof f.formula_rules==='string'?JSON.parse(f.formula_rules):f.formula_rules;}catch(e){formulaRules={};}}
 if(!formulaRules||typeof formulaRules!=='object'||Array.isArray(formulaRules))formulaRules={};
 const isSrp=!!(f&&f.is_builtin_srp),type=f?f.field_type:'amount',isWac=!!(f&&Number(f.sync_wac||0)===1);
 window.__psFormulaCategoryList=categoryList;
 window.__psFormulaRulesDraft=type==='formula'?formulaRuleDraftsFromMap(formulaRules,f&&f.formula,Array.from(selected),categoryList).map(rule=>({formula:formulaDisplayExpression(rule.formula),categories:rule.categories.slice()})):[];
 const allScope=categoryList.length>0&&selected.size===categoryList.length;
 const checks=categoryList.map(category=>'<label class="ps-category-chip"><input type="checkbox" class="ps-cat-check" value="'+esc(category)+'" '+((allScope||selected.has(category))?'checked':'')+' onchange="psUpdateCategorySelectAll()"> <span>'+esc(category)+'</span></label>').join('')||'<span class="ps-editor-help">—</span>';
 const formulaSection='<section class="ps-editor-section" id="ps-formula-wrap" style="'+(isWac||type==='percent'?'display:none':'')+'"><div class="ps-editor-section-title ps-formula-rules-title"><strong>'+tr('formulaRulesTitle')+'</strong><button type="button" class="ps-btn primary" onclick="psAddFormulaRule()">＋ '+tr('addFormulaRule')+'</button></div>'+formulaBuilderHtml(f)+'<div class="ps-formula-rules-list" id="ps-formula-rules-list"></div><div class="ps-editor-formula-help">'+tr('formulaBuilderHint')+' '+tr('formulaHelp')+'</div></section>';
 const percentSection='<section class="ps-editor-section" id="ps-percent-wrap" style="'+(type==='percent'?'':'display:none')+'"><div class="ps-editor-section-title">'+tr('percentSettings')+'</div><div class="ps-percent-setting"><div class="ps-percent-row"><label class="ps-percent-label" for="ps-field-default-percent">'+tr('defaultPercent')+'</label><div class="ps-percent-input-wrap"><input class="ps-percent-input" id="ps-field-default-percent" type="number" min="0" step="0.01" placeholder="8" value="'+esc(percentDefault==null?'':percentDefault)+'"><span class="ps-percent-suffix">%</span></div><button type="button" class="ps-percent-apply" onclick="psApplyPercentToSkus(\''+(f?esc(f.id):'')+'\')">'+tr('batchApplyPercent')+'</button></div><div class="ps-percent-hint">'+tr('percentBatchHint')+'</div></div></section>';
 const categoryScopeSection='<section class="ps-editor-section" id="ps-category-scope-wrap" style="'+(type==='formula'?'display:none':'')+'"><div class="ps-editor-section-title">'+tr('scopeInfo')+'</div><div class="ps-category-toolbar"><button type="button" id="ps-select-all-categories" class="ps-category-select-all '+(allScope?'is-all':'')+'" onclick="psSelectAllCategories()"><span class="ps-checkmark">'+(allScope?'✓':'')+'</span>'+tr('selectAllCategories')+'</button></div><div class="ps-category-chips">'+checks+'</div><div class="ps-editor-help" style="margin-top:8px">'+tr('allCategoriesHelp')+'</div></section>';
 const body='<div class="ps-field-editor"><div class="ps-editor-intro">'+tr('fieldEditorHint')+'</div><section class="ps-editor-section"><div class="ps-editor-section-title">'+tr('basicInfo')+'</div><div class="ps-editor-grid"><div class="ps-editor-control"><label>'+tr('fieldName')+'</label><input id="ps-field-name" value="'+esc(f?f.field_name:'')+'" '+(isSrp?'disabled':'')+'></div><div class="ps-editor-control"><label>'+tr('fieldKey')+'</label><input id="ps-field-key" value="'+esc(f?f.field_key:('fee_'+Date.now().toString(36)))+'" '+(f?'disabled':'')+'><span class="ps-editor-help">'+tr('fieldKeyHint')+'</span></div><div class="ps-editor-control"><label>'+tr('fieldType')+'</label><select id="ps-field-type" onchange="psToggleFormula()" '+(isSrp||isWac?'disabled':'')+'><option value="amount" '+(type==='amount'?'selected':'')+'>'+tr('amount')+'</option><option value="percent" '+(type==='percent'?'selected':'')+'>'+tr('percent')+'</option><option value="number" '+(type==='number'?'selected':'')+'>'+tr('number')+'</option><option value="formula" '+(type==='formula'?'selected':'')+'>'+tr('calc')+'</option></select></div><div class="ps-editor-control"><label>'+tr('unit')+'</label><input id="ps-field-unit" value="'+esc(f?f.unit:'')+'" placeholder="'+esc(type==='percent'?'%':(state.scheme.currency||''))+'"></div><div class="ps-editor-control"><label>'+tr('displayFormat')+'</label><select id="ps-field-display-format"><option value="auto" '+((!f||!f.display_format||f.display_format==='auto')?'selected':'')+'>'+tr('formatAuto')+'</option><option value="amount" '+(f&&f.display_format==='amount'?'selected':'')+'>'+tr('formatAmount')+'</option><option value="number" '+(f&&f.display_format==='number'?'selected':'')+'>'+tr('formatNumber')+'</option><option value="percent" '+(f&&f.display_format==='percent'?'selected':'')+'>'+tr('formatPercent')+'</option></select></div><div class="ps-editor-control"><label>'+tr('decimalPlaces')+'</label><input id="ps-field-decimal-places" type="number" min="0" max="6" step="1" value="'+esc(f&&f.decimal_places!=null?f.decimal_places:2)+'"></div></div></section>'+categoryScopeSection+'<section class="ps-editor-section" id="ps-field-wac-wrap" style="'+(type==='amount'&&!isSrp?'':'display:none')+'"><div class="ps-editor-switch-line"><div class="ps-editor-switch-copy"><strong>'+tr('syncWacField')+'</strong><p>'+tr('syncWacFieldHelp')+'</p></div><input type="checkbox" class="ps-wac-switch" id="ps-field-sync-wac" onchange="psToggleWacField()" '+(isWac?'checked':'')+'></div></section>'+percentSection+formulaSection+'</div>';
 const footer='<button type="button" class="ps-field-modal-btn" onclick="psOpenFieldsModal()">'+tr('cancel')+'</button><button type="button" class="ps-field-modal-btn primary" onclick="psSaveField(\''+(f?esc(f.id):'')+'\')">'+tr('confirm')+'</button>';
 openModal(f?tr('edit')+' · '+esc(f.field_name):tr('add')+' '+tr('fields'),body,footer,'modal-lg');
 const modal=document.getElementById('modal-content');if(modal)modal.classList.add('modal-price-field-editor');
 window.psRenderFormulaRules();window.psFormulaInputChanged();
};
window.psUpdateCategorySelectAll=function(){
 const checks=Array.from(document.querySelectorAll('.ps-cat-check'));const checked=checks.filter(x=>x.checked).length;const button=document.getElementById('ps-select-all-categories');
 const all=checks.length>0&&checked===checks.length;
 if(button){button.classList.toggle('is-all',all);const mark=button.querySelector('.ps-checkmark');if(mark)mark.textContent=all?'✓':'';}
};
window.psToggleFormula=function(){
 const t=document.getElementById('ps-field-type')?.value,w=document.getElementById('ps-formula-wrap'),p=document.getElementById('ps-percent-wrap'),a=document.getElementById('ps-field-wac-wrap'),scope=document.getElementById('ps-category-scope-wrap'),c=document.getElementById('ps-field-sync-wac'),formula=document.getElementById('ps-field-formula');
 if(a)a.style.display=t==='amount'?'':'none';
 if(t!=='amount'&&c)c.checked=false;
 if(w)w.style.display=(c&&c.checked)||t==='percent'?'none':'';
 if(p)p.style.display=t==='percent'?'':'none';
 if(scope)scope.style.display=t==='formula'?'none':'';
 if(t!=='formula'&&formula&&formula.value.trim())formula.value='';
};
window.psToggleWacField=function(){const c=document.getElementById('ps-field-sync-wac'),t=document.getElementById('ps-field-type');if(c&&t){if(c.checked)t.value='amount';t.disabled=!!c.checked;}window.psToggleFormula();};
window.psSaveField=async function(id){
 try{
  const data=collectFieldEditorValues();
  if(id==='builtin-srp')await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/formula','PUT',{srp_formula:data.formula});
  else await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/fields','POST',Object.assign({id:id||undefined},data));
  await loadData(state.schemeId);window.psOpenFieldsModal();if(typeof showToast==='function')showToast(tr('fieldSaved'),'success');
 }catch(e){err(e);}
};
window.psApplyPercentToSkus=async function(id){
 const data=collectFieldEditorValues(),input=document.getElementById('ps-field-default-percent'),raw=input&&input.value.trim();
 if(data.field_type!=='percent'){err(new Error(tr('percentRequired')));return;}
 if(raw===''||!Number.isFinite(Number(raw))||Number(raw)<0){err(new Error(tr('percentRequired')));if(input)input.focus();return;}
 let savedField=null;
 try{
  savedField=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/fields','POST',Object.assign({id:id||undefined},data));
  const percent=Number(raw),categories=data.applicable_categories;
  const matched=state.rows.filter(row=>!categories.length||categories.includes(String(row.category||'').trim()));
  if(!matched.length)throw new Error(tr('noPercentSkus'));
  const rows=matched.map(row=>({sku_code:row.sku_code,values:{[data.field_key]:percent}}));
  for(let i=0;i<rows.length;i+=2000)await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/values','POST',{rows:rows.slice(i,i+2000)});
  closeModal();await loadData(state.schemeId);window.psOpenFieldEditor(savedField.id,raw);
  if(typeof showToast==='function')showToast(tr('percentApplied')+' ('+matched.length+')','success');
 }catch(e){
  if(savedField){try{closeModal();await loadData(state.schemeId);window.psOpenFieldEditor(savedField.id,raw);}catch(refreshError){}}
  err(e);
 }
};
window.psDeleteField=async function(id){const f=state.fields.find(x=>x.id===id);if(!f||!confirm(tr('delete')+'：'+f.field_name+'？'))return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/fields/'+encodeURIComponent(id),'DELETE');await loadData(state.schemeId);window.psOpenFieldsModal();}catch(e){err(e);}};
window.psOpenVersionsModal=async function(){if(!state.scheme||!allowDiscardDirty())return;try{const v=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/versions');const body=v.length?v.map(x=>'<div class="ps-version"><div><strong>'+tr('version')+' #'+esc(x.version_no)+'</strong> · '+esc(x.note||'')+'<div class="ps-version-meta">'+esc(x.created_by_name||'')+' · '+esc(x.created_at||'')+'</div></div><button class="ps-btn" onclick="psRestoreVersion(\''+esc(x.id)+'\','+Number(x.version_no)+')">'+tr('restore')+'</button></div>').join(''):'<div class="ps-empty">'+tr('noHistory')+'</div>';openModal(tr('history'),body,'<button class="btn btn-secondary" onclick="closeModal()">'+tr('close')+'</button>','modal-lg');}catch(e){err(e);}};
window.psRestoreVersion=async function(id,no){if(!confirm(tr('restore')+' #'+no+'？'))return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/versions/'+encodeURIComponent(id)+'/restore','POST',{});closeModal();await loadData(state.schemeId);if(typeof showToast==='function')showToast(tr('restored'),'success');}catch(e){err(e);}};
window.psDownloadImportTemplate=function(){
 if(!state.scheme||!state.rows.length||typeof XLSX==='undefined')return;
 const manual=state.fields.filter(f=>f.field_type!=='formula'&&Number(f.sync_wac||0)!==1);
 const headers=['SKU',tr('category'),tr('srp')].concat(manual.map(f=>f.field_name+' ['+f.field_key+']'));
 const rows=state.rows.map(r=>[r.sku_code,r.category||'',''].concat(manual.map(()=>'')));
 const ws=XLSX.utils.aoa_to_sheet([headers].concat(rows));ws['!cols']=headers.map((h,i)=>({wch:i===0?30:(i===1?20:18)}));
 const note=XLSX.utils.aoa_to_sheet([[tr('templateInstructions'),tr('templateSku')],[tr('srp')+' / '+tr('fields'),tr('templateSrp')],[tr('landingCost'),tr('templateLanding')],[tr('category')+' / '+tr('stock'),tr('templateStock')]]);note['!cols']=[{wch:28},{wch:78}];
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,tr('downloadTemplate'));XLSX.utils.book_append_sheet(wb,note,tr('templateInstructions'));
 const name=['Price',state.scheme.country,state.scheme.brand,state.scheme.platform,'Import_Template'].join('_').replace(/[\\/:*?"<>|]/g,'_');XLSX.writeFile(wb,name+'.xlsx');
};
window.psToggleActionsMenu=function(event){if(event&&event.stopPropagation)event.stopPropagation();const menu=document.getElementById('ps-actions-menu'),button=document.querySelector('#ps-root .ps-actions-toggle');if(!menu||!button)return;const open=menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',open?'true':'false');};
window.psCloseActionsMenu=function(){const menu=document.getElementById('ps-actions-menu'),button=document.querySelector('#ps-root .ps-actions-toggle');if(menu)menu.hidden=true;if(button)button.setAttribute('aria-expanded','false');};
window.psClickImport=function(){if(!allowDiscardDirty())return;const x=document.getElementById('ps-import-file');if(x){x.value='';x.click();}};
window.psHandleImport=async function(input){
 const file=input&&input.files&&input.files[0];if(!file)return;if(typeof XLSX==='undefined'){err(new Error('XLSX library unavailable'));return;}
 try{const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});if(!data.length)return;
   const headers=data[0].map(x=>String(x||'').trim());const skuIdx=headers.findIndex(x=>/^(SKU|SKU \u7f16\u7801|SKU\u7f16\u7801|SKU Code)$/i.test(x));if(skuIdx<0){err(new Error(tr('skuRequired')));return;}
   const srpIdx=headers.findIndex(x=>/^(SRP|\u5efa\u8bae\u96f6\u552e\u4ef7)$/i.test(x));const col={};headers.forEach((h,i)=>{const m=h.match(/\[([a-z][a-z0-9_]{1,39})\]\s*$/i);if(m)col[m[1].toLowerCase()]=i;});
  const manual=state.fields.filter(f=>f.field_type!=='formula'&&Number(f.sync_wac||0)!==1&&Object.prototype.hasOwnProperty.call(col,f.field_key));const rows=[];
  data.slice(1).forEach(r=>{const sku_code=String(r[skuIdx]||'').trim();if(!sku_code)return;const values={};manual.forEach(f=>{const v=r[col[f.field_key]];if(v!==''&&v!=null)values[f.field_key]=Number(v);});const row={sku_code,values};if(srpIdx>=0&&r[srpIdx]!==''&&r[srpIdx]!=null){const srp=Number(r[srpIdx]);if(!Number.isFinite(srp)||srp<0)throw new Error('SKU '+sku_code+' SRP must be a valid non-negative number');row.srp=srp;}if(Object.keys(values).length||Object.prototype.hasOwnProperty.call(row,'srp'))rows.push(row);});
  if(!rows.length){err(new Error('No valid SKU values found'));return;}const result=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/values','POST',{rows});await loadData(state.schemeId);if(typeof showToast==='function')showToast(tr('importDone')+' / '+(result.saved_cells||0),'success');
 }catch(e){err(e);}finally{if(input)input.value='';}
};
window.psExportExcel=function(){
 if(!allowDiscardDirty())return;if(typeof XLSX==='undefined'||!state.rows.length||!state.scheme)return;
 const exportFields=state.fields.filter(f=>f.field_key!=='srp');const headers=[tr('category'),'SKU',tr('stock')].concat(exportFields.map(f=>f.field_name+' ['+f.field_key+']'),[tr('srp')]);
 const rows=state.rows.map(r=>[r.category||'',r.sku_code,Number(r.stock_qty||0)].concat(exportFields.map(f=>r.values?r.values[f.field_key]:null),[r.srp==null?'':r.srp]));
 const sh=XLSX.utils.aoa_to_sheet([headers].concat(rows));exportFields.forEach((f,index)=>{if(f.display_format==='percent'&&f.field_type==='formula'){for(let rowIndex=1;rowIndex<=rows.length;rowIndex++){const cell=sh[XLSX.utils.encode_cell({r:rowIndex,c:3+index})];if(cell)cell.z='0.00%';}}else if(f.display_format==='percent'||(f.display_format==='auto'&&f.field_type==='percent')){for(let rowIndex=1;rowIndex<=rows.length;rowIndex++){const cell=sh[XLSX.utils.encode_cell({r:rowIndex,c:3+index})];if(cell)cell.z='0.00"%"';}}});sh['!cols']=headers.map((h,i)=>({wch:i===1?28:(i<4?18:18)}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sh,'Price System');
 const name=['Price',state.scheme.country,state.scheme.brand,state.scheme.platform].join('_').replace(/[\\/:*?"<>|]/g,'_');XLSX.writeFile(wb,name+'.xlsx');if(typeof showToast==='function')showToast(tr('exportDone'),'success');
};
window.psDeactivateScheme=async function(){if(!state.scheme||!allowDiscardDirty()||!confirm(tr('stopConfirm')))return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId),'DELETE');state.schemeId='';await loadSchemes('');}catch(e){err(e);}};
window.psDeleteScheme=function(){
 if(!state.scheme||!allowDiscardDirty())return;
 const body='<div style="font-size:13px;line-height:1.65;color:#444"><p>'+tr('deleteSchemeConfirm')+'</p><div style="margin:10px 0;padding:10px 12px;border-radius:8px;background:#f5f5f7;color:#1d1d1f;font-weight:600">'+esc(schemeLabel(state.scheme))+'</div><p style="color:#b42318">'+tr('deleteSchemeWarning')+'</p></div>';
 openModal(tr('deleteSchemeTitle'),body,'<button class="btn btn-secondary" onclick="closeModal()">'+tr('cancel')+'</button><button class="btn btn-primary" style="background:#d93025;border-color:#d93025" onclick="psConfirmDeleteScheme()">'+tr('deleteScheme')+'</button>','modal-md');
};
window.psConfirmDeleteScheme=async function(){
 const id=state.schemeId;if(!id)return;
 try{await api('/api/price-system/schemes/'+encodeURIComponent(id)+'/permanent','DELETE');closeModal();state.schemeId='';await loadSchemes('');if(typeof showToast==='function')showToast(tr('schemeDeleted'),'success');}
 catch(e){err(e);}
};
window.renderPriceSystem=async function(){navI18n();styles();state.dirty={};shell();try{await meta();await loadSchemes();}catch(e){err(e);const m=document.getElementById('ps-main');if(m)m.innerHTML='<div class="ps-card"><div class="ps-empty">'+esc(e.message||tr('saveFailed'))+'</div></div>';}};
})();