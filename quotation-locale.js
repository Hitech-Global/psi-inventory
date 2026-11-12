(function(global){
  'use strict';
  // Translation is scoped to the quotation module. Never rewrite other pages,
  // product master data, or imported source workbooks.
  const TABLES = {en: {"报价管理":"Quotation Management","FOB 报价、价格趋势、最近采购价对比与品牌报告":"FOB quotes, price trends, last purchase comparisons, and brand reports","下载模板":"Download Template","导入报价":"Import Quotes","智能导入报价":"Smart Quote Import","品牌（工作表未提供品牌时使用）":"Brand (used when the worksheet has none)","默认报价日期":"Default Quote Date","供应商":"Supplier","品牌":"Brand","产品类型":"Product Type","SKU / 关键词":"SKU / Keywords","搜索 SKU、产品类型或品牌":"Search SKU, product type, or brand","开始日期":"Start Date","结束日期":"End Date","全部":"All","品牌默认报价币种以「系统管理 → 品牌设置」为准；可选币种以「系统管理 → 币种设置」中启用的币种为准。FOB=0 表示当日未报价，会保留历史记录，但不参与价格趋势、报价环比或采购价环比。":"Default quote currency comes from System Management → Brand Settings; available currencies come from Currency Settings. FOB = 0 means no quote for that date. The record is kept but excluded from price trends and comparisons.","SKU 列表":"SKU List","最新FOB":"Latest FOB","币种":"Currency","报价日期":"Quote Date","较上次报价":"vs. Previous Quote","较上次采购价":"vs. Last Purchase","历史次数":"History Count","历史记录":"Historical Records","查看":"View","暂无报价数据，请先导入":"No quote data. Import a file to get started.","历史数据不足，暂无趋势图":"Not enough history to display a trend","加载中":"Loading","加载失败":"Failed to load","未关联":"Unlinked","已关联":"Linked","未报价":"No Quote","当前品牌暂无报价数据。":"No quote data for this brand.","暂无足够历史数据":"Not enough historical data","最新有效报价平均较上次":"Latest valid quote average vs. previous:","上涨":"Increased","下降":"Decreased","其中":"including","个条目最新记录为未报价":"items with no quote in their latest record","另有":"plus","条供应商料号尚未关联 PSI SKU":"supplier part numbers not linked to PSI SKUs","不参与内部采购价对比":"excluded from internal purchase-price comparisons","当前覆盖":"currently covers","个报价条目，共":"quote entries across","条历史记录":"historical records","与最近采购价可比的 SKU 中":"Among SKUs comparable with the last purchase price,","个高于上次采购价":"priced above the last purchase","个低于上次采购价":"priced below the last purchase","暂无可比数据":"No comparable data","暂无可比采购价":"No comparable purchase price","品牌报告":"Brand Report","自动生成 · 当前筛选口径":"Auto-generated · Current filters","导出品牌报告":"Export Brand Report","报价条目":"Quote Entries","本月更新":"Updated This Month","当前未报价":"Currently Unquoted","品牌报价趋势":"Brand Quote Trends","价格波动较大的 SKU":"Largest Price Movements","较上次采购价差异":"vs. Last Purchase Price","产品类型分布":"Product Type Breakdown","品牌简报":"Brand Summary","采购简报":"Procurement Summary","供应商料号":"Supplier Part Number","返回品牌报告":"Back to Brand Report","记录日期":"Record Date","FOB 价格趋势":"FOB Price Trend","最近采购基准（CI）":"Latest Purchase Baseline (CI)","该报价尚未关联 PSI SKU，不参与内部采购价对比":"This quote is not linked to a PSI SKU and is excluded from internal purchase-price comparisons","最近 CI 同 SKU 存在不同原单价，已阻止比较":"Latest CI has conflicting original unit prices for this SKU; comparison is unavailable","历史报价记录":"Quote History","较上一有效报价":"vs. Previous Valid Quote","备注":"Remarks","未关联料号数":"Unlinked Part Numbers","有效报价记录":"Valid Quote Records","较上次报价平均变化":"Average Change vs. Previous Quote","高于上次采购价":"Above Last Purchase","低于上次采购价":"Below Last Purchase","价格异动":"Price Movements","最新报价":"Latest Quotes","品牌概览":"Brand Overview","关联状态":"Match Status","型号":"Model","规格":"Specifications","跳过已有记录":"Skip Existing Records","覆盖已有记录":"Overwrite Existing Records","取消":"Cancel","开始导入":"Start Import","关闭":"Close","后台继续":"Continue in Background","正在导入":"Importing","导入中":"Importing","导入完成":"Import Complete","导入失败":"Import Failed","导入已阻断":"Import Blocked","导入结果待确认":"Import Result Pending Verification","正在启动":"Starting","文件已接收":"File received","正在校验":"Validating","正在匹配 SKU 主数据和历史映射":"Matching SKU master data and saved mappings","正在写入报价":"Writing quotes","正在确认结果":"Verifying import results","准备中":"Preparing","识别工作表":"Recognizing worksheets","批量写入":"Writing records","确认完成":"Finalizing","处理进度":"Processing Progress","未报价记录":"Unquoted Records","数据库任务实时状态":"Live database import status","已用时间":"Elapsed Time","这是后台实际任务进度，不是模拟动画。可以选择":"This is actual background task progress, not a simulated animation. You can choose","离开弹窗":"leave this dialog","刷新页面后系统会根据任务 ID 自动恢复状态，不会重复提交":"The system will restore the task by its ID after a refresh without submitting it again","正在等待服务器登记导入任务，请稍后重试状态查询。":"Waiting for the server to register the import task. Retry checking its status shortly.","未指定供应商（不保存料号映射）":"No supplier selected (mapping not saved)","正在加载":"Loading","自动识别 Excel 所有工作表、表头位置和常见供应商字段，不需要先改成 PSI 模板。":"Automatically detects every Excel worksheet, headers, and common supplier columns. No PSI template preparation needed.","未匹配 PSI SKU 的供应商料号也可以导入；FOB 空白或 0 表示未报价。单个文件最大 50MB，单次最多 5,000 行。":"Supplier part numbers without a PSI SKU match can also be imported; a blank or zero FOB means no quote. Maximum 50 MB per file and 5,000 rows per import.","重复供应商 + SKU/料号 + 品牌 + 报价日期":"Duplicate key: Supplier + SKU/Part No. + Brand + Quote Date","重复供应商":"Duplicate supplier","跳过未识别工作表":"Ignored worksheets","未关联的报价仍可导入，会保留供应商料号并标记为":"Unlinked quotes can still be imported. Supplier part numbers are retained and marked as","不会参与内部 SKU 采购价对比。可在下方搜索 SKU 手动关联":"They will not enter internal SKU purchase-price comparisons. Search below to match a SKU manually","确认后系统会记住映射":"The mapping will be saved after confirmation","如果品牌能唯一识别供应商，提交时会自动关联":"When a brand identifies exactly one supplier, it will be selected automatically on submission","否则仅本次关联，不保存映射":"Otherwise, the match is valid for this import only and will not be saved","以下显示未关联料号，每页最多":"Showing unlinked part numbers, maximum","条。其他未关联记录也会正常导入":"per page. All other unlinked records will also be imported","型号 / 规格":"Model / Specifications","品牌 / 类型":"Brand / Type","未分类":"Uncategorized","没有找到匹配":"No matching SKU found","上一页":"Previous","下一页":"Next","显示":"Showing","搜索":"Search","文件过大。单个报价导入文件最大 50MB，请压缩无关图片或拆分工作表后重试。":"File too large. Maximum 50 MB per workbook. Remove unnecessary images or split the workbook and retry.","智能识别模块尚未加载，请刷新页面后重试。":"Smart recognition module is not loaded. Refresh and retry.","没有识别到可导入数据。请确认工作表包含供应商料号（Part No. / SKU）和报价（FOB / Price）列。":"No importable quote rows found. Verify the sheet contains a Part No. / SKU column and a FOB / Price column.","文件读取失败":"Failed to read file","导入校验失败":"Import validation failed","请先选择文件":"Select a file first","请先选择文件。":"Select a file first.","导入请求暂未返回，系统正在通过任务 ID 自动确认结果。请勿重复提交。":"The import request has not returned yet. The system is reconciling the result by task ID. Do not submit it again.","无法加载供应商和 SKU 主数据":"Unable to load supplier and SKU master data","当前报价历史还不足以判断整体价格方向。":"Quote history is insufficient to determine an overall price direction.","最新有效报价较上一轮平均下降":"The latest valid quote average fell","最新有效报价较上一轮平均上涨":"The latest valid quote average rose","采购侧可以优先查看降价 SKU，再结合库存和补货需求决定是否下单。":"Review discounted SKUs first, then consider inventory levels and replenishment needs before ordering.","采购侧应优先关注涨幅大的 SKU，并在下单前核对涨价原因。":"Review the SKUs with the largest increases and verify the reasons before ordering.","最新有效报价较上一轮整体持平，采购侧重点应放在单 SKU 异动和最近采购价差异。":"The latest valid quotes were flat overall. Focus on individual SKU movements and differences from recent purchase prices.","这些 SKU 当前报价更有采购优势，可优先结合补货需求复核。":"These SKUs are now more attractive to purchase. Review them against replenishment needs.","建议优先议价或核对涨价原因，再决定是否下单。":"Negotiate or verify the increase before ordering.","当前没有高于上次采购价的可比 SKU。":"No comparable SKUs are priced above the last purchase price.","币种不一致":"Currency Mismatch","报价与上次采购价币种不同，系统不会自动换算，因此不参与采购价环比。":"The quote and last purchase use different currencies. No automatic conversion is applied, so the comparison is excluded.","当前筛选范围内没有能与报价 SKU 对上的同币种历史 CI/PI 采购记录。":"No historical CI/PI purchase at the same currency matches the selected quote SKUs.","这部分应先向供应商补报价，不进入价格优劣判断。":"Request missing quotes from the supplier before ranking prices.","当前所选范围内没有未报价 SKU。":"No unquoted SKUs in the current selection.","优先查看波动最大的 SKU，确认是否需要提前锁价、议价或延后采购。":"Review the largest SKU price moves and decide whether to lock a price, negotiate, or postpone purchases.","当前品牌":"Current Brand","个 SKU 低于上次采购价":"SKUs below last purchase price","个 SKU 高于上次采购价":"SKUs above last purchase price","个 SKU 币种不一致":"SKUs with currency mismatch","个 SKU 当前未报价":"SKUs currently unquoted","个降价":"price decreases","个涨价":"price increases","新增":"Added","更新":"Updated","跳过":"Skipped","页":"Page","条":"records"}, id: {"报价管理":"Manajemen Penawaran","智能导入报价":"Impor Penawaran Cerdas","报价":"Penawaran","下载模板":"Unduh Templat","导入报价":"Impor Penawaran","品牌":"Merek","产品类型":"Jenis Produk","供应商":"Pemasok","报价日期":"Tanggal Penawaran","开始日期":"Tanggal Mulai","结束日期":"Tanggal Akhir","全部":"Semua","取消":"Batal","开始导入":"Mulai Impor","查看":"Lihat","未报价":"Belum Ada Penawaran","未关联":"Belum Tertaut","关闭":"Tutup"}};
  const SORTED = Object.fromEntries(Object.entries(TABLES).map(([lang,map])=>[
    lang,Object.entries(map).sort((a,b)=>b[0].length-a[0].length)
  ]));
  const originals = new WeakMap();
  const translated = new WeakMap();
  function lang(){
    return typeof global.getLang==='function' ? global.getLang() : 'zh';
  }
  function label(source){
    const s=String(source==null?'':source);
    const m=TABLES[lang()]||{};
    return Object.prototype.hasOwnProperty.call(m,s)?m[s]:s;
  }
  function convert(text,language){
    let value=String(text==null?'':text);
    for(const [source,target] of SORTED[language]||[]){
      if(value.includes(source))value=value.split(source).join(target);
    }
    return value;
  }
  function translateText(node,language){
    const value=node.nodeValue||'';
    const previous=translated.get(node);
    if(!originals.has(node)||value!==previous) originals.set(node,value);
    const original=originals.get(node);
    const next=language==='zh'?original:convert(original,language);
    if(value!==next)node.nodeValue=next;
    translated.set(node,next);
  }
  function translateAttr(node,attr,language){
    const value=node.getAttribute(attr);
    if(value==null)return;
    const key='data-quotation-original-'+attr;
    const last='data-quotation-translated-'+attr;
    const previous=node.getAttribute(last);
    if(!node.hasAttribute(key)||value!==previous) node.setAttribute(key,value);
    const original=node.getAttribute(key);
    const next=language==='zh'?original:convert(original,language);
    if(next!==value)node.setAttribute(attr,next);
    node.setAttribute(last,next);
  }
  function apply(root){
    if(!root || !root.ownerDocument)return;
    const language=lang();
    if(!TABLES[language]&&language!=='zh')return;
    const document=root.ownerDocument;
    if(root.nodeType===3)translateText(root,language);
    const walker=document.createTreeWalker(root,4);
    let n;
    while((n=walker.nextNode())){
      const parent=n.parentElement;
      if(parent&&/^(SCRIPT|STYLE|TEXTAREA)$/.test(parent.tagName))continue;
      translateText(n,language);
    }
    const elements=[root,...root.querySelectorAll('[placeholder],[title],[aria-label]')];
    for(const el of elements){
      if(!el||typeof el.getAttribute!=='function')continue;
      for(const attr of ['placeholder','title','aria-label'])translateAttr(el,attr,language);
    }
  }
  global.QuotationLocale=Object.freeze({label,apply,convert});
})(window);
