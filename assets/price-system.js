(function () {
'use strict';
const TXT={
zh:{title:'价格体系',subtitle:'按国家、品牌和销售渠道维护独立价格方案',scheme:'价格方案',newScheme:'新增价格方案',blankScheme:'新建空白方案',copyScheme:'复制已有方案',copySource:'选择要复制的方案',copySourcePlaceholder:'请选择已有价格方案',copySchemeHelp:'复制费用字段、类目适用范围、字段顺序、冻结列、跨渠道引用和 SRP 公式设置；不复制 SKU 手工价格、费用值和 WAC 数据。',copyAndCreate:'复制并新建',copySchemeEmpty:'暂无可复制的价格方案',copySourceRequired:'请选择要复制的价格方案',copySchemeCreated:'价格方案复制成功',fields:'费用字段设置',fieldOrderTitle:'字段顺序',fieldOrderHint:'按住左侧手柄拖动，调整字段在价格表中的列顺序。',freezeTo:'冻结至',freezeNone:'不冻结',freezeSaved:'冻结列设置已保存',freezeHint:'冻结所选字段及其左侧所有列。',fieldEditorHint:'设置字段名称、类型及适用范围。保存后将应用于当前价格方案。',basicInfo:'基础信息',scopeInfo:'适用范围',calculationInfo:'计算设置',systemField:'系统字段',savingOrder:'正在保存顺序…',orderSaved:'字段顺序已保存',fieldCount:'个字段',formula:'SRP 计算公式',history:'历史版本',viewChanges:'查看修改',changeDetails:'变更详情',changeSummary:'变更汇总',settingsChanges:'设置变更',skuDataChanges:'SKU 数据变更',changeType:'变更类型',changeTarget:'对象',beforeValue:'修改前',afterValue:'修改后',noChanges:'该版本未检测到实际数据变化。',initialVersion:'初始版本（无前一版本）',compareWith:'对比版本',previousPage:'上一页',nextPage:'下一页',page:'页',totalItems:'共 {count} 项',fieldAdded:'新增字段',fieldRemoved:'删除字段',fieldUpdated:'修改字段',fieldChanges:'字段变更',schemeUpdated:'方案设置',status:'状态',manualValue:'手动费用',srpValue:'SRP',landingCost:'Landing Cost',added:'新增',removed:'删除',updated:'修改',import:'导入 Excel',export:'导出 Excel',save:'保存修改',saved:'保存成功',loading:'正在加载价格数据…',emptyTitle:'还没有价格方案',emptyHint:'先建立国家、品牌和销售渠道对应的价格方案，再维护 SKU 价格。',country:'国家',brand:'品牌',platform:'销售渠道',shop:'店铺',currency:'价格币种',category:'类目',sku:'SKU 编码',stock:'库存数量',forecastAvg:'{days}天月均销量',availableTurnover:'当前可用周转',daysSinceInbound:'距上次入库 {days} 天',daysSinceInboundUnknown:'距上次入库 未知',daysSinceInboundHeader:'距上次入库天数',sortHint:'点击排序：降序 / 升序 / 默认',srp:'SRP',noData:'当前品牌暂无 SKU 主数据',noFields:'尚未设置费用字段，可先添加需要维护的价格项目。',add:'新增',edit:'编辑',delete:'删除',cancel:'取消',confirm:'确认',close:'关闭',fieldName:'字段名称',fieldKey:'字段编码',fieldType:'字段类型',unit:'显示单位',displayFormat:'单元格格式',decimalPlaces:'小数位数',formatAuto:'自动',formatAmount:'金额',formatNumber:'数字',formatPercent:'百分比',amount:'金额',percent:'百分比',number:'数值',calc:'公式计算',reference:'引用其他方案字段',referenceType:'引用字段',referenceSourceScheme:'来源方案',referenceSourceField:'引用字段',referenceHelp:'系统按相同 SKU 自动匹配来源方案的对应字段；当前方案重新加载时自动读取最新值。引用保留来源币种，不自动换汇。',referencePreview:'引用预览',referenceLoading:'正在加载来源字段…',referenceNoFields:'来源方案没有可引用字段。',referenceNoSchemes:'当前国家和品牌下没有其他销售渠道方案。',switchChannel:'切换销售渠道',addChannel:'新增销售渠道方案',syncWacField:'\u81ea\u52a8\u540c\u6b65 WAC',syncWacFieldHelp:'\u5f00\u542f\u540e\uff0c\u7cfb\u7edf\u6309 SKU\u3001\u56fd\u5bb6\u548c\u54c1\u724c\u81ea\u52a8\u5339\u914d\u6700\u65b0\u6709\u6548\u4e14\u5df2\u786e\u8ba4\u7684 WAC\uff1b\u8be5\u5b57\u6bb5\u81ea\u52a8\u66f4\u65b0\uff0c\u4e0d\u9700\u8981\u624b\u52a8\u7ef4\u62a4\u3002',syncQuotationField:'自动同步报价',syncQuotationFieldHelp:'开启后，系统按品牌和 SKU 自动匹配报价管理中最新的报价；保留每个 SKU 的原始币种，不进行汇率换算，并按币种符号显示。',quoteSource:'报价自动同步',quoteCurrency:'报价币种',wacSource:'WAC\u81ea\u52a8\u540c\u6b65',allCategoriesHelp:'\u4e0d\u9009\u62e9\u5177\u4f53\u7c7b\u76ee\u65f6\uff0c\u9ed8\u8ba4\u5168\u90e8\u9002\u7528\u3002',selectAllCategories:'全选',percentSettings:'百分比设置',defaultPercent:'默认百分比',batchApplyPercent:'批量应用到已匹配 SKU',percentBatchHint:'批量应用后，将为当前适用范围内的 SKU 填入该百分比；之后仍可在价格列表中按 SKU 单独修改。',percentRequired:'请输入有效的非负百分比。',percentApplied:'百分比已批量应用到适用 SKU',noPercentSkus:'当前适用范围内没有可更新的 SKU。',formulaText:'计算公式',categoryFormulaRules:'按类目配置计算公式',addCategoryRule:'新增类目规则',previewCategoryFormula:'校验并预览',categoryFormulaEmpty:'当前品牌没有可配置的产品类目，请先维护 SKU 主数据类目。',categoryFormulaPreviewEmpty:'填写公式后点击校验并预览。',categoryFormulaPreviewOk:'公式校验通过',allCategories:'适用全部类目',categoryScope:'适用类目',formulaHelp:'支持 +、-、*、/、括号、百分号及 MIN()/MAX()；公式开头可选写 =。例如 MIN(srp*6.5%,80000)。百分比字段按 8 录入 8%，公式引用时系统自动换算为 0.08，无需手动 /100。',formulaFields:'可用字段',formulaRulesTitle:'公式规则',addFormulaRule:'新增公式',copyFormulaRule:'复制',formulaRuleLabel:'公式',formulaText:'计算公式',formulaApplyCategories:'适用类目',formulaApplyCategoriesHint:'选择该计算公式要应用的产品类目，可多选。',searchCategories:'搜索类目',clearCategories:'清空',selectedCount:'已选',selectedCategories:'已选类目',formulaAppliedToCategories:'该公式将应用于以上',chooseFormulaCategories:'请选择该公式的适用类目',formulaEnterHint:'填写公式后点击校验并预览。',formulaValidating:'正在校验并预览…',formulaValidPreview:'校验通过',formulaValidationFailed:'公式校验失败',formulaRequired:'请先填写计算公式。',formulaRuleIncomplete:'每条公式规则都需要填写公式并至少选择一个适用类目。',formulaCategoryDuplicate:'类目被多个公式规则重复选择，请调整适用类目。',formulaCategoryAssigned:'该类目已分配给其他公式规则。',noFormulaRules:'尚未添加公式规则，请点击「新增公式」。',noProductCategories:'暂无产品类目。',formulaBaseFields:'基础数据字段',formulaFeeFields:'其他费用字段',formulaPriceFields:'价格字段',formulaNoFeeFields:'当前没有其他费用字段',formulaOperators:'运算符',formulaFunctions:'函数',formulaPreviewHint:'输入公式后自动校验；预览使用当前价格方案首个 SKU 的实际数据。',formulaPreviewValid:'公式校验通过',formulaPreviewResult:'预览结果',formulaPreviewSample:'预览 SKU',formulaPreviewEmpty:'请输入公式，系统会自动校验并预览。',formulaPreviewNoSku:'当前没有 SKU 数据，按 0 值预览。',formulaPreviewError:'公式错误',formulaBuilderHint:'点击字段、函数或运算符即可插入公式，也可以直接输入。填写公式后自动切换为公式计算。',systemLandingCost:'系统 Landing Cost',srpManualHint:'可直接在列表修改 SRP。手动填写会覆盖公式计算；清空后恢复公式值。',srpReferenceManualHint:'手动填写会覆盖引用值；清空后恢复来源字段的引用结果。',skuMasterPurchasePriceRmb:'SKU主数据采购价 RMB',skuMasterPurchasePriceUsd:'SKU主数据采购价 USD',standardPurchasePrice:'标准采购价',weightedAvgCost:'SKU主数据加权平均成本',latestConfirmedWac:'最新确认 WAC',customsRate:'参考关税税率',inventoryQty:'库存数量',formulaEmpty:'留空表示暂不计算 SRP。',version:'版本',restore:'恢复此版本',importHint:'Excel \u6a21\u677f\u5305\u542b SKU\u3001SRP \u548c\u624b\u52a8\u8d39\u7528\u5b57\u6bb5\uff1bWAC \u6765\u6e90\u5b57\u6bb5\u7531\u7cfb\u7edf\u81ea\u52a8\u66f4\u65b0\uff0c\u5e93\u5b58\u6570\u91cf\u81ea\u52a8\u540c\u6b65\u3002',importDone:'Excel 导入完成',exportDone:'Excel 已导出',unsaved:'有未保存的修改，确定切换方案吗？',discardChanges:'有未保存修改，继续操作会丢弃这些修改。是否继续？',schemeCreated:'价格方案创建成功',fieldSaved:'费用字段已保存',formulaSaved:'SRP 公式已保存',restored:'历史版本已恢复',noHistory:'暂无历史版本',stop:'停用方案',stopConfirm:'确定停用该价格方案？停用后不会出现在方案列表中。',actions:'操作',deleteScheme:'删除方案',deleteSchemeTitle:'删除价格方案',deleteSchemeConfirm:'确定要永久删除这个价格方案吗？',deleteSchemeWarning:'该方案关联的 SKU 价格、费用字段、WAC 成本关联及历史版本都会被删除；原始 WAC 历史记录不会受影响。此操作不可恢复。',schemeDeleted:'价格方案已删除',selectCountry:'请选择国家',selectBrand:'请选择品牌',enterPlatform:'请输入销售渠道名称',fieldKeyHint:'仅英文小写字母、数字和下划线，例如 platform_fee',saveFailed:'保存失败',skuRequired:'Excel 中找不到 SKU 编码列',missingCategories:'个 SKU 尚未在 SKU 主数据维护类目，按类目匹配费用时请先补齐类目',landingCost:'Landing Cost',selectWac:'\u9009\u62e9 WAC',wacHistory:'WAC \u5386\u53f2\u8bb0\u5f55',noWacHistory:'\u8be5 SKU \u6ca1\u6709\u53ef\u7528\u7684\u5df2\u786e\u8ba4 WAC \u5386\u53f2\u8bb0\u5f55',latest:'\u6700\u65b0',choose:'\u4f7f\u7528\u6b64 WAC',current:'\u5f53\u524d\u4f7f\u7528',clearLandingCost:'\u6e05\u9664 Landing Cost',warehouse:'\u4ed3\u5e93',ciNo:'CI \u7f16\u53f7',confirmedAt:'\u786e\u8ba4\u65f6\u95f4',inboundDate:'\u5165\u5e93\u65e5\u671f',manualSrp:'\u624b\u52a8\u5bfc\u5165',formulaSrp:'\u516c\u5f0f\u8ba1\u7b97',syncWac:'WAC \u6279\u91cf\u540c\u6b65',syncWacTitle:'Landing Cost \u6279\u91cf\u540c\u6b65',syncWacDesc:'\u6309\u5f53\u524d\u4ef7\u683c\u65b9\u6848\u7684\u56fd\u5bb6\u548c\u54c1\u724c\uff0c\u6309 SKU \u5339\u914d WAC \u5386\u53f2\u8bb0\u5f55\uff0c\u5e76\u4f7f\u7528\u6bcf\u4e2a SKU \u6700\u65b0\u7684\u6709\u6548 WAC\u3002\u672a\u5339\u914d\u7684 SKU \u4fdd\u7559\u539f\u503c\u3002',matched:'\u5339\u914d\u6210\u529f',unmatched:'\u672a\u5339\u914d',willUpdate:'\u5c06\u66f4\u65b0',unchanged:'\u65e0\u9700\u66f4\u65b0',unmatchedSamples:'\u672a\u5339\u914d SKU',noWacMatch:'\u6ca1\u6709\u627e\u5230\u53ef\u7528 WAC\uff0c\u4e0d\u4f1a\u4fee\u6539\u73b0\u6709 Landing Cost\u3002',syncWacDone:'WAC \u6279\u91cf\u540c\u6b65\u5b8c\u6210',downloadTemplate:'\u4e0b\u8f7d\u5bfc\u5165\u6a21\u677f',templateInstructions:'\u586b\u5199\u8bf4\u660e',templateSku:'SKU \u7f16\u7801\u7531\u7cfb\u7edf\u63d0\u4f9b\uff0c\u8bf7\u52ff\u4fee\u6539\u3002',templateSrp:'\u586b\u5199 SRP \u548c\u9002\u7528\u7c7b\u76ee\u7684\u8d39\u7528\u5b57\u6bb5\uff1b\u7559\u7a7a\u8868\u793a\u4e0d\u4fee\u6539\u3002',templateLanding:'Landing Cost \u4e0d\u901a\u8fc7 Excel \u5bfc\u5165\uff1b\u52fe\u9009\u4e86 WAC \u81ea\u52a8\u540c\u6b65\u7684\u5b57\u6bb5\u7531\u7cfb\u7edf\u66f4\u65b0\u3002',templateStock:'\u7c7b\u76ee\u4ec5\u4f9b\u53c2\u8003\uff1b\u5e93\u5b58\u81ea\u52a8\u540c\u6b65\uff0c\u4e0d\u9700\u8981\u586b\u5199\u3002'},
en:{title:'Price System',subtitle:'Maintain separate pricing schemes by country, brand and sales channel',scheme:'Pricing Scheme',newScheme:'New Scheme',blankScheme:'Create Blank Scheme',copyScheme:'Copy Existing Scheme',copySource:'Choose a scheme to copy',copySourcePlaceholder:'Select an existing pricing scheme',copySchemeHelp:'Copies fee fields, category scopes, field order, frozen-column settings, cross-channel references and SRP formulas. SKU-specific prices, fee values and WAC data are not copied.',copyAndCreate:'Copy & Create',copySchemeEmpty:'No pricing schemes available to copy',copySourceRequired:'Select a pricing scheme to copy',copySchemeCreated:'Pricing scheme copied',fields:'Fee Fields',fieldOrderTitle:'Field Order',fieldOrderHint:'Drag the handle on the left to change the column order in the price table.',freezeTo:'Freeze through',freezeNone:'None',freezeSaved:'Frozen columns saved',freezeHint:'Freeze the selected column and all columns to its left.',fieldEditorHint:'Set the field name, type and applicable categories. Changes apply to this pricing scheme.',basicInfo:'Basic Information',scopeInfo:'Applicable Scope',calculationInfo:'Calculation Settings',systemField:'System Field',savingOrder:'Saving order…',orderSaved:'Field order saved',fieldCount:'fields',formula:'SRP Formula',history:'Version History',viewChanges:'View Changes',changeDetails:'Change Details',changeSummary:'Change Summary',settingsChanges:'Settings Changes',skuDataChanges:'SKU Data Changes',changeType:'Change Type',changeTarget:'Item',beforeValue:'Before',afterValue:'After',noChanges:'No actual data changes were detected in this version.',initialVersion:'Initial version (no previous version)',compareWith:'Compared with version',previousPage:'Previous',nextPage:'Next',page:'Page',totalItems:'{count} items',fieldAdded:'Field added',fieldRemoved:'Field removed',fieldUpdated:'Field updated',fieldChanges:'Field changes',schemeUpdated:'Scheme settings',status:'Status',manualValue:'Manual Fee',srpValue:'SRP',landingCost:'Landing Cost',added:'Added',removed:'Removed',updated:'Updated',import:'Import Excel',export:'Export Excel',save:'Save Changes',saved:'Saved successfully',loading:'Loading price data…',emptyTitle:'No pricing scheme yet',emptyHint:'Create a scheme for a country, brand and sales channel before maintaining SKU prices.',country:'Country',brand:'Brand',platform:'Sales Channel',shop:'Shop',currency:'Currency',category:'Category',sku:'SKU',stock:'Stock Qty',forecastAvg:'{days}-Day Avg Monthly Sales',availableTurnover:'Current Available Turnover',daysSinceInbound:'Last inbound {days} days ago',daysSinceInboundUnknown:'Last inbound date unknown',daysSinceInboundHeader:'Days Since Last Inbound',sortHint:'Click to sort: descending / ascending / default',srp:'SRP',noData:'No SKU master data for this brand',noFields:'No fee fields configured. Add the price items you need to maintain.',add:'Add',edit:'Edit',delete:'Delete',cancel:'Cancel',confirm:'Confirm',close:'Close',fieldName:'Field Name',fieldKey:'Field Key',fieldType:'Field Type',unit:'Display Unit',displayFormat:'Cell Format',decimalPlaces:'Decimal Places',formatAuto:'Auto',formatAmount:'Amount',formatNumber:'Number',formatPercent:'Percentage',amount:'Amount',percent:'Percentage',number:'Number',calc:'Formula',reference:'Reference Another Scheme Field',referenceType:'Reference',referenceSourceScheme:'Source Scheme',referenceSourceField:'Referenced Field',referenceHelp:'The system matches the source field by the same SKU and reads the latest value whenever this scheme is loaded. The source currency is preserved; no FX conversion is applied.',referencePreview:'Reference Preview',referenceLoading:'Loading source fields…',referenceNoFields:'No fields are available in the source scheme.',referenceNoSchemes:'No other sales-channel schemes exist for this country and brand.',switchChannel:'Switch Sales Channel',addChannel:'Add Sales Channel Scheme',syncWacField:'Sync WAC automatically',syncWacFieldHelp:'When enabled, the system matches the latest valid confirmed WAC by SKU, country and brand. This field updates automatically and does not need manual maintenance.',syncQuotationField:'Sync Latest Quotation Automatically',syncQuotationFieldHelp:'When enabled, the latest quote in Quotation Management is matched by brand and SKU. The original currency is retained and shown with its currency symbol; no FX conversion is applied.',quoteSource:'Quotation auto-sync',quoteCurrency:'Quote currency',wacSource:'WAC auto sync',formulaText:'Formula',categoryFormulaRules:'Formula Rules by Category',addCategoryRule:'Add Category Rule',previewCategoryFormula:'Validate & Preview',categoryFormulaEmpty:'No product categories are available. Maintain categories in SKU master first.',categoryFormulaPreviewEmpty:'Enter a formula, then validate and preview it.',categoryFormulaPreviewOk:'Formula validated',allCategories:'Apply to all categories',categoryScope:'Applicable Categories',allCategoriesHelp:'Leave blank to apply to all categories.',selectAllCategories:'Select all',percentSettings:'Percentage Settings',defaultPercent:'Default Percentage',batchApplyPercent:'Apply to matched SKUs',percentBatchHint:'Apply this percentage to SKUs in the current scope. You can still edit each SKU separately in the price list.',percentRequired:'Enter a valid non-negative percentage.',percentApplied:'Percentage applied to applicable SKUs',noPercentSkus:'No SKUs match the current scope.',formulaHelp:'Supports +, -, *, /, parentheses, %, MIN() and MAX(). A leading = is optional. Example: MIN(srp*6.5%,80000). Percentage fields store 8 for 8%; the formula engine automatically converts them to 0.08 when referenced. Do not divide by 100 manually.',formulaFields:'Available Fields',formulaRulesTitle:'Formula Rules',addFormulaRule:'Add Formula',copyFormulaRule:'Copy',formulaRuleLabel:'Formula',formulaText:'Formula',formulaApplyCategories:'Applicable Categories',formulaApplyCategoriesHint:'Choose the product categories this formula applies to. Multiple selections are allowed.',searchCategories:'Search categories',clearCategories:'Clear',selectedCount:'Selected',selectedCategories:'Selected Categories',formulaAppliedToCategories:'This formula applies to',chooseFormulaCategories:'Select the categories for this formula.',formulaEnterHint:'Enter a formula, then validate and preview.',formulaValidating:'Validating and previewing…',formulaValidPreview:'Validation passed',formulaValidationFailed:'Formula validation failed',formulaRequired:'Enter a formula first.',formulaRuleIncomplete:'Each formula rule needs an expression and at least one category.',formulaCategoryDuplicate:'A category is selected in multiple formula rules. Please resolve the overlap.',formulaCategoryAssigned:'This category is already assigned to another formula rule.',noFormulaRules:'No formula rules yet. Click “Add Formula”.',noProductCategories:'No product categories.',formulaBaseFields:'Base Data',formulaFeeFields:'Other Fee Fields',formulaPriceFields:'Price Fields',formulaNoFeeFields:'No other fee fields configured',formulaOperators:'Operators',formulaFunctions:'Functions',formulaPreviewHint:'The formula is validated automatically. Preview uses the first SKU in this pricing scheme.',formulaPreviewValid:'Formula is valid',formulaPreviewResult:'Preview result',formulaPreviewSample:'Preview SKU',formulaPreviewEmpty:'Enter a formula to validate and preview it.',formulaPreviewNoSku:'No SKU data; preview uses zero values.',formulaPreviewError:'Formula error',formulaBuilderHint:'Click a field, function, or operator to insert it, or type directly. Entering a formula switches this field to Formula automatically.',systemLandingCost:'System Landing Cost',srpManualHint:'Edit SRP directly in the list. A manual value overrides the formula; clear it to restore the formula result.',srpReferenceManualHint:'A manual value overrides the referenced value; clear it to return to the source field value.',skuMasterPurchasePriceRmb:'SKU Master Purchase Price RMB',skuMasterPurchasePriceUsd:'SKU Master Purchase Price USD',standardPurchasePrice:'Standard Purchase Price',weightedAvgCost:'SKU Master Weighted Average Cost',latestConfirmedWac:'Latest Confirmed WAC',customsRate:'Reference Customs Rate',inventoryQty:'Inventory Quantity',formulaEmpty:'Leave blank to keep SRP calculation disabled.',version:'Version',restore:'Restore this version',importHint:'Use the template for SRP and manual fee fields. WAC-enabled fields are updated automatically from confirmed WAC; stock is synced automatically.',importDone:'Excel import completed',exportDone:'Excel exported',unsaved:'You have unsaved changes. Switch scheme anyway?',discardChanges:'You have unsaved changes. Continuing will discard them. Continue?',schemeCreated:'Pricing scheme created',fieldSaved:'Fee field saved',formulaSaved:'SRP formula saved',restored:'Historical version restored',noHistory:'No version history',stop:'Deactivate Scheme',stopConfirm:'Deactivate this pricing scheme? It will no longer appear in the scheme list.',actions:'Actions',deleteScheme:'Delete Scheme',deleteSchemeTitle:'Delete Pricing Scheme',deleteSchemeConfirm:'Are you sure you want to permanently delete this pricing scheme?',deleteSchemeWarning:'All SKU prices, fee fields, WAC cost links and version history for this scheme will be deleted. Original WAC history will not be affected. This action cannot be undone.',schemeDeleted:'Pricing scheme deleted',selectCountry:'Select a country',selectBrand:'Select a brand',enterPlatform:'Enter sales channel name',fieldKeyHint:'Lowercase letters, numbers and underscores only, e.g. platform_fee',saveFailed:'Save failed',skuRequired:'SKU column was not found in Excel',missingCategories:' SKUs have no category in SKU master. Maintain categories before applying category-specific fees.',landingCost:'Landing Cost',selectWac:'Select WAC',wacHistory:'WAC History',noWacHistory:'No confirmed WAC history is available for this SKU',latest:'Latest',choose:'Use this WAC',current:'Current',clearLandingCost:'Clear Landing Cost',warehouse:'Warehouse',ciNo:'CI No.',confirmedAt:'Confirmed At',inboundDate:'Inbound Date',manualSrp:'Manual Import',formulaSrp:'Formula',syncWac:'Sync WAC in Bulk',syncWacTitle:'Bulk Sync Landing Cost',syncWacDesc:'Match WAC history by SKU within this pricing scheme country and brand. The latest valid WAC is used for each SKU. Unmatched SKUs keep their existing values.',matched:'Matched',unmatched:'Unmatched',willUpdate:'To update',unchanged:'Unchanged',unmatchedSamples:'Unmatched SKUs',noWacMatch:'No valid WAC found. Existing Landing Cost values will not be changed.',syncWacDone:'Bulk WAC sync completed',downloadTemplate:'Download Import Template',templateInstructions:'Instructions',templateSku:'SKU codes are generated by the system. Do not edit them.',templateSrp:'Fill in SRP and fee fields applicable to each SKU category. Blank cells are not changed.',templateLanding:'Landing Cost is not imported from Excel. Fields configured for WAC auto sync are updated by the system.',templateStock:'Category is for reference. Stock is synced automatically.'},
id:{title:'Sistem Harga',subtitle:'Kelola skema harga berdasarkan negara, merek, dan saluran penjualan',scheme:'Skema Harga',newScheme:'Skema Baru',blankScheme:'Buat Skema Kosong',copyScheme:'Salin Skema yang Ada',copySource:'Pilih skema untuk disalin',copySourcePlaceholder:'Pilih skema harga yang ada',copySchemeHelp:'Menyalin kolom biaya, cakupan kategori, urutan kolom, pengaturan kolom beku, referensi antar saluran, dan rumus SRP. Harga dan nilai biaya per SKU serta data WAC tidak disalin.',copyAndCreate:'Salin & Buat',copySchemeEmpty:'Tidak ada skema harga untuk disalin',copySourceRequired:'Pilih skema harga yang akan disalin',copySchemeCreated:'Skema harga berhasil disalin',fields:'Kolom Biaya',fieldOrderTitle:'Urutan Kolom',fieldOrderHint:'Tarik pegangan di kiri untuk mengubah urutan kolom pada tabel harga.',freezeTo:'Bekukan hingga',freezeNone:'Tidak dibekukan',freezeSaved:'Pengaturan kolom beku disimpan',freezeHint:'Bekukan kolom yang dipilih dan semua kolom di sebelah kirinya.',fieldEditorHint:'Atur nama, jenis, dan kategori yang berlaku. Perubahan diterapkan pada skema harga ini.',basicInfo:'Informasi Dasar',scopeInfo:'Cakupan Kategori',calculationInfo:'Pengaturan Perhitungan',systemField:'Kolom Sistem',savingOrder:'Menyimpan urutan…',orderSaved:'Urutan kolom disimpan',fieldCount:'kolom',formula:'Rumus SRP',history:'Riwayat Versi',viewChanges:'Lihat Perubahan',changeDetails:'Detail Perubahan',changeSummary:'Ringkasan Perubahan',settingsChanges:'Perubahan Pengaturan',skuDataChanges:'Perubahan Data SKU',changeType:'Jenis Perubahan',changeTarget:'Objek',beforeValue:'Sebelum',afterValue:'Sesudah',noChanges:'Tidak ada perubahan data aktual pada versi ini.',initialVersion:'Versi awal (tanpa versi sebelumnya)',compareWith:'Dibandingkan dengan versi',previousPage:'Sebelumnya',nextPage:'Berikutnya',page:'Halaman',totalItems:'{count} item',fieldAdded:'Kolom ditambahkan',fieldRemoved:'Kolom dihapus',fieldUpdated:'Kolom diubah',fieldChanges:'Perubahan kolom',schemeUpdated:'Pengaturan skema',status:'Status',manualValue:'Biaya Manual',srpValue:'SRP',landingCost:'Landing Cost',added:'Ditambahkan',removed:'Dihapus',updated:'Diubah',import:'Impor Excel',export:'Ekspor Excel',save:'Simpan Perubahan',saved:'Berhasil disimpan',loading:'Memuat data harga…',emptyTitle:'Belum ada skema harga',emptyHint:'Buat skema berdasarkan negara, merek, platform, dan toko terlebih dahulu.',country:'Negara',brand:'Merek',platform:'Saluran Penjualan',shop:'Toko',currency:'Mata Uang',category:'Kategori',sku:'SKU',stock:'Jumlah Stok',forecastAvg:'Rata-rata penjualan bulanan {days} hari',availableTurnover:'Perputaran Stok Tersedia',daysSinceInbound:'Terakhir masuk {days} hari lalu',daysSinceInboundUnknown:'Tanggal masuk terakhir tidak diketahui',daysSinceInboundHeader:'Hari Sejak Masuk Terakhir',sortHint:'Klik untuk mengurutkan: menurun / menaik / default',srp:'SRP',noData:'Belum ada data SKU untuk merek ini',noFields:'Belum ada kolom biaya. Tambahkan item harga yang perlu dikelola.',add:'Tambah',edit:'Edit',delete:'Hapus',cancel:'Batal',confirm:'Konfirmasi',close:'Tutup',fieldName:'Nama Kolom',fieldKey:'Kode Kolom',fieldType:'Jenis Kolom',unit:'Satuan Tampilan',displayFormat:'Format Sel',decimalPlaces:'Jumlah Desimal',formatAuto:'Otomatis',formatAmount:'Jumlah',formatNumber:'Angka',formatPercent:'Persentase',amount:'Jumlah',percent:'Persentase',number:'Angka',calc:'Rumus',reference:'Referensi Kolom Skema Lain',referenceType:'Referensi',referenceSourceScheme:'Skema Sumber',referenceSourceField:'Kolom Referensi',referenceHelp:'Sistem mencocokkan kolom sumber berdasarkan SKU yang sama dan membaca nilai terbaru saat skema ini dimuat ulang. Mata uang sumber dipertahankan; tidak ada konversi kurs otomatis.',referencePreview:'Pratinjau Referensi',referenceLoading:'Memuat kolom sumber…',referenceNoFields:'Tidak ada kolom yang dapat dirujuk pada skema sumber.',referenceNoSchemes:'Tidak ada skema saluran penjualan lain untuk negara dan merek ini.',switchChannel:'Ganti Saluran Penjualan',addChannel:'Tambah Skema Saluran Penjualan',syncWacField:'Sinkronkan WAC otomatis',syncWacFieldHelp:'Jika diaktifkan, sistem mencocokkan WAC terkonfirmasi terbaru berdasarkan SKU, negara, dan merek. Kolom ini diperbarui otomatis.',syncQuotationField:'Sinkronkan Penawaran Terbaru Otomatis',syncQuotationFieldHelp:'Jika diaktifkan, penawaran terbaru di Manajemen Penawaran dicocokkan berdasarkan merek dan SKU. Mata uang asli dipertahankan dan ditampilkan dengan simbolnya; tanpa konversi kurs.',quoteSource:'Sinkronisasi penawaran otomatis',quoteCurrency:'Mata uang penawaran',wacSource:'Sinkronisasi WAC otomatis',formulaText:'Rumus',categoryFormulaRules:'Aturan Rumus per Kategori',addCategoryRule:'Tambah Aturan Kategori',previewCategoryFormula:'Validasi & Pratinjau',categoryFormulaEmpty:'Tidak ada kategori produk. Atur kategori di master SKU terlebih dahulu.',categoryFormulaPreviewEmpty:'Masukkan rumus, lalu validasi dan pratinjau.',categoryFormulaPreviewOk:'Rumus valid',allCategories:'Semua kategori',categoryScope:'Kategori yang Berlaku',allCategoriesHelp:'Kosongkan untuk menerapkan ke semua kategori.',selectAllCategories:'Pilih semua',percentSettings:'Pengaturan Persentase',defaultPercent:'Persentase Default',batchApplyPercent:'Terapkan ke SKU yang cocok',percentBatchHint:'Terapkan persentase ini ke SKU dalam cakupan saat ini. Setiap SKU tetap dapat diedit secara terpisah di daftar harga.',percentRequired:'Masukkan persentase non-negatif yang valid.',percentApplied:'Persentase berhasil diterapkan ke SKU terkait',noPercentSkus:'Tidak ada SKU yang cocok dengan cakupan ini.',formulaHelp:'Mendukung +, -, *, /, tanda kurung, %, MIN(), dan MAX(). Awalan = opsional. Contoh: MIN(srp*6.5%,80000). Nilai kolom persentase 8 berarti 8%; mesin rumus otomatis mengubahnya menjadi 0,08 saat dirujuk. Tidak perlu membaginya dengan 100 secara manual.',formulaFields:'Kolom yang Tersedia',formulaRulesTitle:'Aturan Rumus',addFormulaRule:'Tambah Rumus',copyFormulaRule:'Salin',formulaRuleLabel:'Rumus',formulaText:'Rumus',formulaApplyCategories:'Kategori Berlaku',formulaApplyCategoriesHint:'Pilih kategori produk untuk rumus ini. Anda dapat memilih beberapa kategori.',searchCategories:'Cari kategori',clearCategories:'Hapus Pilihan',selectedCount:'Dipilih',selectedCategories:'Kategori Terpilih',formulaAppliedToCategories:'Rumus ini berlaku untuk',chooseFormulaCategories:'Pilih kategori untuk rumus ini.',formulaEnterHint:'Masukkan rumus, lalu validasi dan pratinjau.',formulaValidating:'Memvalidasi dan melihat pratinjau…',formulaValidPreview:'Validasi berhasil',formulaValidationFailed:'Validasi rumus gagal',formulaRequired:'Masukkan rumus terlebih dahulu.',formulaRuleIncomplete:'Setiap aturan rumus harus memiliki rumus dan minimal satu kategori.',formulaCategoryDuplicate:'Satu kategori dipilih pada beberapa aturan rumus. Periksa kembali pilihan kategori.',formulaCategoryAssigned:'Kategori ini sudah ditetapkan ke aturan rumus lain.',noFormulaRules:'Belum ada aturan rumus. Klik “Tambah Rumus”.',noProductCategories:'Tidak ada kategori produk.',formulaBaseFields:'Data Dasar',formulaFeeFields:'Kolom Biaya Lain',formulaPriceFields:'Kolom Harga',formulaNoFeeFields:'Belum ada kolom biaya lain',formulaOperators:'Operator',formulaFunctions:'Fungsi',formulaPreviewHint:'Rumus divalidasi otomatis. Pratinjau menggunakan SKU pertama pada skema harga ini.',formulaPreviewValid:'Rumus valid',formulaPreviewResult:'Hasil pratinjau',formulaPreviewSample:'SKU pratinjau',formulaPreviewEmpty:'Masukkan rumus untuk validasi dan pratinjau.',formulaPreviewNoSku:'Tidak ada data SKU; pratinjau menggunakan nilai nol.',formulaPreviewError:'Kesalahan rumus',formulaBuilderHint:'Klik kolom, fungsi, atau operator untuk menyisipkannya, atau ketik langsung. Mengisi rumus otomatis mengubah jenis kolom menjadi Rumus.',systemLandingCost:'Landing Cost Sistem',srpManualHint:'SRP dapat diedit langsung di daftar. Nilai manual menggantikan hasil rumus; kosongkan untuk kembali ke hasil rumus.',srpReferenceManualHint:'Nilai manual menggantikan nilai referensi; kosongkan untuk kembali ke nilai dari kolom sumber.',skuMasterPurchasePriceRmb:'Harga Beli Master SKU RMB',skuMasterPurchasePriceUsd:'Harga Beli Master SKU USD',standardPurchasePrice:'Harga Beli Standar',weightedAvgCost:'Biaya Rata-rata Tertimbang Master SKU',latestConfirmedWac:'WAC Terkonfirmasi Terbaru',customsRate:'Tarif Bea Cukai Referensi',inventoryQty:'Jumlah Persediaan',formulaEmpty:'Kosongkan jika SRP belum dihitung.',version:'Versi',restore:'Pulihkan versi ini',importHint:'Gunakan template untuk SRP dan kolom biaya manual. Kolom dengan sinkronisasi WAC aktif diperbarui otomatis dari WAC terkonfirmasi; stok juga disinkronkan otomatis.',importDone:'Impor Excel selesai',exportDone:'Excel diekspor',unsaved:'Ada perubahan yang belum disimpan. Tetap ganti skema?',discardChanges:'Ada perubahan yang belum disimpan. Melanjutkan akan membuang perubahan tersebut. Lanjutkan?',schemeCreated:'Skema harga dibuat',fieldSaved:'Kolom biaya disimpan',formulaSaved:'Rumus SRP disimpan',restored:'Versi sebelumnya dipulihkan',noHistory:'Belum ada riwayat versi',stop:'Nonaktifkan Skema',stopConfirm:'Nonaktifkan skema harga ini? Skema tidak akan muncul lagi di daftar.',actions:'Tindakan',deleteScheme:'Hapus Skema',deleteSchemeTitle:'Hapus Skema Harga',deleteSchemeConfirm:'Yakin ingin menghapus skema harga ini secara permanen?',deleteSchemeWarning:'Harga SKU, kolom biaya, tautan biaya WAC, dan riwayat versi untuk skema ini akan dihapus. Riwayat WAC asli tidak akan terpengaruh. Tindakan ini tidak dapat dibatalkan.',schemeDeleted:'Skema harga dihapus',selectCountry:'Pilih negara',selectBrand:'Pilih merek',enterPlatform:'Masukkan nama saluran penjualan',fieldKeyHint:'Gunakan huruf kecil, angka, dan garis bawah, contoh platform_fee',saveFailed:'Gagal menyimpan',skuRequired:'Kolom SKU tidak ditemukan di Excel',missingCategories:' SKU belum memiliki kategori pada data master. Lengkapi kategori sebelum menerapkan biaya per kategori.',landingCost:'Landing Cost',selectWac:'Pilih WAC',wacHistory:'Riwayat WAC',noWacHistory:'Tidak ada riwayat WAC terkonfirmasi untuk SKU ini',latest:'Terbaru',choose:'Gunakan WAC ini',current:'Digunakan',clearLandingCost:'Hapus Landing Cost',warehouse:'Gudang',ciNo:'No. CI',confirmedAt:'Waktu Konfirmasi',inboundDate:'Tanggal Masuk',manualSrp:'Impor Manual',formulaSrp:'Rumus',syncWac:'Sinkronkan WAC Massal',syncWacTitle:'Sinkronisasi Landing Cost Massal',syncWacDesc:'Cocokkan riwayat WAC berdasarkan SKU, negara, dan merek pada skema ini. Gunakan WAC valid terbaru untuk setiap SKU. SKU tanpa kecocokan mempertahankan nilai lama.',matched:'Cocok',unmatched:'Tidak cocok',willUpdate:'Akan diperbarui',unchanged:'Tidak berubah',unmatchedSamples:'SKU tidak cocok',noWacMatch:'WAC valid tidak ditemukan. Landing Cost yang ada tidak akan diubah.',syncWacDone:'Sinkronisasi WAC massal selesai',downloadTemplate:'Unduh Template Impor',templateInstructions:'Petunjuk',templateSku:'Kode SKU dibuat oleh sistem. Jangan diubah.',templateSrp:'Isi SRP dan kolom biaya yang berlaku untuk kategori SKU. Sel kosong tidak akan mengubah data.',templateLanding:'Landing Cost tidak diimpor dari Excel. Kolom dengan sinkronisasi WAC aktif diperbarui otomatis oleh sistem.',templateStock:'Kategori hanya referensi. Stok disinkronkan otomatis.'},sourceLabel:"来源",defaultCurrencyHelp:"根据所选国家自动带入默认币种，也可以手动调整",optionalStore:"店铺名称（选填）",enabled:"开启",disabled:"关闭",sourceLabel:"Source",defaultCurrencyHelp:"The default currency is filled based on the selected country. You can also change it manually.",optionalStore:"Store name (optional)",enabled:"Enabled",disabled:"Disabled",sourceLabel:"Sumber",defaultCurrencyHelp:"Mata uang default akan diisi berdasarkan negara yang dipilih. Anda juga dapat mengubahnya secara manual.",optionalStore:"Nama toko (opsional)",enabled:"Aktif",disabled:"Nonaktif"
};
const state={countries:[],skus:[],brands:[],schemes:[],schemeId:'',scheme:null,fields:[],rows:[],forecastStatsDays:90,dirty:{},orderSaving:false,freezeSaving:false,draggingFieldId:'',schemeCreateMode:'blank',schemeCopySourceId:'',referenceDataCache:{},_psUseCachedView:false};

 // ==================== 价格方案瞬时切换缓存 ====================
 // 对齐订单预测：保留最近 6 个真实 DOM 视图，并缓存每个方案的数据快照。
 // 切换时优先恢复原 DOM（含排序、横向/纵向滚动与冻结列）；未访问方案使用后台预取数据。
 const PS_SCHEME_DATA_TTL=45000;
 const PS_MAX_SCHEME_DATA=12;
 const PS_MAX_SCHEME_VIEWS=6;
 const PS_MAX_SCHEME_PREFETCH=8;
 window._psSchemeCache=window._psSchemeCache||{data:new Map(),pending:new Map(),views:new Map(),viewOrder:[],sequence:0,generation:0,prefetchGeneration:0,scope:''};
 function psCurrentCacheScope(){
  const user=(typeof currentUser!=='undefined'&&currentUser)||window.currentUser||{};
  const permissions=Array.isArray(user.permissions)?user.permissions.slice().sort().join(','):'';
  let dataScope='';try{dataScope=JSON.stringify(user.data_scope||user.dataScope||{});}catch(e){}
  return [user.id||user.user_id||user.username||'',user.role||'',permissions,dataScope].join('|');
 }
 function psRemoveSchemeView(id){
  const cache=window._psSchemeCache,key=String(id||''),view=cache.views.get(key);
  if(view&&view.node&&!view.node.isConnected)view.node.remove();
  cache.views.delete(key);
  const index=cache.viewOrder.indexOf(key);if(index>=0)cache.viewOrder.splice(index,1);
 }
 function psInvalidateAllSchemeCaches(){
  const cache=window._psSchemeCache;
  cache.generation++;cache.prefetchGeneration++;
  cache.data.clear();cache.pending.clear();
  cache.views.forEach(view=>{if(view&&view.node&&!view.node.isConnected)view.node.remove();});
  cache.views.clear();cache.viewOrder=[];
 }
 function psEnsureCacheScope(){
  const cache=window._psSchemeCache,scope=psCurrentCacheScope();
  if(cache.scope!==scope){psInvalidateAllSchemeCaches();cache.scope=scope;}
 }
 function psTouchSchemeData(id){
  const cache=window._psSchemeCache,key=String(id||''),entry=cache.data.get(key);
  if(!entry)return null;
  cache.data.delete(key);cache.data.set(key,entry);return entry;
 }
 function psGetSchemeData(id){
  psEnsureCacheScope();
  return psTouchSchemeData(id);
 }
 function psSetSchemeData(id,data,generation){
  const cache=window._psSchemeCache,key=String(id||'');
  if(!key||generation!==cache.generation)return null;
  const entry={data,fetchedAt:Date.now(),version:++cache.sequence,scope:cache.scope};
  cache.data.delete(key);cache.data.set(key,entry);
  while(cache.data.size>PS_MAX_SCHEME_DATA){
   const oldest=cache.data.keys().next().value;
   cache.data.delete(oldest);psRemoveSchemeView(oldest);
  }
  return entry;
 }
 function psFetchSchemeData(id,force){
  psEnsureCacheScope();
  const cache=window._psSchemeCache,key=String(id||'');
  if(!key)return Promise.reject(new Error('Missing price scheme ID'));
  const cached=psGetSchemeData(key);
  if(!force&&cached&&Date.now()-cached.fetchedAt<PS_SCHEME_DATA_TTL)return Promise.resolve(cached.data);
  if(cache.pending.has(key))return cache.pending.get(key);
  const generation=cache.generation;
  let promise;
  promise=api('/api/price-system/schemes/'+encodeURIComponent(key)+'/data')
   .then(data=>{
    if(!data||data.error)throw new Error(data&&data.error||tr('saveFailed'));
    if(generation!==cache.generation)return psFetchSchemeData(key,true);
    psSetSchemeData(key,data,generation);
    return data;
   })
   .finally(()=>{if(cache.pending.get(key)===promise)cache.pending.delete(key);});
  cache.pending.set(key,promise);
  return promise;
 }
 function psSchemeViewLanguage(){return typeof getLang==='function'?getLang():'zh';}
 function psGetSchemeView(id){
  psEnsureCacheScope();
  const cache=window._psSchemeCache,key=String(id||''),view=cache.views.get(key),data=cache.data.get(key);
  if(!view||!data||view.version!==data.version||view.scope!==cache.scope||view.language!==psSchemeViewLanguage()){
   if(view)psRemoveSchemeView(key);
   return null;
  }
  return view;
 }
 function psTouchSchemeView(id){
  const cache=window._psSchemeCache,key=String(id||''),index=cache.viewOrder.indexOf(key);
  if(index>=0)cache.viewOrder.splice(index,1);
  if(cache.views.has(key))cache.viewOrder.push(key);
 }
 function psCaptureSchemeView(id){
  const cache=window._psSchemeCache,key=String(id||''),view=cache.views.get(key);
  if(!view||!view.node)return;
  const scroller=view.node.querySelector('.ps-table-wrap');
  if(scroller){view.scrollTop=scroller.scrollTop;view.scrollLeft=scroller.scrollLeft;}
 }
 function psStoreSchemeView(id,node){
  if(!id||!node)return;
  const cache=window._psSchemeCache,key=String(id);
  const previous=cache.views.get(key);
  let scrollTop=previous?Number(previous.scrollTop||0):0,scrollLeft=previous?Number(previous.scrollLeft||0):0;
  if(previous&&previous.node){
   const oldScroller=previous.node.querySelector('.ps-table-wrap');
   if(oldScroller){scrollTop=oldScroller.scrollTop;scrollLeft=oldScroller.scrollLeft;}
   if(previous.node!==node&&!previous.node.isConnected)previous.node.remove();
  }
  let data=cache.data.get(key);
  if(!data)data=psSetSchemeData(key,{scheme:state.scheme,fields:state.fields,rows:state.rows,forecast_stats_days:state.forecastStatsDays},cache.generation);
  const scroller=node.querySelector('.ps-table-wrap');
  if(scroller){scroller.scrollTop=scrollTop;scroller.scrollLeft=scrollLeft;}
  cache.views.set(key,{node,version:data?data.version:0,scope:cache.scope,language:psSchemeViewLanguage(),scrollTop,scrollLeft});
  const index=cache.viewOrder.indexOf(key);if(index>=0)cache.viewOrder.splice(index,1);
  cache.viewOrder.push(key);
  while(cache.viewOrder.length>PS_MAX_SCHEME_VIEWS){
   const oldest=cache.viewOrder.shift(),view=cache.views.get(oldest);
   if(view&&view.node&&view.node.parentNode)view.node.remove();
   cache.views.delete(oldest);
  }
 }
 function psApplySchemeData(data){
  state.scheme=data.scheme;state.fields=data.fields||[];state.rows=data.rows||[];
  state.forecastStatsDays=Number(data.forecast_stats_days)||90;
 }
 function psScheduleSchemePrefetch(currentId){
  psEnsureCacheScope();
  const current=state.schemes.find(item=>String(item.id)===String(currentId));
  if(!current)return;
  const related=state.schemes.filter(item=>String(item.id)!==String(currentId)&&String(item.country||'')===String(current.country||'')&&String(item.brand||'')===String(current.brand||''));
  const others=state.schemes.filter(item=>String(item.id)!==String(currentId)&&!related.some(match=>String(match.id)===String(item.id)));
  const ids=related.concat(others).slice(0,PS_MAX_SCHEME_PREFETCH).map(item=>String(item.id));
  const cache=window._psSchemeCache,generation=++cache.prefetchGeneration;
  const run=async()=>{
   for(const id of ids){
    if(generation!==cache.prefetchGeneration)return;
    const cached=psGetSchemeData(id);
    if(cached&&Date.now()-cached.fetchedAt<PS_SCHEME_DATA_TTL)continue;
    try{await psFetchSchemeData(id,false);}catch(e){}
   }
   psTouchSchemeData(currentId);
  };
  if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(()=>run(),{timeout:900});
  else setTimeout(()=>run(),120);
 }
 function psPriceSystemMutationAffectsCache(url){
  const path=String(url||'').split('?')[0];
  if(path.indexOf('/api/price-system/schemes')===0){
   if(path.indexOf('/formula/preview')>=0||path.indexOf('/formula/recalculate-preview')>=0)return false;
   return true;
  }
  return ['/api/inventory','/api/inventory-imports','/api/replenishment-suggestions','/api/sales','/api/quotations','/api/quotation-management','/api/wac','/api/wac-history','/api/skus','/api/sku-master']
   .some(prefix=>path===prefix||path.indexOf(prefix+'/')===0);
 }
 function psInstallApiMutationInvalidation(){
  if(window.__psSchemeApiWrapped||typeof window.api!=='function')return;
  const originalApi=window.api;
  const wrappedApi=async function(url,method,body,options){
   const result=await originalApi.call(this,url,method,body,options);
   const verb=String(method||'GET').toUpperCase();
   if(verb!=='GET'&&psPriceSystemMutationAffectsCache(url))psInvalidateAllSchemeCaches();
   return result;
  };
  wrappedApi.__psSchemeApiWrapped=true;
  window.api=wrappedApi;
  window.__psSchemeApiWrapped=true;
 }
 psInstallApiMutationInvalidation();

function tr(k){const l=typeof getLang==='function'?getLang():'zh';return (TXT[l]&&TXT[l][k])||TXT.zh[k]||k;}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmt(v){const n=Number(v);return v==null||v===''||!Number.isFinite(n)?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function forecastAverageLabel(){return tr('forecastAvg').replace('{days}',String(state.forecastStatsDays||90));}
function psFreezeColumnOptions(){
 const base=[
  {key:'__category',label:tr('category')},
  {key:'__sku',label:tr('sku')},
  {key:'__forecast_avg_sales',label:forecastAverageLabel()},
  {key:'__stock_qty',label:tr('stock')},
  {key:'__available_turnover',label:tr('availableTurnover')}
 ];
 const seen=new Set(base.map(item=>item.key));
 state.fields.forEach(field=>{
  const key=String(field&&field.field_key||'').trim();
  if(key&&!seen.has(key)){seen.add(key);base.push({key,label:String(field.field_name||key)});}
 });
 return [{key:'none',label:tr('freezeNone')}].concat(base);
}
function psCurrentFreezeFieldKey(){
 const raw=state.scheme&&state.scheme.freeze_field_key;
 const key=raw==null||String(raw)===''?'__sku':String(raw);
 return psFreezeColumnOptions().some(option=>option.key===key)?key:'__sku';
}
function psApplyFrozenColumns(root){
 const table=root&&root.querySelector?root.querySelector('.ps-table-wrap table'):null;
 if(!table||!table.tHead||!table.tHead.rows.length)return;
 const options=psFreezeColumnOptions().filter(option=>option.key!=='none');
 const selected=psCurrentFreezeFieldKey();
 const targetIndex=selected==='none'?-1:options.findIndex(option=>option.key===selected);
 const freezeCount=targetIndex<0?0:targetIndex+1;
 const tableRows=Array.from(table.rows);
 table.querySelectorAll('.ps-frozen-cell').forEach(cell=>{
  cell.classList.remove('ps-frozen-cell','ps-frozen-last');
  cell.style.left='';
 });
 let left=0;
 for(let column=0;column<freezeCount;column++){
  const header=table.tHead.rows[0].cells[column];
  if(!header)continue;
  const width=header.getBoundingClientRect().width||header.offsetWidth||0;
  tableRows.forEach(row=>{
   const cell=row.cells[column];
   if(!cell)return;
   cell.classList.add('ps-frozen-cell');
   cell.style.left=left+'px';
   if(column===freezeCount-1)cell.classList.add('ps-frozen-last');
  });
  left+=width;
 }
}
function currencySymbol(code){const raw=String(code||'').trim().toUpperCase();if(!raw)return '';const dollar=String.fromCharCode(36),overrides={RMB:'¥',SGD:'S'+dollar,AUD:'A'+dollar,HKD:'HK'+dollar,CAD:'CA'+dollar,NZD:'NZ'+dollar,TWD:'NT'+dollar};if(overrides[raw])return overrides[raw];const normalized=raw==='RMB'?'CNY':raw;try{const part=new Intl.NumberFormat('en-US',{style:'currency',currency:normalized,currencyDisplay:'narrowSymbol',minimumFractionDigits:0,maximumFractionDigits:0}).formatToParts(0).find(x=>x.type==='currency');return part&&part.value||raw;}catch(_e){return raw;}}
function formatAmountInput(value,decimalPlaces){const n=Number(value);if(value==null||value===''||!Number.isFinite(n))return '';const p=Number.isFinite(Number(decimalPlaces))?Math.max(0,Math.min(6,Number(decimalPlaces))):2;return n.toLocaleString('en-US',{maximumFractionDigits:p});}
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
 '#ps-root .ps-toolbar{display:flex;align-items:center;gap:clamp(10px,1vw,16px);flex-wrap:nowrap;background:#fff;border:1px solid #e8e8ed;border-radius:10px;padding:9px 12px;margin-bottom:10px;min-height:54px;box-sizing:border-box}#ps-root .ps-toolbar-primary{display:flex;align-items:center;gap:9px;flex:0 0 auto;min-width:0}',
 '#ps-root .ps-toolbar label{font-size:12px;color:#777}#ps-root .ps-select{height:32px;border:1px solid #d2d2d7;border-radius:6px;background:#fff;padding:0 9px;color:#222;min-width:230px;font:inherit}',
 '#ps-root .ps-actions-menu-wrap{position:relative;display:inline-flex}#ps-root .ps-actions-toggle{display:inline-flex;align-items:center;gap:10px}#ps-root .ps-actions-caret{font-size:11px;color:inherit;transition:transform .15s}#ps-root .ps-actions-toggle[aria-expanded="true"] .ps-actions-caret{transform:rotate(180deg)}#ps-root .ps-actions-menu{position:absolute;top:calc(100% + 7px);right:0;z-index:40;min-width:205px;max-height:min(70vh,560px);overflow-y:auto;padding:5px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12)}#ps-root .ps-actions-menu[hidden]{display:none}#ps-root .ps-actions-menu button{display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:0 10px;border:0;border-radius:7px;background:#fff;color:#30343b;text-align:left;font:inherit;cursor:pointer}#ps-root .ps-actions-menu button:hover{background:#f2f6fb}#ps-root .ps-actions-menu button:disabled{opacity:.4;cursor:not-allowed}#ps-root .ps-actions-menu button.danger{color:#d93025}#ps-root .ps-actions-menu button.danger:hover{background:#fff2f0}#ps-root .ps-actions-menu .ps-menu-divider{height:1px;margin:5px 4px;background:#ececf0}#ps-root .ps-actions-menu .ps-menu-icon{width:16px;color:#727b87;text-align:center}#ps-root .ps-actions-menu button.danger .ps-menu-icon{color:#d93025}',
 '#ps-root .ps-meta{display:flex;align-items:center;gap:clamp(8px,1vw,14px);flex:1 1 auto;min-width:0;flex-wrap:nowrap;margin:0;overflow:hidden}#ps-root .ps-pill{background:transparent;color:#555;border-radius:0;padding:0;font-size:12px;white-space:nowrap}',
 '#ps-root .ps-channel-switcher{display:flex;align-items:center;gap:8px;flex:0 0 auto;flex-wrap:nowrap;margin:0 0 0 auto;padding:0;border:0;background:transparent}.ps-channel-switch-label{color:#707987;font-size:12px;white-space:nowrap}.ps-channel-buttons{display:flex;align-items:center;gap:6px;flex-wrap:nowrap}.ps-channel-button{height:30px;padding:0 13px;border:1px solid #dfe3e9;border-radius:999px;background:#fff;color:#4b5563;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.ps-channel-button:hover{background:#f6f8fb}.ps-channel-button.active{border-color:#8bb7f2;background:#eef5ff;color:#1769c2;font-weight:650}.ps-channel-add{height:30px;margin-left:6px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:#1769c2;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.ps-channel-add:hover{background:#f2f7ff}@media(max-width:1380px){#ps-root .ps-toolbar{flex-wrap:wrap}#ps-root .ps-meta{order:3;flex:1 1 100%;min-width:100%;padding-top:4px}#ps-root .ps-channel-switcher{margin-left:auto}}@media(max-width:760px){#ps-root .ps-toolbar-primary{flex-wrap:wrap;width:100%}#ps-root .ps-meta{flex-wrap:wrap;overflow:visible;min-width:0}#ps-root .ps-channel-switcher{margin-left:0;flex-wrap:wrap}}',
 '#ps-root .ps-card{background:#fff;border:1px solid #e8e8ed;border-radius:10px;overflow:hidden}#ps-root .ps-table-wrap{overflow:auto;max-height:calc(100vh - 270px);min-height:180px}',
 '#ps-root table{border-collapse:separate;border-spacing:0;width:max-content;min-width:0;table-layout:auto;font-size:12px}',
 '#ps-root th{position:sticky;top:0;z-index:2;background:#f7f7f9;color:#666;font-weight:600;text-align:center;padding:10px 9px;border-bottom:1px solid #e8e8ed;white-space:nowrap}',
 '#ps-root td{padding:7px 9px;border-bottom:1px solid #f0f0f2;white-space:nowrap;vertical-align:middle;text-align:center}#ps-root tbody tr:hover{background:#fafafa}',
 '#ps-root th:nth-child(1),#ps-root td:nth-child(1){width:120px;min-width:120px;max-width:120px}',
 '#ps-root th:nth-child(2),#ps-root td:nth-child(2){width:170px;min-width:170px;max-width:170px}',
 '#ps-root th.ps-frozen-cell{position:sticky;top:0;background:#f7f7f9;z-index:6}',
 '#ps-root td.ps-frozen-cell{position:sticky;background:#fff;z-index:4}',
 '#ps-root .ps-frozen-last{box-shadow:2px 0 5px rgba(0,0,0,.07)}',
 '#ps-root tbody tr:hover td.ps-frozen-cell{background:#fafafa}',
 '#ps-root .ps-category{color:#666;text-align:center}#ps-root .ps-sku{font-weight:600;color:#252525;text-align:center}#ps-root .ps-name{color:#555;max-width:220px;overflow:hidden;text-overflow:ellipsis}',
 '#ps-root .ps-stock{text-align:center;font-variant-numeric:tabular-nums}#ps-root .ps-stock.zero{color:#ff3b30;font-weight:700}#ps-root .ps-stock-meta{font-size:9px;line-height:1.3;color:#a1a1a6;font-weight:400;margin-top:1px;white-space:nowrap}',
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
 '.ps-freeze-control{display:inline-flex;align-items:center;gap:6px;color:#687385;font-size:11px;white-space:nowrap}.ps-freeze-select{height:32px;min-width:112px;max-width:180px;padding:0 8px;border:1px solid #dfe3e9;border-radius:8px;background:#fff;color:#303743;font:inherit;cursor:pointer}.ps-freeze-select:focus{outline:2px solid rgba(0,113,227,.14);border-color:#0071e3}.ps-freeze-select:disabled{opacity:.6;cursor:wait}',
 '.ps-fields-add{height:34px;padding:0 13px;border:1px solid #0071e3;border-radius:8px;background:#0071e3;color:#fff;font:inherit;font-weight:600;cursor:pointer}.ps-fields-add:hover{background:#0066cc}',
 '.ps-field-list{display:flex;flex-direction:column;gap:8px}',
 '.ps-field-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 13px;border:1px solid #e8eaef;border-radius:11px;background:#fff;transition:border-color .15s,background .15s,box-shadow .15s}',
 '.ps-field-row:hover{border-color:#d8dce3;background:#fcfcfd}.ps-field-row.is-dragging{opacity:.45}.ps-field-row.is-drag-over{border-color:#0071e3;background:#f3f8ff;box-shadow:inset 0 0 0 1px rgba(0,113,227,.12)}',
 '.ps-drag-handle{display:flex;align-items:center;justify-content:center;width:30px;height:36px;border:0;border-radius:7px;background:transparent;color:#a1a7b0;font-size:21px;line-height:1;cursor:grab;touch-action:none}.ps-drag-handle:hover{background:#f0f2f5;color:#626b78}.ps-drag-handle:active{cursor:grabbing}',
 '.ps-field-main{min-width:0}.ps-field-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.ps-field-name{min-width:0;font-size:13px;font-weight:650;color:#252a33}.ps-field-key{display:block;margin-top:2px;color:#8a919c;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
 '.ps-field-badges{display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap}.ps-field-badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border-radius:999px;background:#f1f3f5;color:#626b78;font-size:10px;font-weight:600;white-space:nowrap}.ps-field-badge.type-amount{background:#edf4ff;color:#3769a8}.ps-field-badge.type-percent{background:#f3efff;color:#7554a5}.ps-field-badge.type-formula{background:#f1f2f4;color:#5e6672}.ps-field-badge.is-wac{background:#edf7f0;color:#267344}.ps-field-badge.is-quote{background:#eef5ff;color:#3569a5}.ps-field-badge.is-system{background:#fff5e7;color:#946200}',
 '.ps-field-badge.type-reference{background:#edf4ff;color:#2769b2}.ps-reference-preview{margin-top:10px;padding:10px;border:1px solid #e7edf5;border-radius:9px;background:#fafcff}.ps-reference-preview-title{font-size:12px;font-weight:650;color:#344256}.ps-reference-preview-note{margin:5px 0 8px;color:#7c8796;font-size:11px}.ps-reference-preview-table{overflow:auto}.ps-reference-preview-table table{width:100%;border-collapse:collapse;font-size:11px}.ps-reference-preview-table th,.ps-reference-preview-table td{padding:6px 8px;border-bottom:1px solid #edf0f4;text-align:left;white-space:nowrap}.ps-reference-preview-table th{background:#f2f5fa;color:#667085;font-weight:600}',
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
 '.ps-version{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #eee}.ps-version-meta{color:#888;font-size:11px;margin-top:4px}.ps-version-actions{display:flex;align-items:center;gap:7px;flex:0 0 auto}.ps-version-diff-summary{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 13px}.ps-version-diff-pill{padding:5px 9px;border:1px solid #e4e8ee;border-radius:7px;background:#f8fafc;color:#4b5563;font-size:11px}.ps-version-diff-section{margin:14px 0 8px;color:#303743;font-size:13px;font-weight:650}.ps-version-diff-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}.ps-version-diff-table th{position:sticky;top:0;background:#f6f8fa;color:#657080;font-weight:600;text-align:left}.ps-version-diff-table th,.ps-version-diff-table td{padding:8px 9px;border-bottom:1px solid #edf0f3;vertical-align:top;overflow-wrap:anywhere}.ps-version-diff-table td:nth-last-child(2){background:#fff8f7;color:#9b3434}.ps-version-diff-table td:last-child{background:#f4fbf6;color:#17683a}.ps-version-diff-muted{color:#9299a3}.ps-version-diff-pagination{display:flex;align-items:center;justify-content:center;gap:12px;padding:12px 0;color:#687385;font-size:12px}.ps-version-diff-empty{padding:18px;text-align:center;color:#858d98;border:1px dashed #dfe4eb;border-radius:8px}.ps-version-diff-table-wrap{max-height:48vh;overflow:auto;border:1px solid #e8ecf1;border-radius:8px}@media(max-width:640px){.ps-version{align-items:flex-start;flex-direction:column}.ps-version-actions{width:100%;justify-content:flex-end}.ps-version-diff-table{min-width:620px}}',
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
async function loadData(id,options){
 options=options||{};
 const useCache=options.useCache!==false;
 cancelPendingPriceSystemFormulaPreviews();
 psEnsureCacheScope();
 state.schemeId=id||'';state.dirty={};state._psUseCachedView=false;
 if(!id){state.scheme=null;state.fields=[];state.rows=[];main();return;}
 const cached=useCache?psGetSchemeData(id):null;
 if(cached){
  psApplySchemeData(cached.data);
  state._psUseCachedView=!!psGetSchemeView(id);
  main();
  psTouchSchemeData(id);
  if(Date.now()-cached.fetchedAt>=PS_SCHEME_DATA_TTL)psFetchSchemeData(id,true).catch(()=>{});
  psScheduleSchemePrefetch(id);
  return;
 }
 state.scheme=null;state.fields=[];state.rows=[];main();
 try{
  const data=await psFetchSchemeData(id,true);
  if(state.schemeId!==id)return;
  psApplySchemeData(data);main();psScheduleSchemePrefetch(id);
 }catch(e){err(e);main();}
}
async function refreshDataPreservingDirty(id){
 const dirty=state.dirty;const d=await api('/api/price-system/schemes/'+encodeURIComponent(id)+'/data');if(state.schemeId!==id)return;
 state.scheme=d.scheme;state.fields=d.fields||[];state.rows=d.rows||[];state.forecastStatsDays=Number(d.forecast_stats_days)||90;state.dirty=dirty;main();
}
function schemeLabel(s){return [s.country,s.brand,s.sales_channel||s.platform,s.shop_name].filter(Boolean).join(' / ');}
function allowDiscardDirty(){const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);if(!n)return true;if(!confirm(tr('discardChanges')))return false;state.dirty={};main();return true;}
function fieldText(v,f){
 if(v==null||v==='')return '—';
 const format=String(f.display_format||'auto'),places=Math.max(0,Math.min(6,Number.isFinite(Number(f.decimal_places))?Number(f.decimal_places):2));
 const raw=Number(v);if(!Number.isFinite(raw))return '—';
 const valueType=f.field_type==='reference'?(f.reference_value_type||'reference'):f.field_type;
 const number=value=>value.toLocaleString('en-US',{minimumFractionDigits:places,maximumFractionDigits:places});
 if(format==='percent')return number(valueType==='formula'?raw*100:raw)+'%';
 if(format==='amount')return (f.unit?esc(f.unit):currency())+' '+number(raw);
 if(format==='number')return number(raw);
 const n=fmt(v);
 if(valueType==='percent')return n+'%';
 if(valueType==='amount')return (f.unit?esc(f.unit):currency())+' '+n;
 return f.unit?n+' '+esc(f.unit):n;
}
var _psTableSort=new WeakMap();
function psSortValueAttr(value){return ' data-sort-value="'+esc(value==null?'':value)+'"';}
function psSortCellValue(td){
 if(!td)return null;
 const input=td.querySelector&&td.querySelector('input.ps-input');
 if(input){
  const raw=String(input.value==null?'':input.value).trim();
  if(raw===''||raw==='-'||raw==='—')return null;
  const normalized=raw.replace(/,/g,'').replace(/%$/,'').trim();
  const number=Number(normalized);
  return Number.isFinite(number)?number:null;
 }
 const dataRaw=td.getAttribute&&td.getAttribute('data-sort-value');
 if(dataRaw!==null&&dataRaw!==undefined){
  const value=String(dataRaw).trim();
  if(value===''||value==='-'||value==='—')return null;
  const number=Number(value);
  return Number.isFinite(number)?number:value.toLocaleLowerCase();
 }
 const raw=(td.textContent||'').trim();
 if(raw===''||raw==='-'||raw==='—'||raw==='未知')return null;
 const normalized=raw.replace(/,/g,'').replace(/%$/,'').trim();
 if(/^[-+]?\d+(?:\.\d+)?$/.test(normalized))return Number(normalized);
 const date=Date.parse(raw);
 if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)&&!Number.isNaN(date))return date;
 return raw.toLocaleLowerCase();
}
function psCompareSortValue(a,b,dir){
 if(a==null&&b==null)return 0;
 if(a==null)return 1;
 if(b==null)return -1;
 const compare=(typeof a==='number'&&typeof b==='number')
  ?a-b
  :String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
 return dir==='desc'?-compare:compare;
}
function psApplyTableSort(table,colIndex,dir){
 if(!table||!table.tBodies||!table.tBodies[0])return;
 const tbody=table.tBodies[0];
 const rows=Array.prototype.slice.call(tbody.querySelectorAll(':scope > tr'));
 if(!rows.length)return;
 rows.forEach(function(row,index){
  if(row.dataset.psOriginalOrder==null)row.dataset.psOriginalOrder=String(index);
 });
 rows.sort(function(a,b){
  if(dir==='none')return Number(a.dataset.psOriginalOrder)-Number(b.dataset.psOriginalOrder);
  const av=psSortCellValue(a.children[colIndex]),bv=psSortCellValue(b.children[colIndex]);
  const compare=psCompareSortValue(av,bv,dir);
  return compare||Number(a.dataset.psOriginalOrder)-Number(b.dataset.psOriginalOrder);
 });
 rows.forEach(function(row){tbody.appendChild(row);});
}
function initPriceSystemTableSort(container){
 if(!container)return;
 const table=container.querySelector('.ps-table-wrap table');
 if(!table||!table.tHead||!table.tHead.rows.length)return;
 const head=table.tHead.rows[0];
 Array.prototype.forEach.call(head.cells,function(th,index){
  if(th.querySelector('input,button,select')||th.classList.contains('ps-sort-ready'))return;
  th.classList.add('ps-sort-ready');
  th.style.cursor='pointer';
  th.title=th.title||tr('sortHint');
  const indicator=document.createElement('span');
  indicator.className='ps-sort-indicator';
  indicator.textContent='↕';
  indicator.style.cssText='margin-left:4px;font-size:10px;color:#a0a7b0;vertical-align:1px;user-select:none';
  th.appendChild(indicator);
  th.setAttribute('aria-sort','none');
  th.addEventListener('click',function(event){
   if(event.target.closest&&event.target.closest('input,button,select'))return;
   const state=_psTableSort.get(table)||{col:-1,dir:'none'};
   const next=(state.col!==index||state.dir==='none')?'desc':(state.dir==='desc'?'asc':'none');
   _psTableSort.set(table,{col:index,dir:next});
   Array.prototype.forEach.call(head.cells,function(header){
    const icon=header.querySelector('.ps-sort-indicator');
    if(icon)icon.textContent='↕';
    if(icon)icon.style.color='#a0a7b0';
    header.setAttribute('aria-sort','none');
   });
   indicator.textContent=next==='desc'?'▼':(next==='asc'?'▲':'↕');
   indicator.style.color=next==='none'?'#a0a7b0':'var(--primary,#1976d2)';
   th.setAttribute('aria-sort',next==='desc'?'descending':(next==='asc'?'ascending':'none'));
   psApplyTableSort(table,index,next);
  });
 });
}

function psDirtyCount(){
 return Object.keys(state.dirty||{}).reduce((n,sku)=>n+Object.keys(state.dirty[sku]||{}).length,0);
}
function psCaptureModalValues(root){
 const values=[];
 if(!root)return values;
 root.querySelectorAll('input,select,textarea').forEach(el=>{
  if(!el.id&&!el.name)return;
  values.push({id:el.id||'',name:el.name||'',type:el.type||'',value:el.type==='checkbox'||el.type==='radio'?el.checked:el.value});
 });
 return values;
}
function psRestoreModalValues(root,values){
 if(!root||!values)return;
 values.forEach(item=>{
  let el=item.id?root.querySelector('#'+item.id):null;
  if(!el&&item.name)el=root.querySelector('[name="'+String(item.name).replace(/"/g,'\\"')+'"]');
  if(!el)return;
  if(item.type==='checkbox'||item.type==='radio')el.checked=!!item.value;
  else el.value=item.value;
 });
}
window.psHasUnsavedChanges=function(){return psDirtyCount()>0;};
window.psHandleLanguageChange=function(){
 const root=document.getElementById('ps-root');
 if(!root)return false;
 const modalOverlay=document.getElementById('modal-overlay');
 const modalOpen=typeof isModalOpen==='function'?isModalOpen():!!(modalOverlay&&modalOverlay.classList.contains('show'));
 const modal=document.getElementById('modal-content');
 const values=modalOpen?psCaptureModalValues(modal):[];
 main();
 if(modalOpen&&typeof state.modalLanguageRenderer==='function'){
  try{
   state.modalLanguageRenderer();
   psRestoreModalValues(document.getElementById('modal-content'),values);
  }catch(e){if(typeof console!=='undefined'&&console.error)console.error('[price-system] modal language refresh failed',e);}
 }
 return true;
};

function main(){
 const el=document.getElementById('ps-main');if(!el)return;
 if(!state.schemes.length){el.innerHTML='<div class="ps-card"><div class="ps-empty"><strong>'+tr('emptyTitle')+'</strong>'+tr('emptyHint')+'<div style="margin-top:15px"><button class="ps-btn primary" onclick="psOpenSchemeModal()">＋ '+tr('newScheme')+'</button></div></div></div>';return;}
 const opts=state.schemes.map(s=>'<option value="'+esc(s.id)+'" '+(s.id===state.schemeId?'selected':'')+'>'+esc(schemeLabel(s))+'</option>').join('');
 const scheme=state.scheme;
  const acts='<button class="ps-btn" onclick="psOpenFieldsModal()" '+(!scheme?'disabled':'')+'>'+tr('fields')+'</button><div class="ps-actions-menu-wrap"><button type="button" class="ps-btn primary ps-actions-toggle" aria-haspopup="true" aria-expanded="false" onclick="psToggleActionsMenu(event)">'+tr('actions')+' <span class="ps-actions-caret">⌄</span></button><div class="ps-actions-menu" id="ps-actions-menu" hidden><button type="button" onclick="psCloseActionsMenu();psOpenSchemeModal()"><span class="ps-menu-icon">＋</span>'+tr('newScheme')+'</button><div class="ps-menu-divider"></div><button type="button" onclick="psCloseActionsMenu();psOpenVersionsModal()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">◷</span>'+tr('history')+'</button><button type="button" onclick="psCloseActionsMenu();psDeactivateScheme()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">Ⅱ</span>'+tr('stop')+'</button><div class="ps-menu-divider"></div><button type="button" onclick="psCloseActionsMenu();psClickImport()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">↑</span>'+tr('import')+'</button><button type="button" onclick="psCloseActionsMenu();psDownloadImportTemplate()" '+(!scheme||!state.rows.length?'disabled':'')+'><span class="ps-menu-icon">↓</span>'+tr('downloadTemplate')+'</button><button type="button" onclick="psCloseActionsMenu();psExportExcel()" '+(!scheme||!state.rows.length?'disabled':'')+'><span class="ps-menu-icon">⇩</span>'+tr('export')+'</button><div class="ps-menu-divider"></div><button type="button" id="ps-save-btn" onclick="psCloseActionsMenu();psSaveChanges()" disabled><span class="ps-menu-icon">✓</span>'+tr('save')+'</button><div class="ps-menu-divider"></div><button type="button" class="danger" onclick="psCloseActionsMenu();psDeleteScheme()" '+(!scheme?'disabled':'')+'><span class="ps-menu-icon">×</span>'+tr('deleteScheme')+'</button></div></div>';
 let html='<div class="ps-toolbar"><div class="ps-toolbar-primary"><label>'+tr('scheme')+'</label><select class="ps-select" onchange="psSelectScheme(this.value)">'+opts+'</select><div class="ps-actions">'+acts+'</div></div>';
 if(!scheme){html+='</div><div class="ps-card"><div class="ps-empty">'+tr('loading')+'</div></div>';el.innerHTML=html;return;}
 html+='<div class="ps-meta"><span class="ps-pill">'+tr('country')+': '+esc(scheme.country)+'</span><span class="ps-pill">'+tr('brand')+': '+esc(scheme.brand)+'</span><span class="ps-pill">'+tr('platform')+': '+esc(scheme.sales_channel||scheme.platform)+'</span>'+(scheme.shop_name?'<span class="ps-pill">'+tr('shop')+': '+esc(scheme.shop_name)+'</span>':'')+'<span class="ps-pill">'+tr('currency')+': '+esc(scheme.currency||'')+'</span><span class="ps-pill">'+state.rows.length+' SKU</span></div>';
 const channelSchemes=state.schemes.filter(item=>String(item.country||'')===String(scheme.country||'')&&String(item.brand||'')===String(scheme.brand||''));
 const channelNames=Array.from(new Set(channelSchemes.map(item=>String(item.sales_channel||item.platform||'').trim()).filter(Boolean)));
 const channelButtons=channelNames.map(channel=>{
  const candidates=channelSchemes.filter(item=>String(item.sales_channel||item.platform||'').trim()===channel);
  const target=candidates.find(item=>String(item.shop_name||'')===String(scheme.shop_name||''))||candidates[0];
  const active=channel===String(scheme.sales_channel||scheme.platform||'');
  return '<button type="button" class="ps-channel-button '+(active?'active':'')+'" onclick="psSelectScheme(\''+esc(target.id)+'\')">'+esc(channel)+'</button>';
 }).join('');
 html+='<div class="ps-channel-switcher"><span class="ps-channel-switch-label">'+tr('switchChannel')+'：</span><div class="ps-channel-buttons">'+channelButtons+'</div><button type="button" class="ps-channel-add" onclick="psOpenChannelSchemeModal()">＋ '+tr('addChannel')+'</button></div></div>';
 const cachedView=state._psUseCachedView?psGetSchemeView(scheme.id):null;
 state._psUseCachedView=false;
 if(cachedView){
  html+='<div id="ps-scheme-view-host"></div>';
  el.innerHTML=html;
  const host=el.querySelector('#ps-scheme-view-host');
  if(host)host.appendChild(cachedView.node);
  psTouchSchemeView(scheme.id);updateSave();return;
 }
 html+='<div id="ps-scheme-view-host"><div class="ps-scheme-view" data-scheme-id="'+esc(scheme.id)+'">';
 const missingCategoryCount=state.rows.filter(r=>!String(r.category||'').trim()||String(r.category||'').trim()==='未分类').length;
 if(missingCategoryCount) html+='<div class="ps-warning">'+missingCategoryCount+tr('missingCategories')+'</div>';
 if(!state.rows.length){html+='<div class="ps-card"><div class="ps-empty"><strong>'+tr('noData')+'</strong></div></div></div></div>';el.innerHTML=html;const viewNode=el.querySelector('#ps-scheme-view-host .ps-scheme-view');psStoreSchemeView(scheme.id,viewNode);updateSave();return;}
  const head='<th>'+tr('category')+'</th><th>'+tr('sku')+'</th><th>'+esc(forecastAverageLabel())+'</th><th>'+tr('stock')+'</th><th>'+tr('availableTurnover')+'</th>'+state.fields.map(f=>'<th title="'+esc(f.formula||'')+'">'+esc(f.field_name)+(Number(f.sync_quotation||0)===1?'<span class="ps-unit">'+tr('quoteCurrency')+'</span>':(f.display_format==='percent'?'<span class="ps-unit">%</span>':(f.field_type==='reference'&&f.reference_value_type==='percent'?'<span class="ps-unit">%</span>':((f.display_format==='amount'||(f.display_format!=='number'&&f.display_format!=='percent'&&(f.unit||f.field_type==='amount')))?'<span class="ps-unit">'+esc(f.unit||scheme.currency||'')+'</span>':''))))+'</th>').join('');
  const rows=state.rows.map(r=>{
   const cells=state.fields.map(f=>{
    if(!applies(f,r))return '<td class="ps-value ps-muted"'+psSortValueAttr(null)+'>&mdash;</td>';
    const v=r.values?r.values[f.field_key]:null;
    if(f.field_key==='srp'){
     const dirty=state.dirty[r.sku_code]&&Object.prototype.hasOwnProperty.call(state.dirty[r.sku_code],'srp');const shown=dirty&&state.dirty[r.sku_code].srp!=null?state.dirty[r.sku_code].srp:r.srp;
     const isReference=f.field_type==='reference';
     const inputHint=isReference?tr('srpReferenceManualHint'):tr('srpManualHint');
     const referenceScale=isReference&&f.display_format==='percent'&&f.reference_value_type==='formula'?100:1;
     const places=isReference&&f.decimal_places!=null?Math.max(0,Math.min(6,Number(f.decimal_places)||0)):2;
     const inputValue=shown==null?'':(isReference?formatAmountInput(Number(shown)*referenceScale,places):formatAmountInput(shown,2));
     const decimalPlacesAttribute=isReference?'data-decimal-places="'+places+'"':'data-decimal-places="2"';
     const quoteCode=String(r.value_currencies&&r.value_currencies.srp||'').trim().toUpperCase();
     const unitLabel=isReference
      ?(r.srp_source==='manual'?(f.display_format==='percent'?'%':(f.unit||scheme.currency||'')):(f.reference_sync_quotation&&quoteCode?(currencySymbol(quoteCode)||quoteCode):(f.display_format==='percent'||(f.display_format==='auto'&&f.reference_value_type==='percent')?'%':(f.unit||''))))
      :currency();
     return '<td class="ps-value ps-srp"'+psSortValueAttr(shown)+'><input class="ps-input ps-srp-input '+(dirty?'dirty':'')+'" type="text" inputmode="decimal" '+decimalPlacesAttribute+' data-value-scale="'+referenceScale+'" value="'+esc(inputValue)+'" data-sku="'+esc(r.sku_code)+'" data-field="srp" onfocus="psPrepareAmountInput(this)" oninput="psMarkDirty(this)" onblur="psFormatAmountInput(this)" title="'+esc(inputHint)+'"><span class="ps-unit">'+esc(unitLabel)+'</span></td>';
    }
    if(Number(f.sync_wac||0)===1){const lc=r.landing_cost||null,unit=(lc&&lc.currency)||f.unit||scheme.currency||'';const rawDate=lc&&(lc.last_inbound_date||lc.confirmed_at)||'',wacDate=String(rawDate).slice(0,10),meta=wacDate?esc(wacDate):'';return '<td class="ps-value"'+psSortValueAttr(v)+' title="'+meta+'"><div class="ps-landing-value">'+(v==null?'&mdash;':esc(unit)+' '+fmt(v))+'</div>'+(meta?'<div class="ps-landing-meta">'+meta+'</div>':'')+'</td>';}
    if(Number(f.sync_quotation||0)===1||(f.field_type==='reference'&&f.reference_sync_quotation===true)){const code=String(r.value_currencies&&r.value_currencies[f.field_key]||'').trim().toUpperCase(),symbol=currencySymbol(code);return '<td class="ps-value"'+psSortValueAttr(v)+' title="'+esc(code)+'">'+(v==null?'&mdash;':(symbol?esc(symbol)+' ':'')+fmt(v))+'</td>';}
    if(f.field_type==='formula'||f.field_type==='reference'){const shown=f.field_key==='srp'&&f.field_type!=='reference'?(v==null?'&mdash;':esc(scheme.currency||'')+' '+fmt(v)):fieldText(v,f);return '<td class="ps-value" data-field-key="'+esc(f.field_key)+'"'+psSortValueAttr(v)+' title="'+esc(r.formula_errors&&r.formula_errors[f.field_key]||f.formula||'')+'">'+(r.formula_errors&&r.formula_errors[f.field_key]?'<span style="color:#d97706">!</span> ':'')+shown+'</td>';}
    const dirty=state.dirty[r.sku_code]&&Object.prototype.hasOwnProperty.call(state.dirty[r.sku_code],f.field_key);const shown=dirty?state.dirty[r.sku_code][f.field_key]:v;const isAmountInput=f.field_type==='amount'||(f.field_type!=='percent'&&f.display_format==='amount');const inputPlaces=f.decimal_places==null?2:Number(f.decimal_places);const inputAttrs=isAmountInput?' inputmode="decimal" data-decimal-places="'+(Number.isFinite(inputPlaces)?Math.max(0,Math.min(6,inputPlaces)):2)+'" onfocus="psPrepareAmountInput(this)" onblur="psFormatAmountInput(this)"':'';const inputValue=shown==null?'':(isAmountInput?formatAmountInput(shown,inputPlaces):String(shown));return '<td class="ps-value"><input class="ps-input '+(dirty?'dirty':'')+'" type="'+(isAmountInput?'text':'number')+'" '+(isAmountInput?'':'step="0.01" ')+inputAttrs+' value="'+esc(inputValue)+'" data-sku="'+esc(r.sku_code)+'" data-field="'+esc(f.field_key)+'" oninput="psMarkDirty(this)" title="'+esc(f.unit||scheme.currency||'')+'">'+(f.field_type==='percent'?'<span class="ps-unit">%</span>':(f.field_type==='amount'?'<span class="ps-unit">'+esc(f.unit||scheme.currency||'')+'</span>':(f.unit?'<span class="ps-unit">'+esc(f.unit)+'</span>':'')))+'</td>';
   }).join('');
   const forecastAvg = r.forecast_avg_sales;
   const forecastAvgText = forecastAvg == null ? '—' : Math.round(Number(forecastAvg) || 0).toLocaleString('en-US');
   const availableTurnover = r.available_turnover;
   const availableTurnoverText = availableTurnover == null ? '—' : Number(availableTurnover).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
   const daysSinceInbound = r.days_since_last_inbound;
   const inboundMeta = daysSinceInbound == null
    ? tr('daysSinceInboundUnknown')
    : tr('daysSinceInbound').replace('{days}',Number(daysSinceInbound).toLocaleString('en-US'));
   return '<tr data-sku="'+esc(r.sku_code)+'"><td class="ps-category">'+(r.category?esc(r.category):'&mdash;')+'</td><td class="ps-sku">'+esc(r.sku_code)+'</td><td class="ps-value"'+psSortValueAttr(forecastAvg)+'>'+forecastAvgText+'</td><td class="ps-stock '+(Number(r.stock_qty)===0?'zero':'')+'"'+psSortValueAttr(Number(r.stock_qty||0))+'>'+Number(r.stock_qty||0).toLocaleString('en-US')+'<div class="ps-stock-meta">'+esc(inboundMeta)+'</div></td><td class="ps-value"'+psSortValueAttr(availableTurnover)+'>'+availableTurnoverText+'</td>'+cells+'</tr>';
  }).join('');
 const dirtyCount=Object.keys(state.dirty).reduce((n,k)=>n+Object.keys(state.dirty[k]||{}).length,0);
 html+='<div class="ps-card"><div class="ps-table-wrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table></div><div class="ps-bottom"><span>'+tr('importHint')+'</span><span class="'+(dirtyCount?'ps-dirty':'')+'">'+(dirtyCount?dirtyCount+' unsaved':'')+'</span></div></div></div></div>';
 el.innerHTML=html;const viewNode=el.querySelector('#ps-scheme-view-host .ps-scheme-view');psStoreSchemeView(scheme.id,viewNode);initPriceSystemTableSort(viewNode);psApplyFrozenColumns(viewNode);updateSave();
}
function updateSave(){const b=document.getElementById('ps-save-btn');if(!b)return;const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);b.disabled=!n;b.innerHTML='<span class="ps-menu-icon">✓</span>'+tr('save')+(n?' ('+n+')':'');}
window.psSelectScheme=async function(id){
 if(String(id||'')===String(state.schemeId||''))return;
 const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);
 if(n&&!confirm(tr('unsaved'))){main();return;}
 psCaptureSchemeView(state.schemeId);
 if(n){state.dirty={};psRemoveSchemeView(state.schemeId);}
 await loadData(id,{useCache:true});
};
window.psPrepareAmountInput=function(input){if(!input)return;const before=String(input.value||''),position=Number.isFinite(input.selectionStart)?input.selectionStart:before.length,clean=before.replace(/,/g,''),nextPosition=before.slice(0,position).replace(/,/g,'').length;input.value=clean;if(typeof input.setSelectionRange==='function')input.setSelectionRange(nextPosition,nextPosition);};
window.psFormatAmountInput=function(input){if(!input)return;const raw=String(input.value==null?'':input.value).replace(/,/g,'').trim();if(raw===''){input.value='';return;}const n=Number(raw);if(!Number.isFinite(n))return;input.value=formatAmountInput(n,input.getAttribute('data-decimal-places'));};
const psFormulaPreviewTimers = new Map();
const psFormulaPreviewSequences = new Map();
function cancelPendingPriceSystemFormulaPreviews(){
 psFormulaPreviewTimers.forEach(timer=>clearTimeout(timer));
 psFormulaPreviewTimers.clear();
 psFormulaPreviewSequences.forEach((seq,sku)=>psFormulaPreviewSequences.set(sku,seq+1));
}
function updatePriceSystemFormulaPreview(skuCode,preview){
 const row=state.rows.find(item=>item.sku_code===skuCode);
 if(!row)return;
 row.values=Object.assign({},row.values||{},preview.values||{});
 row.srp=preview.srp==null?null:Number(preview.srp);
 row.srp_source=preview.srp_source||'';
 row.formula_context=Object.assign({},row.formula_context||{},preview.formula_context||{});
 row.formula_errors=preview.formula_errors||{};
 const tableRow=Array.from(document.querySelectorAll('#ps-root .ps-table-wrap tbody tr[data-sku]'))
  .find(item=>item.getAttribute('data-sku')===skuCode);
 if(!tableRow)return;
 state.fields.forEach(field=>{
  if(field.field_type!=='formula'||field.field_key==='srp')return;
  const cell=Array.from(tableRow.querySelectorAll('td[data-field-key]'))
   .find(item=>item.getAttribute('data-field-key')===field.field_key);
  if(!cell)return;
  const value=Object.prototype.hasOwnProperty.call(preview.values||{},field.field_key)
   ?preview.values[field.field_key]
   :(row.values||{})[field.field_key];
  const formulaError=(preview.formula_errors||{})[field.field_key]||'';
  cell.innerHTML=(formulaError?'<span style="color:#d97706">!</span> ':'')+fieldText(value,field);
  cell.title=formulaError||field.formula||'';
  cell.setAttribute('data-sort-value',value==null?'':String(value));
 });
 const srpInput=Array.from(tableRow.querySelectorAll('input.ps-input[data-field="srp"]'))[0];
 if(srpInput){
  const dirty=state.dirty[skuCode]||{};
  const hasDirtySrp=Object.prototype.hasOwnProperty.call(dirty,'srp');
  if((hasDirtySrp&&dirty.srp===null&&document.activeElement!==srpInput)||(!hasDirtySrp&&row.srp_source==='formula')){
   srpInput.value=formatAmountInput(row.srp,2);
  }
  const srpCell=srpInput.closest('td');
  if(srpCell)srpCell.setAttribute('data-sort-value',row.srp==null?'':String(row.srp));
 }
 const table=tableRow.closest('table');
 const sortState=table&&_psTableSort.get(table);
 if(sortState&&sortState.dir!=='none')psApplyTableSort(table,sortState.col,sortState.dir);
}
async function runPriceSystemFormulaPreview(skuCode,schemeId,sequence){
 if(state.schemeId!==schemeId||psFormulaPreviewSequences.get(skuCode)!==sequence)return;
 const row=state.rows.find(item=>item.sku_code===skuCode);
 if(!row)return;
 const dirty=state.dirty[skuCode]||{};
 const context=Object.assign({},row.formula_context||{},row.values||{});
 Object.keys(dirty).forEach(key=>{context[key]=dirty[key]==null?0:Number(dirty[key]);});
 const manualSrp=Object.prototype.hasOwnProperty.call(dirty,'srp')
  ?dirty.srp
  :(row.srp_source==='manual'?row.srp:null);
 try{
  const preview=await api('/api/price-system/schemes/'+encodeURIComponent(schemeId)+'/formula/recalculate-preview','POST',{
   sku_code:skuCode,context,manual_srp:manualSrp
  });
  if(state.schemeId!==schemeId||psFormulaPreviewSequences.get(skuCode)!==sequence)return;
  updatePriceSystemFormulaPreview(skuCode,preview);
 }catch(error){
  if(state.schemeId===schemeId&&psFormulaPreviewSequences.get(skuCode)===sequence)err(error);
 }
}
function schedulePriceSystemFormulaPreview(skuCode){
 const key=String(skuCode||'');
 if(!key||!state.schemeId||!state.fields.some(field=>field.field_type==='formula'))return;
 const sequence=(psFormulaPreviewSequences.get(key)||0)+1;
 psFormulaPreviewSequences.set(key,sequence);
 const previous=psFormulaPreviewTimers.get(key);
 if(previous)clearTimeout(previous);
 const schemeId=state.schemeId;
 const timer=setTimeout(()=>{
  psFormulaPreviewTimers.delete(key);
  runPriceSystemFormulaPreview(key,schemeId,sequence);
 },220);
 psFormulaPreviewTimers.set(key,timer);
}
window.psMarkDirty=function(input){
 const sku=input.getAttribute('data-sku'),key=input.getAttribute('data-field'),raw=String(input.value==null?'':input.value).replace(/,/g,'').trim();
 if(raw!==''&&!Number.isFinite(Number(raw)))return;
 if(!state.dirty[sku])state.dirty[sku]={};
 state.dirty[sku][key]=raw===''?null:Number(raw);
 const valueScale=key==='srp'?Math.max(1,Number(input.getAttribute('data-value-scale')||1)):1;
 if(raw!==''&&valueScale!==1)state.dirty[sku][key]=Number(raw)/valueScale;
 input.classList.add('dirty');
 updateSave();
 const b=document.querySelector('#ps-root .ps-bottom span:last-child');
 if(b){
  const n=Object.keys(state.dirty).reduce((x,k)=>x+Object.keys(state.dirty[k]||{}).length,0);
  b.textContent=n?n+' unsaved':'';
  b.classList.toggle('ps-dirty',n>0);
 }
 schedulePriceSystemFormulaPreview(sku);
};
window.psSaveChanges=async function(){const rows=Object.keys(state.dirty).map(sku=>{const values=Object.assign({},state.dirty[sku]||{}),row={sku_code:sku,values};if(Object.prototype.hasOwnProperty.call(values,'srp')){row.srp=values.srp;delete row.values.srp;}return row;}).filter(row=>Object.keys(row.values).length||Object.prototype.hasOwnProperty.call(row,'srp'));if(!rows.length)return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/values','POST',{rows});state.dirty={};if(typeof showToast==='function')showToast(tr('saved'),'success');await loadSchemes(state.schemeId);}catch(e){err(e);updateSave();}};
function readSchemeCreateFormValues(){
 return {
  country:document.getElementById('ps-country')?.value||'',
  brand:document.getElementById('ps-brand')?.value||'',
  sales_channel:document.getElementById('ps-channel')?.value||'',
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
 const body='<div class="ps-scheme-create"><p class="ps-scheme-intro">'+tr('subtitle')+'</p>'+modeSwitch+sourceSection+'<section class="ps-scheme-section"><h3 class="ps-scheme-section-title">'+tr('basicInfo')+'</h3><div class="ps-scheme-grid"><div class="ps-scheme-field"><label for="ps-country">'+tr('country')+'</label><select id="ps-country" onchange="psCountryChanged()"><option value="">'+tr('selectCountry')+'</option>'+countries+'</select></div><div class="ps-scheme-field"><label for="ps-brand">'+tr('brand')+'</label><select id="ps-brand"><option value="">'+tr('selectBrand')+'</option>'+brands+'</select></div><div class="ps-scheme-field"><label for="ps-channel">'+tr('platform')+'</label><input id="ps-channel" value="'+esc(v.sales_channel||v.platform||'')+'" placeholder="Shopee / TikTok Shop / Offline"></div><div class="ps-scheme-field"><label for="ps-shop">'+tr('shop')+'</label><input id="ps-shop" value="'+esc(v.shop_name||'')+'" placeholder="'+tr('optionalStore')+'"></div><div class="ps-scheme-field"><label for="ps-currency">'+tr('currency')+'</label><input id="ps-currency" value="'+esc(v.currency||'')+'" placeholder="IDR / MYR / THB / SGD"><span class="ps-scheme-help">'+tr('defaultCurrencyHelp')+'</span></div></div></section></div>';
 const submitLabel=mode==='copy'?tr('copyAndCreate'):tr('confirm');
 state.modalLanguageRenderer=function(){renderSchemeCreateModal(readSchemeCreateFormValues());};
 openModal(tr('newScheme'),body,'<button class="btn btn-secondary" onclick="closeModal()">'+tr('cancel')+'</button><button class="btn btn-primary" onclick="psSaveScheme()">'+submitLabel+'</button>');
}
window.psOpenChannelSchemeModal=function(){
 if(!allowDiscardDirty())return;
 state.schemeCreateMode='blank';
 state.schemeCopySourceId=state.schemes.length?state.schemes[0].id:'';
 renderSchemeCreateModal({country:state.scheme&&state.scheme.country||'',brand:state.scheme&&state.scheme.brand||'',currency:state.scheme&&state.scheme.currency||''});
};
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
 const sales_channel=document.getElementById('ps-channel')?.value.trim()||'';
 const shop_name=document.getElementById('ps-shop')?.value.trim()||'';
 const currencyValue=document.getElementById('ps-currency')?.value.trim()||'';
 const isCopy=state.schemeCreateMode==='copy';
 const sourceId=isCopy?(document.getElementById('ps-copy-source')?.value||''):'';
 if(isCopy&&!sourceId){err(new Error(tr('copySourceRequired')));return;}
 if(!country||!brand||!sales_channel){err(new Error(!country?tr('selectCountry'):(!brand?tr('selectBrand'):tr('enterPlatform'))));return;}
 try{
  const endpoint=isCopy?'/api/price-system/schemes/'+encodeURIComponent(sourceId)+'/copy':'/api/price-system/schemes';
  const x=await api(endpoint,'POST',{country,brand,sales_channel,shop_name,currency:currencyValue});
  closeModal();
  await loadSchemes(x.id);
  if(typeof showToast==='function')showToast(isCopy?tr('copySchemeCreated'):tr('schemeCreated'),'success');
 }catch(e){err(e);}
};
window.psOpenFieldsModal=function(){
 if(!state.scheme||!allowDiscardDirty())return;
 const rows=state.fields.map(f=>{
  const typeKey=f.field_type==='reference'?'referenceType':(f.field_type==='amount'?'amount':(f.field_type==='percent'?'percent':(f.field_type==='formula'?'calc':'number')));
  const typeClass=f.field_type==='reference'?'type-reference':(f.field_type==='amount'?'type-amount':(f.field_type==='percent'?'type-percent':(f.field_type==='formula'?'type-formula':'')));
  const ruleCategories=f.field_type==='formula'&&f.formula_rules?Object.keys(typeof f.formula_rules==='string'?JSON.parse(f.formula_rules||'{}'):f.formula_rules||{}):[];
  const displayCategories=ruleCategories.length?ruleCategories:cats(f);
  const categoryTags=displayCategories.length?displayCategories.map(c=>'<span class="ps-field-category">'+esc(c)+'</span>').join(''):'<span class="ps-field-category all">'+tr('allCategories')+'</span>';
  const sourceScheme=state.schemes.find(item=>String(item.id)===String(f.source_scheme_id||''));const referenceBadge=f.field_type==='reference'?'<span class="ps-field-badge type-reference">'+tr('sourceLabel')+'：'+esc((sourceScheme?(sourceScheme.sales_channel||sourceScheme.platform):'')+'.'+(f.source_field_key||''))+'</span>':'';const badges='<span class="ps-field-badge '+typeClass+'">'+tr(typeKey)+'</span>'+referenceBadge+(Number(f.sync_wac||0)===1?'<span class="ps-field-badge is-wac">'+tr('wacSource')+'</span>':'')+(Number(f.sync_quotation||0)===1?'<span class="ps-field-badge is-quote">'+tr('quoteSource')+'</span>':'')+(f.is_builtin_srp?'<span class="ps-field-badge is-system">'+tr('systemField')+'</span>':'');
  const remove=f.is_builtin_srp?'':'<button type="button" class="ps-field-action danger" onclick="psDeleteField(\''+esc(f.id)+'\')">'+tr('delete')+'</button>';
  return '<div class="ps-field-row" data-field-id="'+esc(f.id)+'" ondragover="psFieldDragOver(event,this)" ondragleave="psFieldDragLeave(event,this)" ondrop="psFieldDrop(event,this)"><button type="button" class="ps-drag-handle" draggable="'+(state.orderSaving?'false':'true')+'" title="'+tr('fieldOrderHint')+'" aria-label="'+tr('fieldOrderHint')+'" ondragstart="psFieldDragStart(event,\''+esc(f.id)+'\')" ondragend="psFieldDragEnd(event)">⠿</button><div class="ps-field-main"><div class="ps-field-top"><div><div class="ps-field-name">'+esc(priceFieldDisplayName(f))+'</div><code class="ps-field-key">'+esc(f.field_key)+'</code></div><div class="ps-field-badges">'+badges+'</div></div><div class="ps-field-meta">'+categoryTags+'</div></div><div class="ps-field-actions"><button type="button" class="ps-field-action" onclick="psOpenFieldEditor(\''+esc(f.id)+'\')">'+tr('edit')+'</button>'+remove+'</div></div>';
 }).join('');
 const list=rows||'<div class="ps-fields-empty">'+tr('noFields')+'</div>';
 const freezeValue=psCurrentFreezeFieldKey();
 const freezeOptions=psFreezeColumnOptions().map(option=>'<option value="'+esc(option.key)+'" '+(option.key===freezeValue?'selected':'')+'>'+esc(option.label)+'</option>').join('');
 const freezeControl='<label class="ps-freeze-control" title="'+esc(tr('freezeHint'))+'"><span>'+tr('freezeTo')+'</span><select id="ps-freeze-field" class="ps-freeze-select" onchange="psSetFreezeField(this.value)" '+(state.freezeSaving?'disabled':'')+'>'+freezeOptions+'</select></label>';
 const body='<div class="ps-fields-manager"><div class="ps-fields-toolbar"><div><div class="ps-fields-title">'+tr('fieldOrderTitle')+'</div><div class="ps-fields-hint">'+(state.orderSaving?tr('savingOrder'):tr('fieldOrderHint'))+'</div></div><div class="ps-fields-toolbar-actions">'+freezeControl+'<span class="ps-fields-count">'+state.fields.length+' '+tr('fieldCount')+'</span><button type="button" class="ps-fields-add" onclick="psOpenFieldEditor()" '+(state.orderSaving?'disabled':'')+'>＋ '+tr('add')+'</button></div></div><div class="ps-field-list">'+list+'</div><div class="ps-fields-footnote">'+tr('fieldOrderHint')+'</div></div>';
 const footer='<button type="button" class="ps-field-modal-btn" onclick="closeModal()">'+tr('close')+'</button>';
 state.modalLanguageRenderer=function(){window.psOpenFieldsModal();};
 openModal(tr('fields'),body,footer,'modal-lg');
 const modal=document.getElementById('modal-content');if(modal)modal.classList.add('modal-price-fields');
};
window.psSetFreezeField=async function(value){
 if(!state.scheme||state.freezeSaving)return;
 const next=String(value||'none');
 if(!psFreezeColumnOptions().some(option=>option.key===next))return;
 const schemeId=state.schemeId;
 const previous=psCurrentFreezeFieldKey();
 state.freezeSaving=true;
 const select=document.getElementById('ps-freeze-field');
 if(select)select.disabled=true;
 try{
  const updated=await api('/api/price-system/schemes/'+encodeURIComponent(schemeId),'PUT',{freeze_field_key:next});
  if(state.schemeId!==schemeId)return;
  state.scheme=Object.assign({},state.scheme,updated||{},{freeze_field_key:next});
  state.schemes=state.schemes.map(item=>item.id===schemeId?Object.assign({},item,state.scheme):item);
  const root=document.getElementById('ps-main');
  if(root)psApplyFrozenColumns(root);
  if(typeof showToast==='function')showToast(tr('freezeSaved'),'success');
 }catch(e){
  const current=document.getElementById('ps-freeze-field');
  if(current)current.value=previous;
  err(e);
 }finally{
  state.freezeSaving=false;
  const current=document.getElementById('ps-freeze-field');
  if(current)current.disabled=false;
 }
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
 {key:'purchase_price_rmb',label:'skuMasterPurchasePriceRmb'},
 {key:'purchase_price_usd',label:'skuMasterPurchasePriceUsd'},
 {key:'standard_purchase_price',label:'standardPurchasePrice'},
 {key:'weighted_avg_cost',label:'weightedAvgCost'},
 {key:'reference_customs_rate',label:'customsRate'},
 {key:'landing_cost',label:'latestConfirmedWac'},
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
 [
  ['采购价 RMB','skuMasterPurchasePriceRmb'],['Purchase Price RMB','skuMasterPurchasePriceRmb'],['Harga Beli RMB','skuMasterPurchasePriceRmb'],
  ['采购价 USD','skuMasterPurchasePriceUsd'],['Purchase Price USD','skuMasterPurchasePriceUsd'],['Harga Beli USD','skuMasterPurchasePriceUsd'],
  ['SKU 加权平均成本','weightedAvgCost'],['SKU Weighted Average Cost','weightedAvgCost'],
  ['系统 Landing Cost','latestConfirmedWac'],['System Landing Cost','latestConfirmedWac'],['Landing Cost Sistem','latestConfirmedWac']
 ].forEach(([legacy,label])=>{result=result.split(legacy).join(tr(label));});
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
function formulaPreviewRow(expression,excludeKey,category){
 const source=String(expression||'');
 const quoteFields=state.fields.filter(field=>Number(field.sync_quotation||0)===1&&field.field_key!==excludeKey&&[field.field_name,field.field_key].some(token=>token&&source.includes(String(token))));
 const candidates=state.rows.filter(row=>!category||String(row.category||'').trim()===String(category).trim());
 if(!quoteFields.length)return candidates[0]||null;
 const withQuotes=candidates.find(row=>quoteFields.every(field=>{
  const context=row&&row.formula_context||{},values=row&&row.values||{};
  const value=Object.prototype.hasOwnProperty.call(context,field.field_key)?context[field.field_key]:values[field.field_key];
  return value!==null&&value!==undefined&&value!=='';
 }));
 return withQuotes||candidates[0]||null;
}
window.psRunFormulaPreview=async function(seq){
 const input=document.getElementById('ps-field-formula'),preview=document.getElementById('ps-formula-preview');
 if(!input||!preview||!input.value.trim()||seq!==window.__psFormulaPreviewSeq)return;
 const fieldKey=document.getElementById('ps-field-key')?.value.trim().toLowerCase()||'';
 const row=formulaPreviewRow(input.value.trim(),fieldKey)||null;
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
 const sync_quotation=!!document.getElementById('ps-field-sync-quotation')?.checked;
 const source_scheme_id=document.getElementById('ps-reference-scheme')?.value||'';
 const source_field_key=document.getElementById('ps-reference-field')?.value||'';
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
 return {field_name,field_key,unit,display_format,decimal_places,formula:'',formula_rules,sync_wac:field_type==='reference'?false:sync_wac,sync_quotation:field_type==='reference'?false:sync_quotation,source_scheme_id:field_type==='reference'?source_scheme_id:'',source_field_key:field_type==='reference'?source_field_key:'',applicable_categories,field_type};
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
 const preview=document.getElementById('ps-formula-rule-preview-'+index);if(preview)preview.textContent=tr('formulaEnterHint');
 const type=document.getElementById('ps-field-type');if(input.value.trim()&&type&&type.value!=='formula'){type.value='formula';window.psToggleFormula();}
};
window.psPreviewFormulaRule=async function(index){
 const rule=(window.__psFormulaRulesDraft||[])[index];if(!rule)return;const expression=String(rule.formula||'').trim(),preview=document.getElementById('ps-formula-rule-preview-'+index);
 if(!expression){if(preview)preview.textContent=tr('formulaRequired');return;}
 const category=(rule.categories||[])[0],fieldKey=document.getElementById('ps-field-key')?.value.trim().toLowerCase()||'',row=formulaPreviewRow(expression,fieldKey,category)||null;
 const variables=Object.assign({},row&&row.formula_context||{},row&&row.values||{});if(row&&row.srp!=null)variables.srp=Number(row.srp);
 if(fieldKey)delete variables[fieldKey];
 if(preview)preview.textContent=tr('formulaValidating');
 try{const result=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/formula/preview','POST',{formula:expression,exclude_key:fieldKey,variables});if(preview)preview.textContent=tr('formulaValidPreview')+' · '+(state.scheme.currency||'')+' '+fmt(result.result)+(row?' · '+row.sku_code:'');}
 catch(e){if(preview)preview.textContent=tr('formulaValidationFailed')+'：'+String(e&&e.message||e);}
};
window.psOpenFieldEditor=function(id,percentDefault){
 const f=state.fields.find(x=>x.id===id)||null,selected=new Set(f?cats(f):[]);
 const categoryList=Array.from(new Set(state.rows.map(x=>String(x.category||'').trim()).filter(Boolean).concat(Array.from(selected)))).sort();
 let formulaRules={};if(f&&f.formula_rules){try{formulaRules=typeof f.formula_rules==='string'?JSON.parse(f.formula_rules):f.formula_rules;}catch(e){formulaRules={};}}
 if(!formulaRules||typeof formulaRules!=='object'||Array.isArray(formulaRules))formulaRules={};
 const isSrp=!!(f&&f.is_builtin_srp),type=f?f.field_type:'amount',isWac=!!(f&&Number(f.sync_wac||0)===1),isQuote=!!(f&&Number(f.sync_quotation||0)===1);const referenceSchemes=state.schemes.filter(item=>String(item.id)!==String(state.schemeId)&&String(item.country||'')===String(state.scheme&&state.scheme.country||'')&&String(item.brand||'')===String(state.scheme&&state.scheme.brand||''));const referenceSchemeId=f&&f.source_scheme_id||((referenceSchemes[0]||{}).id||'');window.__psReferenceFieldDraft=f&&f.source_field_key||'';
 window.__psFormulaCategoryList=categoryList;
 window.__psFormulaRulesDraft=formulaRuleDraftsFromMap(formulaRules,f&&f.formula,Array.from(selected),categoryList).map(rule=>({formula:formulaDisplayExpression(rule.formula),categories:rule.categories.slice()}));
 const allScope=categoryList.length>0&&selected.size===categoryList.length;
 const checks=categoryList.map(category=>'<label class="ps-category-chip"><input type="checkbox" class="ps-cat-check" value="'+esc(category)+'" '+((allScope||selected.has(category))?'checked':'')+' onchange="psUpdateCategorySelectAll()"> <span>'+esc(category)+'</span></label>').join('')||'<span class="ps-editor-help">—</span>';
 const formulaSection='<section class="ps-editor-section" id="ps-formula-wrap" style="'+(isWac||isQuote||type==='percent'||type==='reference'?'display:none':'')+'"><div class="ps-editor-section-title ps-formula-rules-title"><strong>'+tr('formulaRulesTitle')+'</strong><button type="button" class="ps-btn primary" onclick="psAddFormulaRule()">＋ '+tr('addFormulaRule')+'</button></div>'+formulaBuilderHtml(f)+'<div class="ps-formula-rules-list" id="ps-formula-rules-list"></div><div class="ps-editor-formula-help">'+tr('formulaBuilderHint')+' '+tr('formulaHelp')+'</div></section>';
 const referenceSchemeOptions=referenceSchemes.map(item=>'<option value="'+esc(item.id)+'" '+(String(item.id)===String(referenceSchemeId)?'selected':'')+'>'+esc(item.sales_channel||item.platform)+(item.shop_name?' / '+esc(item.shop_name):'')+'</option>').join('');
 const referenceSection='<section class="ps-editor-section" id="ps-reference-wrap" style="'+(type==='reference'?'':'display:none')+'"><div class="ps-editor-section-title">'+tr('reference')+'</div><div class="ps-editor-grid"><div class="ps-editor-control"><label>'+tr('referenceSourceScheme')+'</label><select id="ps-reference-scheme" onchange="psReferenceSourceChanged(false)" '+(!referenceSchemes.length?'disabled':'')+'><option value="">'+tr('referenceNoSchemes')+'</option>'+referenceSchemeOptions+'</select></div><div class="ps-editor-control"><label>'+tr('referenceSourceField')+'</label><select id="ps-reference-field" onchange="psReferenceFieldChanged()" disabled><option value="">'+tr('referenceLoading')+'</option></select></div></div><div class="ps-editor-help">'+tr('referenceHelp')+'</div><div id="ps-reference-preview" class="ps-reference-preview">'+tr('referenceLoading')+'</div></section>';
 const percentSection='<section class="ps-editor-section" id="ps-percent-wrap" style="'+(type==='percent'?'':'display:none')+'"><div class="ps-editor-section-title">'+tr('percentSettings')+'</div><div class="ps-percent-setting"><div class="ps-percent-row"><label class="ps-percent-label" for="ps-field-default-percent">'+tr('defaultPercent')+'</label><div class="ps-percent-input-wrap"><input class="ps-percent-input" id="ps-field-default-percent" type="number" min="0" step="0.01" placeholder="8" value="'+esc(percentDefault==null?'':percentDefault)+'"><span class="ps-percent-suffix">%</span></div><button type="button" class="ps-percent-apply" onclick="psApplyPercentToSkus(\''+(f?esc(f.id):'')+'\')">'+tr('batchApplyPercent')+'</button></div><div class="ps-percent-hint">'+tr('percentBatchHint')+'</div></div></section>';
 const categoryScopeSection='<section class="ps-editor-section" id="ps-category-scope-wrap" style="'+(type==='formula'?'display:none':'')+'"'+(isSrp?' hidden':'')+'"><div class="ps-editor-section-title">'+tr('scopeInfo')+'</div><div class="ps-category-toolbar"><button type="button" id="ps-select-all-categories" class="ps-category-select-all '+(allScope?'is-all':'')+'" onclick="psSelectAllCategories()"><span class="ps-checkmark">'+(allScope?'✓':'')+'</span>'+tr('selectAllCategories')+'</button></div><div class="ps-category-chips">'+checks+'</div><div class="ps-editor-help" style="margin-top:8px">'+tr('allCategoriesHelp')+'</div></section>';
 const fieldTypeOptions=isSrp
  ?'<option value="formula" '+(type==='formula'?'selected':'')+'>'+tr('calc')+'</option><option value="reference" '+(type==='reference'?'selected':'')+'>'+tr('reference')+'</option>'
  :'<option value="amount" '+(type==='amount'?'selected':'')+'>'+tr('amount')+'</option><option value="percent" '+(type==='percent'?'selected':'')+'>'+tr('percent')+'</option><option value="number" '+(type==='number'?'selected':'')+'>'+tr('number')+'</option><option value="formula" '+(type==='formula'?'selected':'')+'>'+tr('calc')+'</option><option value="reference" '+(type==='reference'?'selected':'')+'>'+tr('reference')+'</option>';
 const quoteSection='<section class="ps-editor-section" id="ps-field-quotation-wrap" style="'+(type==='amount'&&!isSrp?'':'display:none')+'"><div class="ps-editor-switch-line"><div class="ps-editor-switch-copy"><strong>'+tr('syncQuotationField')+'</strong><p>'+tr('syncQuotationFieldHelp')+'</p></div><input type="checkbox" class="ps-wac-switch" id="ps-field-sync-quotation" onchange="psToggleQuotationField()" '+(isQuote?'checked':'')+'></div></section>';
 const body='<div class="ps-field-editor"><div class="ps-editor-intro">'+tr('fieldEditorHint')+'</div><section class="ps-editor-section"><div class="ps-editor-section-title">'+tr('basicInfo')+'</div><div class="ps-editor-grid"><div class="ps-editor-control"><label>'+tr('fieldName')+'</label><input id="ps-field-name" value="'+esc(f?f.field_name:'')+'" '+(isSrp?'disabled':'')+'></div><div class="ps-editor-control"><label>'+tr('fieldKey')+'</label><input id="ps-field-key" value="'+esc(f?f.field_key:('fee_'+Date.now().toString(36)))+'" '+(f?'disabled':'')+'><span class="ps-editor-help">'+tr('fieldKeyHint')+'</span></div><div class="ps-editor-control"><label>'+tr('fieldType')+'</label><select id="ps-field-type" onchange="psToggleFormula()" '+(isWac||isQuote?'disabled':'')+'>'+fieldTypeOptions+'</select></div><div class="ps-editor-control"><label>'+tr('unit')+'</label><input id="ps-field-unit" '+(isQuote?'disabled':'')+' value="'+esc(f?f.unit:'')+'" placeholder="'+esc(type==='percent'?'%':(state.scheme.currency||''))+'"></div><div class="ps-editor-control"><label>'+tr('displayFormat')+'</label><select id="ps-field-display-format"><option value="auto" '+((!f||!f.display_format||f.display_format==='auto')?'selected':'')+'>'+tr('formatAuto')+'</option><option value="amount" '+(f&&f.display_format==='amount'?'selected':'')+'>'+tr('formatAmount')+'</option><option value="number" '+(f&&f.display_format==='number'?'selected':'')+'>'+tr('formatNumber')+'</option><option value="percent" '+(f&&f.display_format==='percent'?'selected':'')+'>'+tr('formatPercent')+'</option></select></div><div class="ps-editor-control"><label>'+tr('decimalPlaces')+'</label><input id="ps-field-decimal-places" type="number" min="0" max="6" step="1" value="'+esc(f&&f.decimal_places!=null?f.decimal_places:2)+'"></div></div></section>'+categoryScopeSection+referenceSection+'<section class="ps-editor-section" id="ps-field-wac-wrap" style="'+(type==='amount'&&!isSrp?'':'display:none')+'"><div class="ps-editor-switch-line"><div class="ps-editor-switch-copy"><strong>'+tr('syncWacField')+'</strong><p>'+tr('syncWacFieldHelp')+'</p></div><input type="checkbox" class="ps-wac-switch" id="ps-field-sync-wac" onchange="psToggleWacField()" '+(isWac?'checked':'')+'></div></section>'+quoteSection+percentSection+formulaSection+'</div>';
 const footer='<button type="button" class="ps-field-modal-btn" onclick="psOpenFieldsModal()">'+tr('cancel')+'</button><button type="button" class="ps-field-modal-btn primary" onclick="psSaveField(\''+(f?esc(f.id):'')+'\')">'+tr('confirm')+'</button>';
 state.modalLanguageRenderer=function(){window.psOpenFieldEditor(f?f.id:null,percentDefault);};
 openModal(f?tr('edit')+' · '+esc(f.field_name):tr('add')+' '+tr('fields'),body,footer,'modal-lg');
 const modal=document.getElementById('modal-content');if(modal)modal.classList.add('modal-price-field-editor');
 window.psRenderFormulaRules();window.psFormulaInputChanged();if(type==='reference')window.psReferenceSourceChanged(true);
};
window.psUpdateCategorySelectAll=function(){
 const checks=Array.from(document.querySelectorAll('.ps-cat-check'));const checked=checks.filter(x=>x.checked).length;const button=document.getElementById('ps-select-all-categories');
 const all=checks.length>0&&checked===checks.length;
 if(button){button.classList.toggle('is-all',all);const mark=button.querySelector('.ps-checkmark');if(mark)mark.textContent=all?'✓':'';}
};
window.psToggleFormula=function(){
 const t=document.getElementById('ps-field-type')?.value,w=document.getElementById('ps-formula-wrap'),p=document.getElementById('ps-percent-wrap'),a=document.getElementById('ps-field-wac-wrap'),qWrap=document.getElementById('ps-field-quotation-wrap'),scope=document.getElementById('ps-category-scope-wrap'),reference=document.getElementById('ps-reference-wrap'),c=document.getElementById('ps-field-sync-wac'),q=document.getElementById('ps-field-sync-quotation'),formula=document.getElementById('ps-field-formula');
 if(a)a.style.display=t==='amount'?'':'none';
 if(qWrap)qWrap.style.display=t==='amount'?'':'none';
 if(t!=='amount'){if(c)c.checked=false;if(q)q.checked=false;}
 if(w)w.style.display=(c&&c.checked)||(q&&q.checked)||t==='percent'||t==='reference'?'none':'';
 if(reference)reference.style.display=t==='reference'?'':'none';
 if(p)p.style.display=t==='percent'?'':'none';
 if(scope)scope.style.display=t==='formula'?'none':'';
 if(t!=='formula'&&formula&&formula.value.trim())formula.value='';
 if(t==='reference'){if(c)c.checked=false;if(q)q.checked=false;window.psReferenceSourceChanged(true);}
};
window.psToggleWacField=function(){const c=document.getElementById('ps-field-sync-wac'),q=document.getElementById('ps-field-sync-quotation'),t=document.getElementById('ps-field-type');if(c&&t){if(c.checked){t.value='amount';if(q)q.checked=false;}t.disabled=!!c.checked;}window.psToggleFormula();};
window.psToggleQuotationField=function(){const q=document.getElementById('ps-field-sync-quotation'),c=document.getElementById('ps-field-sync-wac'),t=document.getElementById('ps-field-type'),u=document.getElementById('ps-field-unit');if(q&&t){if(q.checked){t.value='amount';if(c)c.checked=false;}t.disabled=!!q.checked;if(u)u.disabled=!!q.checked;}window.psToggleFormula();};
window.psReferenceSourceChanged=async function(preserveField){
 const sourceSelect=document.getElementById('ps-reference-scheme'),fieldSelect=document.getElementById('ps-reference-field'),preview=document.getElementById('ps-reference-preview');
 if(!sourceSelect||!fieldSelect)return;
 const sourceId=String(sourceSelect.value||'');
 if(!sourceId){fieldSelect.innerHTML='<option value="">'+tr('referenceNoFields')+'</option>';fieldSelect.disabled=true;if(preview)preview.textContent=tr('referenceNoSchemes');return;}
 fieldSelect.disabled=true;fieldSelect.innerHTML='<option value="">'+tr('referenceLoading')+'</option>';
 if(preview)preview.textContent=tr('referenceLoading');
 try{
  const data=await api('/api/price-system/schemes/'+encodeURIComponent(sourceId)+'/fields');
  if(!document.getElementById('ps-reference-scheme')||document.getElementById('ps-reference-scheme').value!==sourceId)return;
  const fields=data.fields||[];
  window.__psReferenceFields=fields;window.__psReferenceSchemeMeta=data.scheme||{};
  const wanted=preserveField?String(window.__psReferenceFieldDraft||''):'';
  fieldSelect.innerHTML=fields.map(item=>'<option value="'+esc(item.field_key)+'">'+esc(item.field_name)+'</option>').join('')||'<option value="">'+tr('referenceNoFields')+'</option>';
  fieldSelect.disabled=!fields.length;
  fieldSelect.value=fields.some(item=>item.field_key===wanted)?wanted:(fields[0]?fields[0].field_key:'');
  window.__psReferenceFieldDraft=fieldSelect.value;
  const chosen=fields.find(item=>item.field_key===fieldSelect.value);
  const unit=document.getElementById('ps-field-unit'),format=document.getElementById('ps-field-display-format'),places=document.getElementById('ps-field-decimal-places');
  if(chosen){
   if(unit)unit.value=chosen.unit||((chosen.field_type==='amount'||chosen.display_format==='amount')?data.scheme.currency||'':'');
   if(format)format.value=chosen.display_format||'auto';
   if(places)places.value=chosen.decimal_places==null?2:chosen.decimal_places;
  }
  await window.psReferenceFieldChanged();
 }catch(error){
  fieldSelect.disabled=true;
  if(preview)preview.textContent=String(error&&error.message||error);
 }
};
window.psReferenceFieldChanged=async function(){
 const sourceSelect=document.getElementById('ps-reference-scheme'),fieldSelect=document.getElementById('ps-reference-field'),preview=document.getElementById('ps-reference-preview');
 if(!sourceSelect||!fieldSelect||!preview)return;
 const sourceId=String(sourceSelect.value||''),fieldKey=String(fieldSelect.value||'');
 window.__psReferenceFieldDraft=fieldKey;
 const chosen=(window.__psReferenceFields||[]).find(item=>item.field_key===fieldKey);
 if(chosen){const unit=document.getElementById('ps-field-unit'),format=document.getElementById('ps-field-display-format'),places=document.getElementById('ps-field-decimal-places');const meta=window.__psReferenceSchemeMeta||{};if(unit)unit.value=chosen.unit||((chosen.field_type==='amount'||chosen.display_format==='amount')?meta.currency||'':'');if(format)format.value=chosen.display_format||'auto';if(places)places.value=chosen.decimal_places==null?2:chosen.decimal_places;}
 if(!sourceId||!fieldKey){preview.textContent=tr('referenceNoFields');return;}
 preview.textContent=tr('referenceLoading');
 try{
  const data=await api('/api/price-system/schemes/'+encodeURIComponent(sourceId)+'/data');
  if(!document.getElementById('ps-reference-scheme')||document.getElementById('ps-reference-scheme').value!==sourceId||document.getElementById('ps-reference-field')?.value!==fieldKey)return;
  const sourceField=(data.fields||[]).find(item=>item.field_key===fieldKey);
  const sourceRows=new Map((data.rows||[]).map(row=>[String(row.sku_code||''),row]));
  const sample=state.rows.slice(0,3);
  const body=sample.map(row=>{
   const sourceRow=sourceRows.get(String(row.sku_code||''));
   const value=sourceRow&&sourceRow.values?sourceRow.values[fieldKey]:null;
   const shown=value==null?'—':fieldText(value,sourceField||{field_type:'number',display_format:'number'});
   return '<tr><td>'+esc(row.sku_code)+'</td><td>'+esc(shown)+'</td></tr>';
  }).join('');
  preview.innerHTML='<div class="ps-reference-preview-title">'+tr('referencePreview')+' · '+esc((data.scheme.sales_channel||data.scheme.platform)+' / '+(sourceField?sourceField.field_name:fieldKey))+'</div><div class="ps-reference-preview-table"><table><thead><tr><th>SKU</th><th>'+esc(sourceField?sourceField.field_name:fieldKey)+'</th></tr></thead><tbody>'+(body||'<tr><td colspan="2">—</td></tr>')+'</tbody></table></div>';
 }catch(error){preview.textContent=String(error&&error.message||error);}
};
window.psSaveField=async function(id){
 try{
  const data=collectFieldEditorValues();
  if(id==='builtin-srp')await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/formula','PUT',data.field_type==='reference'?{field_type:'reference',source_scheme_id:data.source_scheme_id,source_field_key:data.source_field_key}:{field_type:'formula',srp_formula:data.formula,srp_formula_rules:data.formula_rules});
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
window.psOpenVersionsModal=async function(){
 if(!state.scheme||!allowDiscardDirty())return;
 try{
  const versions=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/versions');
  const body=versions.length?versions.map(item=>
   '<div class="ps-version"><div><strong>'+tr('version')+' #'+esc(item.version_no)+'</strong> · '+esc(item.note||'')+
   '<div class="ps-version-meta">'+esc(item.created_by_name||'')+' · '+esc(item.created_at||'')+'</div></div>'+
   '<div class="ps-version-actions"><button type="button" class="ps-btn" onclick="psViewVersionDiff(\''+esc(item.id)+'\','+Number(item.version_no)+',1)">'+tr('viewChanges')+'</button>'+
   '<button type="button" class="ps-btn" onclick="psRestoreVersion(\''+esc(item.id)+'\','+Number(item.version_no)+')">'+tr('restore')+'</button></div></div>'
  ).join(''):'<div class="ps-empty">'+tr('noHistory')+'</div>';
  state.modalLanguageRenderer=function(){window.psOpenVersionsModal();};
  openModal(tr('history'),body,'<button class="btn btn-secondary" onclick="closeModal()">'+tr('close')+'</button>','modal-lg');
 }catch(error){err(error);}
};
function psFormatVersionDiffValue(value,propertyKey){
 if(value===null||value===undefined||value==='')return '—';
 if(propertyKey==='sync_wac'||propertyKey==='sync_quotation'||propertyKey==='is_active')return value?tr('enabled'):tr('disabled');
 if(propertyKey==='field_type')return ({amount:tr('amount'),percent:tr('percent'),number:tr('number'),formula:tr('calc'),reference:tr('referenceType')})[value]||String(value);
 if(propertyKey==='display_format')return ({auto:tr('formatAuto'),amount:tr('formatAmount'),number:tr('formatNumber'),percent:tr('formatPercent')})[value]||String(value);
 if(Array.isArray(value))return value.length?value.join(', '):tr('allCategories');
 if(typeof value==='object'){
  if(Object.prototype.hasOwnProperty.call(value,'value')){
   const amount=Number(value.value);
   let text=(value.currency?currencySymbol(value.currency)+' ':'')+(Number.isFinite(amount)?amount.toLocaleString(undefined,{maximumFractionDigits:8}):String(value.value));
   const meta=[];
   if(value.ci_no)meta.push('CI '+value.ci_no);
   if(value.warehouse)meta.push(value.warehouse);
   if(value.version_no)meta.push('WAC #'+value.version_no);
   if(value.last_inbound_date)meta.push(value.last_inbound_date);
   return text+(meta.length?' ('+meta.join(' · ')+')':'');
  }
  if(propertyKey==='formula_rules')return Object.keys(value).sort().map(key=>key+'：'+value[key]).join('；')||'—';
  return Object.keys(value).sort().map(key=>key+'：'+value[key]).join('；')||'—';
 }
 if(typeof value==='number')return value.toLocaleString(undefined,{maximumFractionDigits:8});
 return String(value);
}
function psVersionActionText(action){
 return action==='added'?tr('added'):(action==='removed'?tr('removed'):tr('updated'));
}
function psVersionPropertyLabel(item){
 const labels={currency:'currency',srp_formula:'formula',srp_formula_rules:'formulaRulesTitle',srp_source_scheme_id:'referenceSourceScheme',srp_source_field_key:'referenceSourceField',srp_sort_order:'fieldOrderTitle',status:'status',shop_name:'shop',platform:'platform',field_name:'fieldName',field_type:'fieldType',unit:'unit',applicable_categories:'categoryScope',formula:'formulaText',formula_rules:'formulaRulesTitle',display_format:'displayFormat',decimal_places:'decimalPlaces',sync_wac:'syncWacField',sync_quotation:'syncQuotationField',sort_order:'fieldOrderTitle',is_active:'status'};
 return tr(labels[item.property_key]||item.property_key||'');
}
function psRenderVersionDiffTable(rows,includeSku){
 if(!rows||!rows.length)return '<div class="ps-version-diff-empty">'+tr('noChanges')+'</div>';
 const header=includeSku
  ?'<tr><th style="width:75px">'+tr('changeType')+'</th><th style="width:130px">'+tr('sku')+'</th><th style="width:140px">'+tr('fieldName')+'</th><th>'+tr('beforeValue')+'</th><th>'+tr('afterValue')+'</th></tr>'
  :'<tr><th style="width:75px">'+tr('changeType')+'</th><th style="width:145px">'+tr('changeTarget')+'</th><th style="width:135px">'+tr('fieldName')+'</th><th>'+tr('beforeValue')+'</th><th>'+tr('afterValue')+'</th></tr>';
 const body=rows.map(item=>{
  const kind=includeSku
   ?(item.change_type==='srp_value'?tr('srpValue'):(item.change_type==='landing_cost'?tr('landingCost'):tr('manualValue')))
   :(item.scope==='scheme'?tr('schemeUpdated'):(item.action==='added'?tr('fieldAdded'):(item.action==='removed'?tr('fieldRemoved'):tr('fieldUpdated'))));
  const name=includeSku?(item.field_name||item.field_key||'—'):psVersionPropertyLabel(item);
  const target=includeSku?(item.sku_code||'—'):(item.scope==='scheme'?tr('scheme'):(item.field_name||item.field_key||'—'));
  const before=psFormatVersionDiffValue(item.old_value,item.property_key);
  const after=psFormatVersionDiffValue(item.new_value,item.property_key);
  return '<tr><td>'+psVersionActionText(item.action)+'<div class="ps-version-diff-muted">'+kind+'</div></td>'+
   '<td>'+esc(target)+'</td><td>'+esc(name)+'</td>'+
   '<td>'+esc(before)+'</td><td>'+esc(after)+'</td></tr>';
 }).join('');
 return '<div class="ps-version-diff-table-wrap"><table class="ps-version-diff-table"><thead>'+header+'</thead><tbody>'+body+'</tbody></table></div>';
}
window.psViewVersionDiff=async function(id,no,page){
 const currentPage=Math.max(1,Number(page||1));
 try{
  const data=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/versions/'+encodeURIComponent(id)+'/diff?page='+currentPage+'&page_size=100');
  const comparison=data.has_previous?tr('compareWith')+' #'+data.previous_version_no:tr('initialVersion');
  const summary=data.summary||{};
  const pills=[
   tr('settingsChanges')+' '+Number(summary.scheme_changes||0),
   tr('fieldChanges')+' '+Number(summary.field_changes||0),
   tr('skuDataChanges')+' '+Number(summary.sku_changes||0)
  ];
  let body='<div class="ps-version-diff-summary">'+pills.map(item=>'<span class="ps-version-diff-pill">'+esc(item)+'</span>').join('')+'</div>'+
   '<div class="ps-version-meta">'+esc(comparison)+' · '+esc(data.created_at||'')+'</div>';
  const settings=(data.scheme_changes||[]).concat(data.field_changes||[]);
  if(settings.length){
   body+='<div class="ps-version-diff-section">'+tr('settingsChanges')+'</div>'+psRenderVersionDiffTable(settings,false);
  }
  if((data.sku_changes||[]).length||Number(summary.sku_changes||0)){
   body+='<div class="ps-version-diff-section">'+tr('skuDataChanges')+' · '+tr('totalItems').replace('{count}',String(summary.sku_changes||0))+'</div>'+
    psRenderVersionDiffTable(data.sku_changes,true);
  }
  if(!settings.length&&!Number(summary.sku_changes||0))body+='<div class="ps-version-diff-empty">'+tr('noChanges')+'</div>';
  const pagination=data.pagination||{page:1,page_count:1,total:0};
  const footer=(pagination.page_count>1
   ?'<div class="ps-version-diff-pagination"><button type="button" class="ps-btn" '+(pagination.page<=1?'disabled':'')+' onclick="psViewVersionDiff(\''+esc(id)+'\','+Number(no)+','+(pagination.page-1)+')">'+tr('previousPage')+'</button><span>'+tr('page')+' '+pagination.page+' / '+pagination.page_count+'</span><button type="button" class="ps-btn" '+(pagination.page>=pagination.page_count?'disabled':'')+' onclick="psViewVersionDiff(\''+esc(id)+'\','+Number(no)+','+(pagination.page+1)+')">'+tr('nextPage')+'</button></div>'
   :'')+'<button class="btn btn-secondary" onclick="closeModal()">'+tr('close')+'</button>';
  state.modalLanguageRenderer=function(){window.psViewVersionDiff(id,no,pagination.page);};
  openModal(tr('version')+' #'+Number(no)+' · '+tr('changeDetails'),body,footer,'modal-lg');
 }catch(error){err(error);}
};

window.psRestoreVersion=async function(id,no){if(!confirm(tr('restore')+' #'+no+'？'))return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/versions/'+encodeURIComponent(id)+'/restore','POST',{});closeModal();await loadData(state.schemeId);if(typeof showToast==='function')showToast(tr('restored'),'success');}catch(e){err(e);}};
window.psDownloadImportTemplate=function(){
 if(!state.scheme||!state.rows.length||typeof XLSX==='undefined')return;
 const manual=state.fields.filter(f=>f.field_type!=='formula'&&f.field_type!=='reference'&&Number(f.sync_wac||0)!==1&&Number(f.sync_quotation||0)!==1);
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
  const manual=state.fields.filter(f=>f.field_type!=='formula'&&f.field_type!=='reference'&&Number(f.sync_wac||0)!==1&&Number(f.sync_quotation||0)!==1&&Object.prototype.hasOwnProperty.call(col,f.field_key));const rows=[];
  data.slice(1).forEach(r=>{const sku_code=String(r[skuIdx]||'').trim();if(!sku_code)return;const values={};manual.forEach(f=>{const v=r[col[f.field_key]];if(v!==''&&v!=null)values[f.field_key]=Number(v);});const row={sku_code,values};if(srpIdx>=0&&r[srpIdx]!==''&&r[srpIdx]!=null){const srp=Number(r[srpIdx]);if(!Number.isFinite(srp)||srp<0)throw new Error('SKU '+sku_code+' SRP must be a valid non-negative number');row.srp=srp;}if(Object.keys(values).length||Object.prototype.hasOwnProperty.call(row,'srp'))rows.push(row);});
  if(!rows.length){err(new Error('No valid SKU values found'));return;}const result=await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId)+'/values','POST',{rows});await loadData(state.schemeId);if(typeof showToast==='function')showToast(tr('importDone')+' / '+(result.saved_cells||0),'success');
 }catch(e){err(e);}finally{if(input)input.value='';}
};
window.psExportExcel=function(){
 if(!allowDiscardDirty())return;if(typeof XLSX==='undefined'||!state.rows.length||!state.scheme)return;
 const exportFields=state.fields.filter(f=>f.field_key!=='srp');const headers=[tr('category'),'SKU',tr('stock'),forecastAverageLabel(),tr('daysSinceInboundHeader'),tr('availableTurnover')].concat(exportFields.map(f=>f.field_name+' ['+f.field_key+']'),[tr('srp')]);
 const rows=state.rows.map(r=>[r.category||'',r.sku_code,Number(r.stock_qty||0),r.forecast_avg_sales==null?'':Math.round(Number(r.forecast_avg_sales)||0),r.days_since_last_inbound==null?'':Number(r.days_since_last_inbound),r.available_turnover==null?'':Number(r.available_turnover)].concat(exportFields.map(f=>r.values?r.values[f.field_key]:null),[r.srp==null?'':r.srp]));
 const sh=XLSX.utils.aoa_to_sheet([headers].concat(rows));exportFields.forEach((f,index)=>{if(f.display_format==='percent'&&f.field_type==='formula'){for(let rowIndex=1;rowIndex<=rows.length;rowIndex++){const cell=sh[XLSX.utils.encode_cell({r:rowIndex,c:6+index})];if(cell)cell.z='0.00%';}}else if(f.display_format==='percent'||(f.display_format==='auto'&&f.field_type==='percent')){for(let rowIndex=1;rowIndex<=rows.length;rowIndex++){const cell=sh[XLSX.utils.encode_cell({r:rowIndex,c:6+index})];if(cell)cell.z='0.00"%"';}}});sh['!cols']=headers.map((h,i)=>({wch:i===1?28:(i<4?18:18)}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sh,'Price System');
 const name=['Price',state.scheme.country,state.scheme.brand,state.scheme.platform].join('_').replace(/[\\/:*?"<>|]/g,'_');XLSX.writeFile(wb,name+'.xlsx');if(typeof showToast==='function')showToast(tr('exportDone'),'success');
};
window.psDeactivateScheme=async function(){if(!state.scheme||!allowDiscardDirty()||!confirm(tr('stopConfirm')))return;try{await api('/api/price-system/schemes/'+encodeURIComponent(state.schemeId),'DELETE');state.schemeId='';await loadSchemes('');}catch(e){err(e);}};
window.psDeleteScheme=function(){
 if(!state.scheme||!allowDiscardDirty())return;
 const body='<div style="font-size:13px;line-height:1.65;color:#444"><p>'+tr('deleteSchemeConfirm')+'</p><div style="margin:10px 0;padding:10px 12px;border-radius:8px;background:#f5f5f7;color:#1d1d1f;font-weight:600">'+esc(schemeLabel(state.scheme))+'</div><p style="color:#b42318">'+tr('deleteSchemeWarning')+'</p></div>';
 state.modalLanguageRenderer=function(){window.psDeleteScheme();};
 openModal(tr('deleteSchemeTitle'),body,'<button class="btn btn-secondary" onclick="closeModal()">'+tr('cancel')+'</button><button class="btn btn-primary" style="background:#d93025;border-color:#d93025" onclick="psConfirmDeleteScheme()">'+tr('deleteScheme')+'</button>','modal-md');
};
window.psConfirmDeleteScheme=async function(){
 const id=state.schemeId;if(!id)return;
 try{await api('/api/price-system/schemes/'+encodeURIComponent(id)+'/permanent','DELETE');closeModal();state.schemeId='';await loadSchemes('');if(typeof showToast==='function')showToast(tr('schemeDeleted'),'success');}
 catch(e){err(e);}
};
window.renderPriceSystem=async function(){navI18n();styles();state.dirty={};shell();try{await meta();await loadSchemes();}catch(e){err(e);const m=document.getElementById('ps-main');if(m)m.innerHTML='<div class="ps-card"><div class="ps-empty">'+esc(e.message||tr('saveFailed'))+'</div></div>';}};
})();