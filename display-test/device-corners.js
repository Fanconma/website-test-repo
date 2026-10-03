/*!
 * device-corners.js v1.1.1
 * Query a device's screen corner radius and corner curvature.
 *
 * API
 *   DeviceCorners.detect()            -> Promise<Result>  (uses UA-CH model when available)
 *   DeviceCorners.detectSync()        -> Result           (UA-string fallback)
 *   DeviceCorners.lookup(modelCode)   -> Result | null    (pure database query)
 *   DeviceCorners.supportsSquircle()  -> boolean          (CSS corner-shape support)
 *   DeviceCorners.applyCss()          -> Promise<Result>  (sets --device-radius on <html>)
 *
 * Result = {
 *   radius: number          // base corner radius, CSS px (= dp on Android / pt on iOS)
 *   curve: 'squircle' | 'circular'   // modern screens use continuous curvature (superellipse),
 *                                    // NOT a quarter circle; radius is the base (inscribed) radius
 *   exact: boolean          // true only when read from the CSS `radius` media query (iOS Safari 16.4+)
 *   source: 'media-query' | 'ios-size-table' | 'model-database' | 'brand-default' | 'default'
 *   platform, model, device, brand
 * }
 *
 * Detection order: CSS radius media query (exact) -> iOS logical-size table ->
 * Android model-code database -> brand default -> generic default.
 * Desktop displays have square corners, so the generic default on Desktop is a
 * design radius (24) rather than a physical measurement — exported as
 * DeviceCorners.DEFAULTS so callers can override the choice in their UI.
 *
 * Model codes verified against the MobileModels database
 * (https://github.com/KHwang9883/MobileModels, CC BY-NC-SA 4.0 — data is
 * non-commercial licensed; check compatibility if your site is commercial).
 * Coverage: 2020+ (~6 years) per-model entries for Google Pixel, Honor, Huawei,
 * OPPO, vivo/iQOO, Samsung and Xiaomi/Redmi; Honor covers post-split (2021+)
 * models; older models fall back to the unified brand default.
 *
 * Radius values are squircle BASE radii in dp, initial estimates — calibrate
 * per model as needed. Lookups are O(code length) hash probes, independent of
 * database size; the packed database is parsed once at load (~1 ms for ~900
 * entries).
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeviceCorners = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= iOS logical-size table (fallback) ================= */
  var IOS_SIZES = {
    '375x812@3': 44, '414x896@3': 39, '414x896@2': 41.5, '390x844@3': 47.33,
    '428x926@3': 53.33, '393x852@3': 55, '430x932@3': 55,
    '402x874@3': 62, '440x956@3': 62, '420x912@3': 62
  };

  /* ================= Android model database (packed) =================
     One line per prefix family: 'prefix|device name|radius'.
     Parsed once at load into MODELS (public) and a prefix hash map used by
     lookup(). Prefix matching is longest-first, e.g. V2339FA (Neo9S Pro)
     wins over V2339A (Neo9 Pro). Source: KHwang9883/MobileModels. */
  var MODEL_DATA = {
    xiaomi: '23127PN0|Xiaomi 14|44\n23116PN5|Xiaomi 14 Pro|46\n2311BPN2|Xiaomi 14 Pro Ti|46\n24030PN6|Xiaomi 14 Ultra|46\n24031PN0|Xiaomi 14 Ultra|46\n2406APNF|Xiaomi 14T|44\n2407FPN8|Xiaomi 14T Pro|46\n24129PN7|Xiaomi 15|46\n24101PNB|Xiaomi 15 Pro|48\n2410DPN6|Xiaomi 15 Pro|48\n25010PN3|Xiaomi 15 Ultra|48\n25019PNF|Xiaomi 15 Ultra|48\n25042PN2|Xiaomi 15S Pro|48\n25069PTE|Xiaomi 15T|46\n2506BPN6|Xiaomi 15T Pro|48\n25113PN0|Xiaomi 17|48\n25098PN5|Xiaomi 17 Pro|50\n2509FPN0|Xiaomi 17 Pro Max|50\n2512BPND|Xiaomi 17 Ultra|50\n25128PNA|Xiaomi 17 Ultra|50\n2605EPN8|Xiaomi 17 Max|46\n2602DPT5|Xiaomi 17T|48\nM531DA|Xiaomi 17T|48\n2602EPTC|Xiaomi 17T Pro|50\nM025EC|Xiaomi 17T Pro|50\n24053PY0|Xiaomi Civi 4 Pro|44\n25067PYE|Xiaomi Civi 5 Pro|44\n2308CPXD|Xiaomi MIX Fold 3|18\n24072PX7|Xiaomi MIX Fold 4|18\n2405CPX3|Xiaomi MIX Flip|40\n2505APX7|Xiaomi MIX Flip 2|40\n23113RKC|Redmi K70|40\n23117RK6|Redmi K70 Pro|42\n2311DRK4|Redmi K70E|36\n2407FRK8|Redmi K70 Ultra|42\n24117RK2|Redmi K80|42\n24122RKC|Redmi K80 Pro|44\n24127RK2|Redmi K80 Pro|44\n25060RK1|Redmi K80 Ultra|44\n2510DRK4|Redmi K90|44\n25102RKB|Redmi K90 Pro Max|46\n25102RK6|Redmi K90 Pro Max|46\n2604FRK1|Redmi K90 Max|46\n24069RA2|Redmi Turbo 3|38\n24129RT7|Redmi Turbo 4|40\n25053RT4|Redmi Turbo 4 Pro|42\n2511FRT3|Redmi Turbo 5|42\n2606FRT3|Redmi Turbo 5|42\n2602BRT1|Redmi Turbo 5 Max|44\n23129RAA|Redmi Note 13|30\n23129RA5|Redmi Note 13|30\n23124RA7|Redmi Note 13|30\n2312DRAA|Redmi Note 13 5G|32\n23117RA6|Redmi Note 13 Pro|36\n2312DRA5|Redmi Note 13 Pro 5G|36\n2312CRAD|Redmi Note 13 Pro 5G|36\n23090RA9|Redmi Note 13 Pro+|38\n2406ERN9|Redmi Note 13R|32\n2311FRAF|Redmi Note 13R Pro|32\n24117RN7|Redmi Note 14|32\n24094RAD|Redmi Note 14 5G|32\n2502FRA6|Redmi Note 14S|36\n24116RAC|Redmi Note 14 Pro|38\n24090RA2|Redmi Note 14 Pro 5G|38\n24115RA8|Redmi Note 14 Pro+|40\n2510DRA2|Redmi Note 15|34\n25098RA9|Redmi Note 15 5G|34\n26022PCA|Redmi Note 15 SE 5G|34\n25100RA6|Redmi Note 15 Pro|40\n25080RAB|Redmi Note 15 Pro 5G|40\n2510ERA8|Redmi Note 15 Pro+|42\n25104RAD|Redmi Note 15 Pro+|42\n25057RA0|Redmi Note 15R|34\n2404ARN4|Redmi 13|30\n24049RN2|Redmi 13|30\n24040RN6|Redmi 13|30\n23106RN0|Redmi 13C|28\n2311DRN1|Redmi 13C|28\n23100RN8|Redmi 13C|28\n23108RN0|Redmi 13C|28\n23124RN8|Redmi 13C 5G|28\n2409BRN2|Redmi 14C|28\n2411DRN4|Redmi 14C 5G|28\n25062RN2|Redmi 15|30\n25057RN0|Redmi 15 5G|30\n25078RA3|Redmi 15C|28\n2508CRN2|Redmi 15C 5G|28\n25082RNC|Redmi 15R 5G|28\n2602BRNA|Redmi 15A 5G|28\nM2001J2|Xiaomi 10|36\nM2001J1|Xiaomi 10 Pro|40\nM2002J9E|Xiaomi 10 青春版|30\nM2007J1SC|Xiaomi 10 至尊纪念版|42\nM2102J2SC|Xiaomi 10S|36\nM2011K2C|Xiaomi 11|42\nM2102K1AC|Xiaomi 11 Pro|46\nM2102K1C|Xiaomi 11 Ultra|48\nM2101K9C|Xiaomi 11 青春版|32\n2107119DC|Xiaomi 11 青春活力版|30\n2201123C|Xiaomi 12|40\n2112123AC|Xiaomi 12X|38\n2201122C|Xiaomi 12 Pro|44\n2207122MC|Xiaomi 12 Pro 天玑版|44\n2206123SC|Xiaomi 12S|40\n2206122SC|Xiaomi 12S Pro|44\n2203121C|Xiaomi 12S Ultra|46\n2211133C|Xiaomi 13|44\n2210132C|Xiaomi 13 Pro|48\n2304FPN6DC|Xiaomi 13 Ultra|50\n2106118C|Xiaomi MIX 4|44\n22061218C|Xiaomi MIX Fold 2|18\n2109119BC|Xiaomi Civi / 1S|32\n2209129SC|Xiaomi Civi 2|36\n23046PNC9C|Xiaomi Civi 3|40\nM2004J19C|Redmi 9|22\nM2006C3LC|Redmi 9A|20\n220233L2C|Redmi 10A|22\n23077RABDC|Redmi 12 5G|28\n23076RA4BC|Redmi 12R / Redmi Note 12R|26\nM2010J19SC|Redmi Note 9 4G|22\nM2007J22C|Redmi Note 9 5G|24\nM2007J17C|Redmi Note 9 Pro|26\nM2103K19C|Redmi Note 10 5G / Redmi Note 11SE|26\nM2104K10AC|Redmi Note 10 Pro|30\n21121119SC|Redmi Note 11 4G|24\n21091116AC|Redmi Note 11 5G|26\n22041219C|Redmi Note 11E 5G|26\n21091116C|Redmi Note 11 Pro|30\n2201116SC|Redmi Note 11E Pro|28\n21091116UC|Redmi Note 11 Pro+|32\n22041216C|Redmi Note 11T Pro|30\n22041216UC|Redmi Note 11T Pro+|32\n22095RA98C|Redmi Note 11R|24\n22101317C|Redmi Note 12 5G / Redmi Note 12R Pro|28\n22101316C|Redmi Note 12 Pro|32\n22101316UCP|Redmi Note 12 Pro+|34\n22101316UC|Redmi Note 12 探索版|34\n22101320C|Redmi Note 12 Pro 极速版|34\n23054RA19C|Redmi Note 12T Pro|32\n23049RAD8C|Redmi Note 12 Turbo|36\nM2004J7AC|Redmi 10X 5G|26\nM2004J7BC|Redmi 10X Pro 5G|28\nM2003J15SC|Redmi 10X 4G|26\nM2001J11C|Redmi K30 Pro|28\nM2001J11E|Redmi K30 Pro|28\nM2006J10C|Redmi K30 至尊纪念版|28\nM2007J3SC|Redmi K30S 至尊纪念版|28\nM2012K11AC|Redmi K40|30\nM2012K11C|Redmi K40 Pro / Redmi K40 Pro+|32\nM2012K10C|Redmi K40 游戏增强版|34\n22021211RC|Redmi K40S|32\n22041211AC|Redmi K50|34\n22011211C|Redmi K50 Pro|36\n21121210C|Redmi K50 电竞版|36\n22081212C|Redmi K50 至尊版|38\n23013RK75C|Redmi K60|36\n22127RK46C|Redmi K60 Pro|38\n22122RK93C|Redmi K60E|34\n23078RKD5C|Redmi K60 至尊版|40',
    samsung: 'SM-S911|Galaxy S23|30\nSM-S916|Galaxy S23+|30\nSM-S918|Galaxy S23 Ultra|16\nSM-S711|Galaxy S23 FE|28\nSM-S921|Galaxy S24|30\nSM-S926|Galaxy S24+|30\nSM-S928|Galaxy S24 Ultra|16\nSM-S721|Galaxy S24 FE|28\nSM-S931|Galaxy S25|30\nSM-S936|Galaxy S25+|30\nSM-S938|Galaxy S25 Ultra|22\nSM-S937|Galaxy S25 Edge|30\nSM-S731|Galaxy S25 FE|28\nSM-S942|Galaxy S26|30\nSM-S947|Galaxy S26+|30\nSM-S948|Galaxy S26 Ultra|24\nSM-S741|Galaxy S26 FE|28\nSM-F946|Galaxy Z Fold5|14\nSM-F956|Galaxy Z Fold6|14\nSM-F958|Galaxy Z Fold SE|14\nSM-F966|Galaxy Z Fold7|14\nSM-F968|Galaxy Z TriFold|12\nSM-F971|Galaxy Z Fold8|14\nSM-F976|Galaxy Z Fold8 Ultra|14\nSM-F731|Galaxy Z Flip5|16\nSM-F741|Galaxy Z Flip6|16\nSM-F766|Galaxy Z Flip7|16\nSM-F761|Galaxy Z Flip7 FE|16\nSM-F776|Galaxy Z Flip8|16\nSM-A546|Galaxy A54 5G|30\nSM-A556|Galaxy A55 5G|30\nSM-A566|Galaxy A56 5G|30\nSM-A576|Galaxy A57 5G|30\nSM-A356|Galaxy A35 5G|28\nSM-A366|Galaxy A36 5G|28\nSM-A376|Galaxy A37 5G|28\nSM-A256|Galaxy A25 5G|24\nSM-A266|Galaxy A26 5G|24\nSM-A276|Galaxy A27 5G|24\nSM-A155|Galaxy A15|20\nSM-A156|Galaxy A15 5G|20\nSM-A165|Galaxy A16|20\nSM-A166|Galaxy A16 5G|20\nSM-A175|Galaxy A17|20\nSM-A176|Galaxy A17 5G|20\nSM-A185|Galaxy A18|20\nSM-G980|Galaxy S20|30\nSM-G981|Galaxy S20|30\nSCG01|Galaxy S20|30\nSC-51A|Galaxy S20|30\nSC51AA|Galaxy S20|30\nSM-G985|Galaxy S20+|32\nSM-G986|Galaxy S20+|32\nSCG02|Galaxy S20+|32\nSC-52A|Galaxy S20+|32\nSM-G988|Galaxy S20 Ultra|16\nSCG03|Galaxy S20 Ultra|16\nSM-G780|Galaxy S20 FE|28\nSM-G781|Galaxy S20 FE|28\nSM-G991|Galaxy S21|32\nSCG09|Galaxy S21|32\nSC-51B|Galaxy S21|32\nSM-G996|Galaxy S21+|32\nSCG10|Galaxy S21+|32\nSM-G998|Galaxy S21 Ultra|16\nSC-52B|Galaxy S21 Ultra|16\nSM-G990|Galaxy S21 FE|28\nSM-S901|Galaxy S22|30\nSCG13|Galaxy S22|30\nSC-51C|Galaxy S22|30\nSM-S906|Galaxy S22+|32\nSM-S908|Galaxy S22 Ultra|16\nSCG14|Galaxy S22 Ultra|16\nSC-52C|Galaxy S22 Ultra|16\nSM-N980|Galaxy Note20|30\nSM-N981|Galaxy Note20|30\nSM-N985|Galaxy Note20 Ultra|16\nSM-N986|Galaxy Note20 Ultra|16\nSCG06|Galaxy Note20 Ultra|16\nSC-53A|Galaxy Note20 Ultra|16\nSM-F916|Galaxy Z Fold2|14\nSM-F926|Galaxy Z Fold3|14\nSCG11|Galaxy Z Fold3|14\nSC-55B|Galaxy Z Fold3|14\nSM-F936|Galaxy Z Fold4|14\nSCG16|Galaxy Z Fold4|14\nSC-55C|Galaxy Z Fold4|14\nSM-F700|Galaxy Z Flip|16\nSCV47|Galaxy Z Flip|16\nSM-F707|Galaxy Z Flip 5G|16\nSCG04|Galaxy Z Flip 5G|16\nSM-F711|Galaxy Z Flip3|16\nSCG12|Galaxy Z Flip3|16\nSC-54B|Galaxy Z Flip3|16\nSM-F721|Galaxy Z Flip4|16\nSCG17|Galaxy Z Flip4|16\nSC-54C|Galaxy Z Flip4|16\nSM-A022|Galaxy A02|20\nSM-A025|Galaxy A02s|20\nSM-S124|Galaxy A02s|20\nSM-A035|Galaxy A03|20\nSM-A032|Galaxy A03 Core|20\nSM-A037|Galaxy A03s|20\nSM-S134|Galaxy A03s|20\nSM-A045|Galaxy A04|20\nSM-A042|Galaxy A04e|20\nSM-A047|Galaxy A04s|20\nSM-A055|Galaxy A05|20\nSM-A057|Galaxy A05s|20\nSM-A065|Galaxy A06|20\nSM-A066|Galaxy A06 5G|20\nSM-A075|Galaxy A07|20\nSM-A076|Galaxy A07 5G|20\nSM-A077|Galaxy A07s|20\nSM-A085|Galaxy A08|20\nSM-A125|Galaxy A12|20\nSM-S127|Galaxy A12|20\nSM-A127|Galaxy A12 Nacho|20\nSM-A135|Galaxy A13|20\nSM-A137|Galaxy A13|20\nSM-A136|Galaxy A13 5G|20\nSM-S136|Galaxy A13 5G|20\nSM-A145|Galaxy A14|20\nSM-A146|Galaxy A14 5G|20\nSM-S146|Galaxy A14 5G|20\nSM-A225|Galaxy A22|24\nSM-A226|Galaxy A22 5G / Galaxy A22s 5G|24\nSC-56B|Galaxy A22 5G|24\nSM-A235|Galaxy A23|24\nSM-A236|Galaxy A23 5G|24\nSM-S236|Galaxy A23 5G|24\nSM-S237|Galaxy A23 5G|24\nSCG18|Galaxy A23 5G|24\nSC-56C|Galaxy A23 5G|24\nSM-A233|Galaxy A23 5G|24\nSM-A245|Galaxy A24|24\nSM-A315|Galaxy A31|26\nSM-A325|Galaxy A32|28\nSM-A326|Galaxy A32 5G|28\nSM-S326|Galaxy A32 5G|28\nSCG08|Galaxy A32 5G|28\nSM-A336|Galaxy A33 5G|28\nSM-A346|Galaxy A34 5G|28\nSM-A516|Galaxy A51 5G|26\nSM-A525|Galaxy A52|28\nSM-A526|Galaxy A52 5G|28\nSC-53B|Galaxy A52 5G|28\nSM-A528|Galaxy A52s 5G|28\nSM-A536|Galaxy A53 5G|28\nSM-S536|Galaxy A53 5G|28\nSCG15|Galaxy A53 5G|28\nSC-53C|Galaxy A53 5G|28\nSM-A715|Galaxy A71|28\nSM-A716|Galaxy A71 5G|28\nSM-A725|Galaxy A72|30\nSM-A736|Galaxy A73 5G|30\nSM-M315|Galaxy M31|24\nSM-M317|Galaxy M31s|24\nSM-M515|Galaxy M51|26\nSM-M526|Galaxy M52 5G|28\nSM-M536|Galaxy M53 5G|28\nSM-M546|Galaxy M54 5G|30\nSM-M556|Galaxy M55 5G|30\nSM-M558|Galaxy M55s 5G|30\nSM-F415|Galaxy F41|24\nSM-E526|Galaxy F52 5G|24\nSM-E546|Galaxy F54 5G|26\nSM-E625|Galaxy F62|28',
    huawei: 'BRA-AL|Mate 60|44\nALN-AL|Mate 60 Pro|46\nCLS-AL|Mate 70|46\nPLR-AL|Mate 70 Pro|48\nPLA-AL|Mate 70 Pro+|48\nPLU-AL|Mate 70 RS|48\nSUP-AL|Mate 70 Air|44\nVYG-AL|Mate 80|48\nSGT-AL|Mate 80 Pro|50\nSGU-AL|Mate 80 RS|50\nHLS-AL|Mate 90|50\nCMS-AL|Mate 90 Pro|52\nCMM-AL|Mate 90 Pro Max|52\nCMU-AL|Mate 90 RS|52\nALT-AL|Mate X3 / X5|18\nGRL-AL|Mate XT / XTs|10\nICL-AL|Mate X6|18\nDEL-AL|Mate X7|18\nLAP-AL|Mate XT 2|10\nLNA-AL|P60|42\nMNA-AL|P60 Pro|44\nADY-AL|Pura 70|44\nHBN-AL|Pura 70 Pro|46\nHBP-AL|Pura 70 Ultra|46\nHED-AL|Pura 80|46\nLMR-AL|Pura 80 Pro|48\nKEE-AL|Pura 90|48\nMLN-AL|Pura 90 Pro|50\nSCA-AL|Pura 90 Pro Max|50\nVDE-AL|Pura X|16\nHOP-AL|Pura X Max|16\nVOL-AL|Pura X View|16\nLEM-AL|Pocket 2|40\nBLK-AL|nova 12 / 13|38\nADA-AL|nova 12 Pro|40\nMIS-AL|nova 13 Pro|40\nTLR-AL|nova 14|40\nTYR-AL|nova 14 活力版|38\nMIA-AL|nova 14 Pro|42\nMRT-AL|nova 14 Ultra|44\nPSD-AL|nova Flip / Flip S|40\nPSN-AL|nova 15|40\nKLE-AL|nova 15 Pro|42\nSLY-AL|nova 15 Ultra|44\nEMA-AL|nova 16|40\nCRS-AL|nova 16 Pro|42\nHIP-AL|nova 16 Ultra|44\nPKN-AL|nova 16z|36\nCAS-AL|nova 16 SE|36\nOCE-AN|Mate 40|44\nOCE-AL|Mate 40E|44\nNOH-AN|Mate 40 Pro|50\nNOH-AL|Mate 40 Pro|50\nNOH-AN50|Mate 40E Pro|44\nNOH-AN80|Mate 40E Pro|44\nNOP-AN|Mate 40 Pro+ / Mate 40 RS 保时捷设计|50\nCET-AL|Mate 50|46\nCET-AL60|Mate 50E|44\nDCO-AL|Mate 50 Pro / Mate 50 RS 保时捷设计|50\nTAH-AN|Mate Xs|18\nTET-AN|Mate X2|18\nTET-AL|Mate X2|18\nPAL-AL|Mate Xs 2|16\nANA-AL|P40|44\nANA-AN|P40|44\nANA-TN|P40|44\nELS-AN|P40 Pro|50\nELS-TN|P40 Pro|50\nABR-AL|P50|42\nJAD-AL|P50 Pro|48\nBAL-AL|P50 Pocket|38\nBAL-AL60|Pocket S|36\nJEF-AN|nova 7|32\nJEF-TN|nova 7|32\nJER-AN|nova 7 Pro|36\nJER-TN|nova 7 Pro|36\nCDY-AN|nova 7 SE|30\nCDY-TN|nova 7 SE|30\nCND-AN|nova 7 SE 5G 活力版|30\nCDL-AN|nova 7 SE 5G 乐活版|30\nANG-AN|nova 8|34\nBRQ-AN|nova 8 Pro|38\nBRQ-AL|nova 8 Pro|38\nJSC-AN|nova 8 SE|30\nJSC-TN|nova 8 SE|30\nJSC-AL|nova 8 SE|30\nCHL-AL|nova 8 SE 活力版|30\nNAM-AL|nova 9|36\nRTE-AL|nova 9 Pro|40\nJLN-AL|nova 9 SE|34\nNCO-AL|nova 10|38\nGLA-AL|nova 10 Pro|42\nCHA-AL|nova 10z|32\nBNE-AL|nova 10 SE|34\nJLN-AL00|nova 10 青春版|32\nFOA-AL|nova 11|38\nGOA-AL|nova 11 Pro|42\nGOA-AL80U|nova 11 Ultra|44\nBON-AL|nova 11 SE|34',
    honor: 'PGT-AN|Magic5|44\nVER-AN|Magic V2 / Vs2|14\nREA-AN|90|40\nREP-AN|90 Pro|42\nMAG-AN|90 GT|42\nMAA-AN|100|40\nALI-AN|X50|34\nALP-AN|X50 Pro / GT|36\nCRT-AN|X50i|30\nLLY-AN|X50i+ / Play8T Pro|30\nVCA-AN|V Purse|40\nBVL-AN|Magic6|46\nFCP-AN|Magic V3|14\nFLC-AN|Magic Vs3|14\nLRA-AN|Magic V Flip|40\nELI-AN|200|42\nELP-AN|200 Pro|44\nBRC-AN|X60|34\nBRP-AN|X60 Pro|36\nLYN-AN|X60i / Play9T Pro|30\nPTP-AN|Magic7|46\nMBH-AN|Magic V5|14\nCLE-AN|Magic V Flip2|40\nAMM-AN|300|42\nAMP-AN|300 Pro / Ultra|44\nAGI-AN|X60 GT|36\nALT-AN|Play9T|26\nJDY-AN|Play9C / 畅玩50|26\nDVD-AN|Power|36\nBKQ-AN|Magic8|48\nLDY-AN|Magic8 Pro Air|46\nPNM-AN|Magic V6|14\nDNN-AN|400|42\nDNP-AN|400 Pro|44\nPPG-AN|GT Pro|44\nAMG-AN|GT|42\nMTN-AN|X70|36\nABR-AN|X70i|30\nMLY-AN|Magic9|48\nMLM-AN|Magic9 超能版|48\nWKL-AN|Magic9 Pro Max|50\nMEY-AN|500|44\nMEP-AN|500 Pro|46\nVKJ-AN|600|44\nVKI-AN|600 Pro|46\nBSN-AN|X80 Pro Max|36\nLNA-AN|X80i / Play11 Plus|30\nLOG-AN|Play10 / 畅玩70 Plus|26\nNIC-AN|Play10C / 畅玩60|26\nNLA-AN|Play10A / 畅玩80|26\nMRK-AN|Play11|26\nLAB-AN|Play11T|26\nSER-AN|Power2|36\nELZ-AN|Magic3|44\nELZ-AN10|Magic3 Pro|48\nELZ-AN20|Magic3 至臻版|48\nMGI-AN|Magic V|14\nLGE-AN|Magic4|44\nLGE-AN10|Magic4 Pro|48\nLGE-AN20|Magic4 至臻版|48\nFRI-AN|Magic Vs|14\nNTH-AN|50|38\nRNA-AN|50 Pro|42\nRNA-TN|50 Pro|42\nJLH-AN|50 SE|34\nLSA-AN|60|40\nTNA-AN|60 Pro|44\nTNA-TN|60 Pro|44\nGIA-AN|60 SE|34\nFNE-AN|70|40\nSDY-AN|70 Pro|44\nHPB-TN|70 Pro+|44\nANN-AN|80|40\nANP-AN|80 Pro|44\nANB-AN|80 Pro 直屏版|40\nGIA-AN80|80 SE|32\nAGT-AN|80 GT|40\nYOK-AN|V40|38\nALA-AN|V40 轻奢版|36\nNTN-AN|X20|30\nCHL-AN|X20 SE|26\nANY-AN|X30|32\nTFY-AN|X30i|26\nKKG-AN|X30 Max|26\nRMO-AN|X40|36\nDIO-AN|X40i|28\nADT-AN|X40 GT / X40 GT 竞速版|36\nHJC-AN|Play5|26\nNEW-AN|Play5 活力版|26\nKOZ-AL|Play5T|24\nNZA-AL|Play5T 活力版|24\nCHL-AL00|Play5T Pro|26\nCMA-AN|Play6T|26\nVNE-AN|Play6C|24\nRKY-AN|Play7T|26\nDIO-AN00|Play7T Pro|26\nCLK-AN|Play8T|26',
    oppo: 'PGFM10|Find X6|44\nPGEM10|Find X6 Pro|46\nPHZ110|Find X7|44\nPHY110|Find X7 Ultra|46\nPHY120|Find X7 Ultra 卫星版|46\nPKB110|Find X8|46\nPKC110|Find X8 Pro|48\nPKC130|Find X8 Pro 卫星版|48\nPKT110|Find X8s|44\nPLB110|Find X8s+|46\nPKJ110|Find X8 Ultra|48\nPKU110|Find X8 Ultra 卫星版|48\nPLJ110|Find X9|46\nPLG110|Find X9 Pro|48\nPLG120|Find X9 Pro 卫星版|48\nPME110|Find X9s Pro|46\nPMA110|Find X9 Ultra|48\nPMA120|Find X9 Ultra 卫星版|48\nPMW110|Find X10|48\nPNA110|Find X10 E|44\nPMX110|Find X10 Pro Max|50\nPHN110|Find N3|16\nPHT110|Find N3 Flip|38\nPKH110|Find N5|16\nPKH120|Find N5 卫星版|16\nPLP110|Find N6|16\nPLP120|Find N6 卫星版|16\nPHM110|Reno9|36\nPGX110|Reno9 Pro|38\nPGW110|Reno9 Pro+|40\nPHW110|Reno10|38\nPHV110|Reno10 Pro|40\nPHU110|Reno10 Pro+|42\nPJH110|Reno11|38\nPJJ110|Reno11 Pro|40\nPJV110|Reno12|38\nPJW110|Reno12 Pro|40\nPKM110|Reno13|40\nPKK110|Reno13 Pro|42\nPLA110|Reno14|40\nPKZ110|Reno14 Pro|42\nPLW110|Reno15|40\nPLV110|Reno15 Pro|42\nPMD110|Reno15c|34\nPMM110|Reno16|40\nPMK110|Reno16 Pro|42\nPHS110|A1 5G|30\nPHQ110|A1 Pro|32\nPHJ110|A1x / A58|30\nPJB110|A2|30\nPJU110|A2m / A1i|30\nPJS110|A2x|30\nPJG110|A2 Pro|32\nPKA110|A3 5G|30\nPKD110|A3 活力版|30\nPKD120|A3m|30\nPKD130|A3x|30\nPKL110|A3i|30\nPJY110|A3 Pro / A5 Plus|32\nPKQ110|A5 5G / A6 Plus|30\nPKV110|A5 活力版 / K13x|30\nPKW110|A5x / A5m|30\nPKW120|A6i|30\nPKP110|A5 Pro|32\nPLS120|A6|30\nPLL110|A6 GT / K13s|32\nPLN110|A6 Pro|32\nPLT120|A6s / A6i+|30\nPLT130|A6v|30\nPLT140|A6x / A6m|30\nPMC110|A6c|30\nPLT150|A7i / K15x|30\nPYE110|A7 Pro / K15s|32\nPYC110|A7 Pro Max|32\nPJC110|K11|32\nPHF110|K11x|30\nPJR110|K12|32\nPKS110|K12 Plus|34\nPJT110|K12x|30\nPLD110|K12s|32\nPLM110|K13 Turbo|34\nPLE110|K13 Turbo Pro|34\nPYD110|K15|34\nPMH110|K15 Pro|34\nPMG110|K15 Pro+|36\nPYE130|K15s|32\nPDEM10|Find X2|42\nPDET10|Find X2|42\nPDEM30|Find X2 Pro|48\nPEDM00|Find X3|42\nPEEM00|Find X3 Pro / 摄影师版|48\nPFFM10|Find X5|44\nPFEM10|Find X5 Pro|48\nPFFM20|Find X5 Pro 天玑版|48\nPEUM00|Find N|16\nPGU110|Find N2|16\nPGT110|Find N2 Flip|38\nPDPM00|Reno4|34\nPDPT00|Reno4|34\nPDNM00|Reno4 Pro|38\nPDNT00|Reno4 Pro|38\nPEAM00|Reno4 SE|32\nPEAT00|Reno4 SE|32\nPEGM00|Reno5|34\nPEGT00|Reno5|34\nPEGM10|Reno5 K|34\nPEGT10|Reno5 K|34\nPDSM00|Reno5 Pro|38\nPDST00|Reno5 Pro|38\nPDRM00|Reno5 Pro+|40\nPEQM00|Reno6|34\nPEPM00|Reno6 Pro|38\nPENM00|Reno6 Pro+|40\nPFJM10|Reno7|34\nPFDM00|Reno7 Pro|38\nPFCM00|Reno7 SE|32\nPGBM10|Reno8|34\nPGAM10|Reno8 Pro|38\nPFZM10|Reno8 Pro+|40\nPDAM10|A52|26\nPDAT10|A52|26\nPECM20|A53|26\nPECM30|A53|26\nPECT30|A53|26\nPEMM00|A55 / A55s|26\nPEMM20|A55|26\nPEMT00|A55|26\nPEMT20|A55|26\nPFVM10|A56|24\nPFTM20|A56s / A57|24\nPDYM20|A72|28\nPDYT20|A72|28\nPDKM00|A92s|28\nPDKT00|A92s|28\nPEHM00|A93|28\nPEHT00|A93|28\nPELM00|A95|30\nPFUM10|A96|28\nPHA120|A96|28\nPCLM50|K7|30\nPERM00|K7x|26\nPEXM00|K9|30\nPERM10|K9s / K10 活力版|30\nPEYM00|K9 Pro|32\nPGCM10|K9x|26\nPGJM10|K10|32\nPGIM10|K10 Pro|34\nPGGM10|K10x|26',
    vivo: 'V2241H|X90s|42\nV2241A|X90|42\nV2242A|X90 Pro|44\nV2227A|X90 Pro+|46\nV2266A|X Fold2|16\nV2256A|X Flip|38\nV2309A|X100|44\nV2324HA|X100s Pro|46\nV2324A|X100 Pro|46\nV2303A|X Fold3|16\nV2337A|X Fold3 Pro|16\nV2359A|X100s|44\nV2366H|X100 Ultra 卫星版|46\nV2366G|X100 Ultra|46\nV2415A|X200|46\nV2405D|X200 Pro 卫星版|48\nV2405A|X200 Pro|48\nV2419A|X200 Pro mini|44\nV2458A|X200s|46\nV2454D|X200 Ultra 卫星版|48\nV2454A|X200 Ultra|48\nV2436A|X Fold5|16\nV2509A|X300|46\nV2502D|X300 Pro 卫星版|48\nV2502A|X300 Pro|48\nV2548A|X300s|46\nV2547D|X300 Ultra 卫星版|48\nV2547A|X300 Ultra|48\nV2612A|X300 E|44\nV2545A|X Fold6|16\nV2609A|X500|48\nV2608D|X500 Pro eSIM版|50\nV2608A|X500 Pro|50\nV2602D|X500 Pro Max 卫星版|50\nV2602A|X500 Pro Max|50\nV2323A|S18|38\nV2344A|S18 Pro|40\nV2334A|S18e|34\nV2364A|S19|38\nV2362A|S19 Pro|40\nV2429A|S20|38\nV2430A|S20 Pro|40\nV2464A|S30|40\nV2465A|S30 Pro mini|38\nV2528A|S50|40\nV2527A|S50 Pro mini|38\nV2571A|S60|40\nV2572A|S60 元气版|38\nV2620A|S60t|40\nV2243A|iQOO 11|40\nV2254A|iQOO 11 Pro|42\nV2304A|iQOO 11S|42\nV2307A|iQOO 12|42\nV2329A|iQOO 12 Pro|44\nV2408A|iQOO 13|42\nV2505A|iQOO 15|44\nV2546A|iQOO 15 Ultra|46\nV2564A|iQOO 15T|44\nV2606A|iQOO 16|44\nV2301A|iQOO Neo8|38\nV2302A|iQOO Neo8 Pro|40\nV2338A|iQOO Neo9|38\nV2339F|iQOO Neo9S Pro|40\nV2339A|iQOO Neo9 Pro|40\nV2403A|iQOO Neo9S Pro+|42\nV2425A|iQOO Neo10|40\nV2426A|iQOO Neo10 Pro|42\nV2463A|iQOO Neo10 Pro+|42\nV2520A|iQOO Neo11|40\nV2573A|iQOO Neo11 至尊版|42\nV2361G|iQOO Z9 Turbo 长续航 / Y200 GT|30\nV2361A|iQOO Z9|30\nV2352G|iQOO Z9 Turbo 长续航|30\nV2352A|iQOO Z9 Turbo|30\nV2417A|iQOO Z9 Turbo+|30\nV2353D|iQOO Z9x / Y200t|28\nV2353A|iQOO Z9x|28\nV2452G|iQOO Z10 Turbo 长续航 / Y300 GT|30\nV2452A|iQOO Z10 Turbo|30\nV2453A|iQOO Z10 Turbo Pro|32\nV2507A|iQOO Z10 Turbo+|30\nV2445E|iQOO Z10x / Y300t|28\nV2445A|iQOO Z10x|28\nV2536A|iQOO Z11 Turbo|30\nV2551A|iQOO Z11|30\nV2532B|iQOO Z11x / Y6m|28\nV2532A|iQOO Z11x|28\nV2559U|iQOO Z11i|28\nV2559B|Y60m|28\nV2559A|Y60 / Y6t / Y6e|28\nV2603A|iQOO Z11S|30\nV2313A|Y100|28\nV2314D|Y100t / Z8|30\nV2314A|iQOO Z8|30\nV2312B|Y78t / Y100i 长续航|28\nV2312A|iQOO Z8x|28\nV2279A|Y55t / Y100i / Y78|28\nV2354A|Y37 Pro / Y100+|28\nV2357E|Y37m|28\nV2357A|Y37 / Y36c|28\nV2343A|Y200|28\nV2361GA|Y200 GT|30\nV2435A|Y300 / Y300c|28\nV2444A|Y300i|28\nV2410A|Y300 Pro|30\nV2456A|Y300 Pro+|30\nV2506A|Y500|28\nV2516A|Y500 Pro|30\nV2531A|Y500i / Y6|28\nV2617A|Y500k / Y600i|28\nV2607A|Y600|28\nV2561A|Y600 Pro|30\nV2553A|Y600 Turbo|28\nV2443B|Y50m / Y50c|28\nV2443A|Y50 / Y37t|28\nV2442A|Y37c|28\nV2541A|Y6c|28\nV2542A|Y60i / Y6k|28\nV2001A|X50|40\nV2005A|X50 Pro|44\nV2011A|X50 Pro+|46\nV2046A|X60|40\nV2059A|X60 曲屏版|44\nV2085A|X60t|40\nV2047A|X60 Pro|44\nV2120A|X60t Pro|44\nV2056A|X60 Pro+ / X60t Pro+|46\nV2133A|X70|42\nV2132A|X70t|42\nV2134A|X70 Pro|46\nV2145A|X70 Pro+|48\nV2178A|X Fold|16\nV2170A|X Note|44\nV2183A|X80|44\nV2185A|X80 Pro|48\nV2186A|X80 Pro 天玑 9000 版|48\nV2229A|X Fold+|16\nV2020|S7|32\nV2080A|S7t|32\nV2031A|S7e / Y73s|32\nV2031EA|S7e 活力版|30\nV2072A|S9|34\nV2048A|S9e|32\nV2121A|S10 / Pro|34\nV2130A|S10e|30\nV2162A|S12|34\nV2163A|S12 Pro|36\nV2203A|S15|36\nV2207A|S15 Pro|38\nV2190A|S15e|32\nV2244A|S16|36\nV2245A|S16 Pro|38\nV2239A|S16e|32\nV2283A|S17|36\nV2282A|S17t|36\nV2284A|S17 Pro|38\nV2285A|S17e|34\nV2140A|Y10|26\nV2168A|Y10 (t1 版) / Y32t|26\nV2180A|Y10 (t2 版) / Y32t|26\nV2236A|Y11|28\nV2034A|Y30|26\nV2036A|Y30 标准版|26\nV2099A|Y30 2021|26\nV2066A|Y30 活力版|26\nV2066BA|Y30g|26\nV2054A|Y31s / Y31s (t2 版) / Y52s (t1 版)|26\nV2068A|Y31s 标准版 / Y31s (t1 版)|26\nV2158A|Y32|26\nV2166A|Y33s / Y33e / Y52t|26\nV2230A|Y35 / Y35m / Y53t|28\nV2023EA|Y50t|26\nV2002A|Y51s / Y70s / Y70t|26\nV2057A|Y52s|26\nV2111A|Y53s|26\nV2069A|Y53s (t1 版) / Y53s (NFC 版)|26\nV2123A|Y53s (t2 版) / T1x|26\nV2045A|Y54s|26\nV2164A|Y55s / Y72t|26\nV2102A|Y71t|26\nV2164PA|Y73t|26\nV2009A|Y74s|26\nV2069BA|Y75s (2022)|26\nV2156A|Y76s|26\nV2156FA|Y76s (t1 版)|26\nV2219A|Y77|28\nV2166BA|Y77e / Y77e (t1 版)|26\nV2278A|Y77t / Y78 / Y78m|28\nV2271A|Y78+ / Y78+ (t1)|28\nV2115A|T1|28\nV2199GA|T2|28\nV2188A|T2x|28\nV2024A|iQOO 5|36\nV2025A|iQOO 5 Pro|40\nV2049A|iQOO 7|36\nV2136A|iQOO 8|38\nV2141A|iQOO 8 Pro|42\nV2171A|iQOO 9|38\nV2172A|iQOO 9 Pro|42\nV2217A|iQOO 10|38\nV2218A|iQOO 10 Pro|44\nV2055A|iQOO Neo5|34\nV2118A|iQOO Neo5 活力版|30\nV2154A|iQOO Neo5S|34\nV2157A|iQOO Neo5 SE|32\nV2196A|iQOO Neo6|34\nV2199A|iQOO Neo6 SE|32\nV2231A|iQOO Neo7|36\nV2232A|iQOO Neo7 竞速版|36\nV2238A|iQOO Neo7 SE|32\nV2012A|iQOO Z1x|26\nV2073A|iQOO Z3|28\nV2148A|iQOO Z5|28\nV2131A|iQOO Z5x|26\nV2220A|iQOO Z6|28\nV2164KA|iQOO Z6x|26\nV2270A|iQOO Z7|28\nV2272A|iQOO Z7x|26\nV2230EA|iQOO Z7i|24'
  };

  var MODELS = [];
  var PREFIXES = {};
  (function parseModelData() {
    for (var brand in MODEL_DATA) {
      var lines = MODEL_DATA[brand].split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        var f = lines[i].split('|');
        var entry = { p: f[0], b: brand, n: f[1], r: +f[2] };
        MODELS.push(entry);
        if (!PREFIXES[entry.p]) PREFIXES[entry.p] = entry;  // first wins
      }
    }
  })();

  /* Unified brand defaults (older models / unmatched codes). */
  var BRAND_DEFAULTS = {
    samsung: 28, huawei: 40, honor: 36, oppo: 34, vivo: 34,
    xiaomi: 44, redmi: 32, pixel: 18
  };

  /* Generic fallbacks. Desktop displays are square-cornered, so Desktop gets a
     larger design radius instead of a tiny physical one. */
  var DEFAULT_RADIUS = 16;
  var DESKTOP_DEFAULT_RADIUS = 24;

  /* ================= internals ================= */
  function ua() { return (typeof navigator !== 'undefined' && navigator.userAgent) || ''; }

  function isIOS() { return /iPhone|iPod/i.test(ua()); }
  function isAndroid() { return /Android/i.test(ua()); }

  function mqSupported() {
    try {
      return !!(typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(min-radius: 0px)').matches);
    } catch (e) { return false; }
  }

  function radiusByMQ() { /* number | null (unsupported); 0 = square screen */
    try {
      if (!mqSupported()) return null;
      if (!window.matchMedia('(radius)').matches) return 0;
      var lo = 0, hi = 140;
      for (var i = 0; i < 18; i++) {
        var mid = (lo + hi) / 2;
        if (window.matchMedia('(min-radius: ' + mid + 'px)').matches) lo = mid; else hi = mid;
      }
      var KNOWN = [39, 41.5, 44, 47.33, 53.33, 55, 62];
      for (var k = 0; k < KNOWN.length; k++) {
        if (Math.abs(KNOWN[k] - lo) < 1.2) return KNOWN[k];
      }
      return Math.round(lo * 100) / 100;
    } catch (e) { return null; }
  }

  function radiusByIOSSize() {
    if (!isIOS()) return null;
    var w = Math.min(screen.width, screen.height), h = Math.max(screen.width, screen.height);
    var r = IOS_SIZES[w + 'x' + h + '@' + (window.devicePixelRatio || 1)];
    if (r === 44 && !/OS 1[7-9]/.test(ua())) r = 39; // 375x812: iPhone X vs 12/13 mini
    return r !== undefined ? r : null;
  }

  function cssWidth() {
    try { return Math.min(screen.width, screen.height); } catch (e) { return 0; }
  }

  function lookup(model) {
    var m = (model || '').toUpperCase().trim();
    if (!m) return null;
    if (/^PIXEL/i.test(m)) return pixelEntry(m);
    var e;
    for (var len = Math.min(m.length, 14); len >= 4; len--) {
      e = PREFIXES[m.slice(0, len)];
      if (e) return e;
    }
    return null;
  }

  /* Pixels report the marketing name as the model, e.g. "Pixel 9 Pro XL". */
  function pixelEntry(m) {
    var name = m.replace(/^pixel\s*/i, 'Pixel ');
    var legacy = {
      'PIXEL 4': 16, 'PIXEL 4 XL': 16, 'PIXEL 4A': 14, 'PIXEL 4A (5G)': 16,
      'PIXEL 5': 16, 'PIXEL 5A': 16, 'PIXEL 6': 18, 'PIXEL 6A': 18, 'PIXEL 6 PRO': 22
    };
    var key = m.toUpperCase().replace(/\s+/g, ' ');
    if (legacy[key] !== undefined) {
      return { p: '', b: 'pixel', n: name, r: legacy[key] };
    }
    var r = 18;                                   // base / a-series
    if (/fold/i.test(m)) r = 12;                  // inner display
    else if (/pro/i.test(m)) r = 22;
    return { p: '', b: 'pixel', n: name, r: r };
  }

  function brandOfModel(model) {
    var m = (model || '').toUpperCase();
    if (/^PIXEL/i.test(m)) return 'pixel';
    if (/^SM-[A-Z]\d{3}/.test(m)) return 'samsung';
    if (/^V\d{4}/.test(m)) return 'vivo';
    if (/^P[A-Z]{2}\d{3}/.test(m) || /^P[A-Z]{2}[A-Z]\d{2}/.test(m)) return 'oppo';
    if (/^LE\d{4}/.test(m)) return 'oneplus';
    if (/^[A-Z]{3}-(AL|AN)/.test(m)) return 'huawei-or-honor';
    if (/^M2\d{3}/.test(m) || /^2\d{7}/.test(m)) return cssWidth() >= 400 ? 'xiaomi' : 'redmi';
    return '';
  }

  function brandFromBrowser() {
    var u = ua();
    if (/SamsungBrowser/.test(u)) return 'samsung';
    if (/MiuiBrowser|XiaoMi|MIUI/.test(u)) return cssWidth() >= 400 ? 'xiaomi' : 'redmi';
    if (/HuaweiBrowser|HUAWEI/.test(u)) return 'huawei';
    if (/HONOR/i.test(u)) return 'honor';
    if (/HeyTapBrowser|OppoBrowser/.test(u)) return 'oppo';
    if (/VivoBrowser/.test(u)) return 'vivo';
    return '';
  }

  function modelFromUA() {
    var u = ua(), m;
    if ((m = u.match(/(SM-[A-Z0-9]+)/))) return m[1];
    if ((m = u.match(/HUAWEI ([A-Z0-9-]+)/))) return 'HUAWEI ' + m[1];
    if ((m = u.match(/;\s*((?:LE\d{4}|CPH\d{4}|OPD\d{3,4}|V\d{4}[A-Z]{0,2}|M2\d{3}[A-Z0-9]+|2\d{9,}[A-Z]*|[A-Z]{3}-[A-Z0-9]{2,6}))\s+(?:Build|\))/))) return m[1];
    return '';
  }

  function makeResult(o) {
    return {
      radius: o.radius,
      curve: o.curve || 'squircle',   // OEM screens use continuous-curvature corners
      exact: !!o.exact,
      source: o.source,
      platform: o.platform,
      model: o.model || '',
      device: o.device || '',
      brand: o.brand || ''
    };
  }

  function resolve(model, platform) {
    var mq = radiusByMQ();
    if (mq !== null && mq > 0) {
      return makeResult({ radius: mq, exact: true, source: 'media-query',
        platform: platform, model: model, brand: 'apple' });
    }
    if (platform === 'iOS') {
      var est = radiusByIOSSize();
      if (est !== null) {
        return makeResult({ radius: est, source: 'ios-size-table',
          platform: platform, model: model, brand: 'apple' });
      }
    }
    if (platform === 'Android') {
      var hit = lookup(model);
      if (hit) {
        return makeResult({ radius: hit.r, source: 'model-database',
          platform: platform, model: model, device: hit.n, brand: hit.b });
      }
      var brand = brandOfModel(model) || brandFromBrowser();
      if (brand === 'huawei-or-honor') brand = /HONOR/i.test(ua()) ? 'honor' : 'huawei';
      if (brand && BRAND_DEFAULTS[brand] !== undefined) {
        return makeResult({ radius: BRAND_DEFAULTS[brand], source: 'brand-default',
          platform: platform, model: model, brand: brand });
      }
    }
    var fallback = platform === 'Desktop' ? DESKTOP_DEFAULT_RADIUS : DEFAULT_RADIUS;
    return makeResult({ radius: fallback, source: 'default',
      platform: platform, model: model });
  }

  function platformOf() {
    var u = ua();
    if (/iPhone|iPod/.test(u)) return 'iOS';
    if (/iPad/.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPadOS';
    if (/Android/.test(u)) return 'Android';
    return 'Desktop';
  }

  /* ================= public API ================= */
  function detectSync() {
    return resolve(modelFromUA(), platformOf());
  }

  function detect() {
    var platform = platformOf();
    var uaModel = modelFromUA();
    if (typeof navigator !== 'undefined' && navigator.userAgentData &&
        navigator.userAgentData.getHighEntropyValues) {
      return navigator.userAgentData.getHighEntropyValues(['model'])
        .then(function (info) {
          var m = (info && info.model && info.model !== 'K') ? info.model : uaModel;
          return resolve(m, platform);
        })
        .catch(function () { return resolve(uaModel, platform); });
    }
    return Promise.resolve(resolve(uaModel, platform));
  }

  function supportsSquircle() {
    try {
      return !!(typeof window !== 'undefined' && window.CSS &&
        CSS.supports && CSS.supports('corner-shape', 'squircle'));
    } catch (e) { return false; }
  }

  function applyCss() {
    return detect().then(function (res) {
      try {
        var root = document.documentElement;
        root.style.setProperty('--device-radius', res.radius + 'px');
        root.setAttribute('data-corner-curve', res.curve);
      } catch (e) { /* non-DOM environment */ }
      return res;
    });
  }

  return {
    version: '1.1.1',
    detect: detect,
    detectSync: detectSync,
    lookup: function (model) {
      var hit = lookup(model);
      return hit ? makeResult({ radius: hit.r, source: 'model-database',
        platform: 'Android', model: model, device: hit.n, brand: hit.b }) : null;
    },
    radiusMediaQuerySupported: mqSupported,
    supportsSquircle: supportsSquircle,
    applyCss: applyCss,
    IOS_SIZES: IOS_SIZES,
    MODELS: MODELS,
    BRAND_DEFAULTS: BRAND_DEFAULTS,
    DEFAULTS: { generic: DEFAULT_RADIUS, desktop: DESKTOP_DEFAULT_RADIUS }
  };
});
