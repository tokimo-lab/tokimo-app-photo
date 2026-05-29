// i18n shadow guard: do not create ui/src/i18n.ts alongside this directory; Vite/ESM resolves the file first and silently shadows these translations.
import { enUS as uiEnUS, zhCN as uiZhCN } from "@tokimo/ui";
import { useMemo } from "react";
import { useAppCtx } from "../AppContext";

export const zhCN = {
  // App basic
  appName: "Photo",
  title: "照片",
  loading: "加载中…",
  error: "加载失败：",
  empty: "还没有照片，添加一个相册开始使用",
  noLibrary: "未配置照片库",
  addLibrary: "添加照片库",
  sync: "同步",
  syncing: "同步中…",
  settings: "设置",

  // Common actions
  commonCancel: "取消",
  commonCreate: "创建",
  commonDelete: "删除",
  commonSave: "保存",
  commonBack: "返回",
  commonConfirm: "确认",
  commonClose: "关闭",
  commonEdit: "编辑",
  commonRefresh: "刷新",
  commonLoadMore: "加载更多",

  // Navigation tabs
  albums: "相册",
  timeline: "时间线",
  people: "人物",
  places: "地点",
  favorites: "收藏",
  hidden: "已隐藏",
  folders: "文件夹",
  map: "地图",

  // Setup guide
  setupTitle: "开始使用 TokimoPhoto",
  setupDescription: "创建一个图库来管理你的照片与截图",
  setupFeatureImport: "导入照片与截图",
  setupFeatureOrganize: "按相册和时间线智能整理",
  setupFeatureSearch: "快速搜索，回忆精选",
  setupAction: "新建图库",

  // Library types
  libraryTypePhoto: "照片",
  libraryTypeScreenshot: "截图",

  // Library editor
  editorBasicInfo: "基本信息",
  editorLibraryType: "库类型",
  editorSelectType: "请选择类型",
  editorName: "名称",
  editorNameRequired: "请输入图库名称",
  editorNamePlaceholder: "如：我的照片",
  editorDescription: "描述",
  editorDescriptionPlaceholder: "可选描述",
  editorPathConfig: "路径配置",
  editorAiServices: "AI 自动处理",
  editorAiServicesDesc: '控制同步后自动执行的 AI 处理任务，关闭后可在下方"数据管理"中手动触发',
  editorAutoOcr: "自动 OCR 文字识别",
  editorAutoOcrDesc: "同步后自动识别照片中的文字，可用于搜索",
  editorAutoClip: "自动 CLIP 图像识别",
  editorAutoClipDesc: "同步后自动生成图像向量，支持以文搜图",
  editorAutoFace: "自动人脸识别",
  editorAutoFaceDesc: "同步后自动检测和识别照片中的人脸",
  editorAutoGeo: "自动地理位置解析",
  editorAutoGeoDesc: "同步后自动将 EXIF GPS 坐标转为可读地名",
  editorDataManagement: "数据管理",

  // Library CRUD messages
  libraryCreated: "图库已创建",
  libraryCreateFailed: "创建失败",
  librarySaved: "已保存",
  librarySaveFailed: "保存失败",
  libraryDeleted: "图库已删除",
  libraryDeleteFailed: "删除失败",

  // Delete confirmation
  deleteLibraryTitle: "⚠️ 删除图库",
  deleteLibraryMessage: "此操作将永久删除 {name} 及其所有数据，{irreversible}。",
  irreversible: "不可恢复",
  confirmDelete: "确认删除",

  // VFS Browser
  selectDirectory: "选择目录",
  pathRefresh: "刷新",
  pathSelectDirectory: "选择此目录",
  pathEmptyDirectory: "该目录为空",
  pathColName: "名称",
  pathColPermissions: "权限",
  pathColSize: "大小",
  pathColModified: "修改时间",
  pathCannotAccess: "无法访问该目录",

  // Albums view
  albumNew: "新建相册",
  albumNameLabel: "名称",
  albumNamePlaceholder: "输入相册名称",
  albumDescLabel: "描述（可选）",
  albumDescPlaceholder: "描述一下这个相册",
  albumPhotosCount: "{count} 张照片",
  albumEmpty: "相册内暂无照片",
  albumEmptyList: "暂无相册，点击「新建相册」创建",

  // Album picker dialog
  albumPickerTitle: "添加到相册",
  albumPickerDescription: "将 {count} 张照片添加到相册",
  albumPickerEmpty: "暂无相册",
  albumPickerNamePlaceholder: "相册名称",
  albumAddedSuccess: "已添加到相册",

  // Photo mutations
  mutationUpdated: "已更新 {count} 张照片",
  mutationFailed: "操作失败",
  mutationHidden: "已隐藏 {count} 张照片",
  mutationTrashConfirm: "确定要将 {count} 张照片移到回收站吗？",
  mutationTrashed: "已将 {count} 张照片移到回收站",
  mutationRestored: "已恢复 {count} 张照片",
  mutationRestoreFailed: "恢复失败",
  mutationDeleted: "已永久删除 {count} 张照片",
  mutationDeleteFailed: "删除失败",
  mutationDeleteConfirm: "永久删除选中的照片？此操作不可恢复！",

  // Date formatting
  dateToday: "今天",
  dateYesterday: "昨天",
  dateUnknown: "未知日期",
  weekdaySun: "周日",
  weekdayMon: "周一",
  weekdayTue: "周二",
  weekdayWed: "周三",
  weekdayThu: "周四",
  weekdayFri: "周五",
  weekdaySat: "周六",

  // Date header
  dateHeaderSelectAll: "全选 {label}",
  dateHeaderCount: "{count} 张",

  // OCR
  ocrCopyText: "复制文字",
  ocrConfirm: "确认 (Enter)",
  ocrDelete: "删除此识别区域",
  ocrCancel: "取消 (Esc)",
  ocrEdit: "手动编辑",
  ocrEditTitle: "编辑识别文字",

  // OCR Debug
  ocrDebugEmpty: "无调试信息",
  ocrDebugDetectionTitle: "检测模型原始结果",
  ocrDebugDetectionEmpty: "无检测结果",
  ocrDebugVlmTitle: "VLM 模型原始结果",
  ocrDebugVlmEmpty: "无 VLM 结果",
  ocrDebugMergedTitle: "合并结果",
  ocrDebugMergedLabel: "最终输出",
  ocrDebugMergedEmpty: "无合并结果",

  // OCR models
  ocrModelPpv5Server: "PP-OCRv5 Server 检测 + CTC 识别，Contours 旋转文字检测，ONNX Runtime 推理",
  ocrModelPpv5Mobile: "PP-OCRv5 Mobile 轻量模型，轴对齐检测，适合大批量快速扫描，ONNX Runtime 推理",
  ocrModelVlm: "视觉语言模型 (VLM)，端到端 OCR 无需检测步骤，支持复杂排版，需 Python Sidecar + GPU",

  // Settings window
  settingsTitle: "图库设置",
  settingsWindowTitle: "TokimoPhoto 设置",

  // Faces panel
  facesTitle: "人物",
  facesLinkTitle: "关联人物",

  // Map utils
  mapMultipleCities: "{city}等",

  // General UI
  backButton: "← 返回",
  deleteButton: "删除",
  newButton: "新建",

  // Empty states
  emptyDefault: "暂无内容",

  // PhotoSidebar tooltips
  sidebarCreateLibrary: "新建图库",
  sidebarSettings: "图库设置",
  sidebarExpand: "展开侧边栏",
  sidebarCollapse: "收起侧边栏",

  // PhotoMenuBar
  menuView: "显示",
  menuActions: "操作",
  menuSelect: "选择",
  menuDeselect: "取消选择",
  menuRefresh: "刷新",
  menuSyncLibrary: "同步资料库",
  menuSearchPlaceholder: "搜索照片…",
  syncStarted: "同步已开始",
  syncFailed: "同步失败",
  syncModalTitle: "同步资料库",
  syncModalOk: "开始同步",
  syncModalClearData: "清空数据重新同步",
  syncModalHint: "勾选后将删除所有照片数据并重新完整同步，适合修复数据异常或新增字段后重建。",

  // PhotoReprocessTools
  reprocessSectionHint: "清除指定类型的处理结果并重新执行,适用于更换模型或修复数据异常",
  reprocessOcrLabel: "重新识别文字 (OCR)",
  reprocessOcrDesc: "清除所有文字识别结果并重新识别",
  reprocessOcrConfirmTitle: "确认重新识别文字？",
  reprocessOcrConfirmContent: "将删除该图库所有照片的文字识别结果,然后重新执行识别。此操作不可撤销。",
  reprocessOcrSuccess: "文字重新识别已开始",
  reprocessFaceLabel: "重新识别人脸",
  reprocessFaceDesc: "清除所有人脸识别结果并重新识别",
  reprocessFaceConfirmTitle: "确认重新识别人脸？",
  reprocessFaceConfirmContent: "将删除该图库所有照片的人脸识别结果并重新执行识别。已命名的人物会保留,但需要重新关联。此操作不可撤销。",
  reprocessFaceSuccess: "人脸重新识别已开始",
  reprocessClipLabel: "重新识别图像 (CLIP)",
  reprocessClipDesc: "清除所有图像向量并重新生成",
  reprocessClipConfirmTitle: "确认重新识别图像？",
  reprocessClipConfirmContent: "将删除该图库所有照片的图像向量并重新生成。重新生成期间以图搜图功能暂不可用。此操作不可撤销。",
  reprocessClipSuccess: "图像重新识别已开始",
  reprocessGeoLabel: "重新解析地理位置",
  reprocessGeoDesc: "重新解析所有照片的 GPS 坐标为地名",
  reprocessGeoConfirmTitle: "确认重新解析地理位置？",
  reprocessGeoConfirmContent: "将对该图库所有照片重新执行地理位置解析,已有结果会被覆盖。此操作不可撤销。",
  reprocessGeoSuccess: "地理位置重新解析已开始",
  reprocessThumbnailLabel: "重新生成缩略图",
  reprocessThumbnailDesc: "清除所有缩略图缓存,访问时自动重新生成",
  reprocessThumbnailConfirmTitle: "确认重新生成缩略图？",
  reprocessThumbnailConfirmContent: "将删除该图库所有照片的缩略图缓存。缩略图会在下次访问时自动重新生成,期间可能加载较慢。",
  reprocessThumbnailSuccess: "缩略图已清除,访问时将自动重新生成",
  reprocessConfirmOk: "确认执行",
  reprocessExecute: "执行",
  reprocessFailed: "操作失败,请重试",
} as const;

export type PhotoI18nKey = keyof typeof zhCN;
export type PhotoTranslator = (
  key: PhotoI18nKey,
  vars?: Record<string, string | number>,
) => string;

export const enUS = {
  // App basic
  appName: "Photo",
  title: "Photos",
  loading: "Loading…",
  error: "Failed to load: ",
  empty: "No photos yet — add a library to get started",
  noLibrary: "No photo library configured",
  addLibrary: "Add Library",
  sync: "Sync",
  syncing: "Syncing…",
  settings: "Settings",

  // Common actions
  commonCancel: "Cancel",
  commonCreate: "Create",
  commonDelete: "Delete",
  commonSave: "Save",
  commonBack: "Back",
  commonConfirm: "Confirm",
  commonClose: "Close",
  commonEdit: "Edit",
  commonRefresh: "Refresh",
  commonLoadMore: "Load More",

  // Navigation tabs
  albums: "Albums",
  timeline: "Timeline",
  people: "People",
  places: "Places",
  favorites: "Favorites",
  hidden: "Hidden",
  folders: "Folders",
  map: "Map",

  // Setup guide
  setupTitle: "Get Started with TokimoPhoto",
  setupDescription: "Create a library to manage your photos and screenshots",
  setupFeatureImport: "Import photos and screenshots",
  setupFeatureOrganize: "Organize by album and timeline",
  setupFeatureSearch: "Quick search, curated memories",
  setupAction: "New Photo Library",

  // Library types
  libraryTypePhoto: "Photo",
  libraryTypeScreenshot: "Screenshot",

  // Library editor
  editorBasicInfo: "Basic Information",
  editorLibraryType: "Library Type",
  editorSelectType: "Select a type",
  editorName: "Name",
  editorNameRequired: "Enter a library name",
  editorNamePlaceholder: "e.g. My Photos",
  editorDescription: "Description",
  editorDescriptionPlaceholder: "Optional description",
  editorPathConfig: "Path Configuration",
  editorAiServices: "AI Auto Processing",
  editorAiServicesDesc: "Control AI tasks that run automatically after sync; disable to trigger manually in 'Data Management' below",
  editorAutoOcr: "Auto OCR Text Recognition",
  editorAutoOcrDesc: "Automatically recognize text in photos after sync, for search",
  editorAutoClip: "Auto CLIP Image Recognition",
  editorAutoClipDesc: "Automatically generate image vectors after sync, for image search",
  editorAutoFace: "Auto Face Recognition",
  editorAutoFaceDesc: "Automatically detect and recognize faces in photos after sync",
  editorAutoGeo: "Auto Geo Location Parsing",
  editorAutoGeoDesc: "Automatically convert EXIF GPS coordinates to readable place names after sync",
  editorDataManagement: "Data Management",

  // Library CRUD messages
  libraryCreated: "Library created",
  libraryCreateFailed: "Create failed",
  librarySaved: "Saved",
  librarySaveFailed: "Save failed",
  libraryDeleted: "Library deleted",
  libraryDeleteFailed: "Delete failed",

  // Delete confirmation
  deleteLibraryTitle: "⚠️ Delete Library",
  deleteLibraryMessage: "This will permanently delete {name} and all of its data. {irreversible}.",
  irreversible: "This cannot be undone",
  confirmDelete: "Confirm Delete",

  // VFS Browser
  selectDirectory: "Select Directory",
  pathRefresh: "Refresh",
  pathSelectDirectory: "Select This Directory",
  pathEmptyDirectory: "This directory is empty",
  pathColName: "Name",
  pathColPermissions: "Permissions",
  pathColSize: "Size",
  pathColModified: "Modified",
  pathCannotAccess: "Cannot access this directory",

  // Albums view
  albumNew: "New Album",
  albumNameLabel: "Name",
  albumNamePlaceholder: "Enter album name",
  albumDescLabel: "Description (optional)",
  albumDescPlaceholder: "Describe this album",
  albumPhotosCount: "{count} photos",
  albumEmpty: "No photos in this album",
  albumEmptyList: "No albums yet, click \"New Album\" to create one",

  // Album picker dialog
  albumPickerTitle: "Add to Album",
  albumPickerDescription: "Add {count} photos to album",
  albumPickerEmpty: "No albums yet",
  albumPickerNamePlaceholder: "Album name",
  albumAddedSuccess: "Added to album",

  // Photo mutations
  mutationUpdated: "Updated {count} photos",
  mutationFailed: "Operation failed",
  mutationHidden: "Hidden {count} photos",
  mutationTrashConfirm: "Move {count} photos to trash?",
  mutationTrashed: "Moved {count} photos to trash",
  mutationRestored: "Restored {count} photos",
  mutationRestoreFailed: "Restore failed",
  mutationDeleted: "Permanently deleted {count} photos",
  mutationDeleteFailed: "Delete failed",
  mutationDeleteConfirm: "Permanently delete selected photos? This cannot be undone!",

  // Date formatting
  dateToday: "Today",
  dateYesterday: "Yesterday",
  dateUnknown: "Unknown date",
  weekdaySun: "Sun",
  weekdayMon: "Mon",
  weekdayTue: "Tue",
  weekdayWed: "Wed",
  weekdayThu: "Thu",
  weekdayFri: "Fri",
  weekdaySat: "Sat",

  // Date header
  dateHeaderSelectAll: "Select all {label}",
  dateHeaderCount: "{count} photos",

  // OCR
  ocrCopyText: "Copy text",
  ocrConfirm: "Confirm (Enter)",
  ocrDelete: "Delete this recognition area",
  ocrCancel: "Cancel (Esc)",
  ocrEdit: "Manual edit",
  ocrEditTitle: "Edit recognized text",

  // OCR Debug
  ocrDebugEmpty: "No debug info",
  ocrDebugDetectionTitle: "Detection model raw results",
  ocrDebugDetectionEmpty: "No detection results",
  ocrDebugVlmTitle: "VLM model raw results",
  ocrDebugVlmEmpty: "No VLM results",
  ocrDebugMergedTitle: "Merged results",
  ocrDebugMergedLabel: "Final output",
  ocrDebugMergedEmpty: "No merged results",

  // OCR models
  ocrModelPpv5Server: "PP-OCRv5 Server detection + CTC recognition, Contours rotated text detection, ONNX Runtime inference",
  ocrModelPpv5Mobile: "PP-OCRv5 Mobile lightweight model, axis-aligned detection, suitable for batch scanning, ONNX Runtime inference",
  ocrModelVlm: "Vision Language Model (VLM), end-to-end OCR without detection, supports complex layouts, requires Python Sidecar + GPU",

  // Settings window
  settingsTitle: "Library Settings",
  settingsWindowTitle: "TokimoPhoto Settings",

  // Faces panel
  facesTitle: "People",
  facesLinkTitle: "Link Person",

  // Map utils
  mapMultipleCities: "{city} etc.",

  // General UI
  backButton: "← Back",
  deleteButton: "Delete",
  newButton: "New",

  // Empty states
  emptyDefault: "No content",

  // PhotoSidebar tooltips
  sidebarCreateLibrary: "New Library",
  sidebarSettings: "Library Settings",
  sidebarExpand: "Expand Sidebar",
  sidebarCollapse: "Collapse Sidebar",

  // PhotoMenuBar
  menuView: "View",
  menuActions: "Actions",
  menuSelect: "Select",
  menuDeselect: "Deselect",
  menuRefresh: "Refresh",
  menuSyncLibrary: "Sync Library",
  menuSearchPlaceholder: "Search photos…",
  syncStarted: "Sync started",
  syncFailed: "Sync failed",
  syncModalTitle: "Sync Library",
  syncModalOk: "Start Sync",
  syncModalClearData: "Clear data and resync",
  syncModalHint: "This will delete all photo data and perform a full resync, useful for fixing data issues or rebuilding after schema changes.",

  // PhotoReprocessTools
  reprocessSectionHint: "Clear specific processing results and re-execute, useful for model changes or fixing data issues",
  reprocessOcrLabel: "Re-recognize Text (OCR)",
  reprocessOcrDesc: "Clear all text recognition results and re-recognize",
  reprocessOcrConfirmTitle: "Confirm re-recognize text?",
  reprocessOcrConfirmContent: "This will delete all text recognition results for this library and re-execute recognition. This cannot be undone.",
  reprocessOcrSuccess: "Text re-recognition started",
  reprocessFaceLabel: "Re-recognize Faces",
  reprocessFaceDesc: "Clear all face recognition results and re-recognize",
  reprocessFaceConfirmTitle: "Confirm re-recognize faces?",
  reprocessFaceConfirmContent: "This will delete all face recognition results for this library and re-execute recognition. Named people will be preserved but need re-association. This cannot be undone.",
  reprocessFaceSuccess: "Face re-recognition started",
  reprocessClipLabel: "Re-recognize Images (CLIP)",
  reprocessClipDesc: "Clear all image vectors and regenerate",
  reprocessClipConfirmTitle: "Confirm re-recognize images?",
  reprocessClipConfirmContent: "This will delete all image vectors for this library and regenerate them. Image search will be unavailable during regeneration. This cannot be undone.",
  reprocessClipSuccess: "Image re-recognition started",
  reprocessGeoLabel: "Re-parse Geo Locations",
  reprocessGeoDesc: "Re-parse all GPS coordinates to place names",
  reprocessGeoConfirmTitle: "Confirm re-parse geo locations?",
  reprocessGeoConfirmContent: "This will re-execute geo location parsing for all photos in this library, overwriting existing results. This cannot be undone.",
  reprocessGeoSuccess: "Geo location re-parsing started",
  reprocessThumbnailLabel: "Regenerate Thumbnails",
  reprocessThumbnailDesc: "Clear all thumbnail cache, auto-regenerate on access",
  reprocessThumbnailConfirmTitle: "Confirm regenerate thumbnails?",
  reprocessThumbnailConfirmContent: "This will delete all thumbnail cache for this library. Thumbnails will be auto-regenerated on next access, which may slow loading.",
  reprocessThumbnailSuccess: "Thumbnails cleared, will auto-regenerate on access",
  reprocessConfirmOk: "Confirm Execute",
  reprocessExecute: "Execute",
  reprocessFailed: "Operation failed, please retry",
} satisfies Record<PhotoI18nKey, string>;

export function isZhLocale(locale: string | undefined): boolean {
  return locale?.toLowerCase().startsWith("zh") ?? false;
}

function formatTemplate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function getPhotoI18n(locale: string | undefined): {
  t: PhotoTranslator;
  uiLocale: typeof uiZhCN;
} {
  const dict = isZhLocale(locale) ? zhCN : enUS;
  return {
    t: (key, vars) => formatTemplate(dict[key], vars),
    uiLocale: isZhLocale(locale) ? uiZhCN : uiEnUS,
  };
}

export function usePhotoI18n(): {
  locale: string;
  t: PhotoTranslator;
  uiLocale: typeof uiZhCN;
} {
  const ctx = useAppCtx();
  return useMemo(
    () => ({ locale: ctx.locale, ...getPhotoI18n(ctx.locale) }),
    [ctx.locale],
  );
}
