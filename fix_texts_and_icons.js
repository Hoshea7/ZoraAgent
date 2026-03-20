const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/components/settings/SkillManagerPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Update 1: Change group titles
content = content.replace(
  `title="全部已安装技能"`,
  `title="已安装技能"`
);

content = content.replace(
  `title="展开未导入的新技能"`,
  `title="未导入的新技能"`
);

content = content.replace(
  `title="展开已在本地的重复技能"`,
  `title="已在本地的重复技能"`
);

// Update 2: Change "Open Dir" and "Uninstall" to icon buttons
content = content.replace(
`        <div className="flex shrink-0 items-center gap-3">
          {!isEnabled && (
             <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
               已停用
             </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-[12px]"
            onClick={(e) => { e.stopPropagation(); onOpenDir(skill.dirName); }}
          >
            打开目录
          </Button>
          
          {confirming ? (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <Button
                variant="primary"
                size="sm"
                className="h-7 text-[12px] bg-rose-500 hover:bg-rose-600 border-rose-500 text-white shadow-none"
                disabled={uninstalling}
                onClick={(e) => { e.stopPropagation(); onUninstall(skill.dirName); setConfirming(false); }}
              >
                确认
              </Button>
              <button onClick={() => setConfirming(false)} className="text-stone-400 hover:text-stone-700 ml-1"><CloseIcon className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-[12px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-stone-200"
              disabled={uninstalling}
              onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            >
              {uninstalling ? "卸载中" : "卸载"}
            </Button>
          )}
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>`,
`        <div className="flex shrink-0 items-center gap-2">
          {!isEnabled && (
             <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 mr-2">
               已停用
             </span>
          )}
          
          <button
            title="打开技能目录"
            onClick={(e) => { e.stopPropagation(); onOpenDir(skill.dirName); }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <FolderIcon className="h-4 w-4" />
          </button>
          
          {confirming ? (
            <div className="flex items-center gap-1.5 ml-1" onClick={e => e.stopPropagation()}>
              <Button
                variant="primary"
                size="sm"
                className="h-7 px-2 text-[12px] bg-rose-500 hover:bg-rose-600 border-rose-500 text-white shadow-none"
                disabled={uninstalling}
                onClick={(e) => { e.stopPropagation(); onUninstall(skill.dirName); setConfirming(false); }}
              >
                确认
              </Button>
              <button onClick={() => setConfirming(false)} className="text-stone-400 hover:text-stone-700"><CloseIcon className="h-4 w-4" /></button>
            </div>
          ) : (
            <button
              title={uninstalling ? "卸载中..." : "卸载技能"}
              disabled={uninstalling}
              onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          
          <div className="w-px h-4 bg-stone-200 mx-1"></div>
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>`
);

// Update 3: Change "Import" to icon buttons in DiscoverTab
content = content.replace(
`        <div className="flex shrink-0 items-center gap-3">
          {isImported ? (
            <div className="flex items-center gap-1 text-stone-400 text-[12px]">
              <CheckIcon className="h-3.5 w-3.5" /> 已导入
            </div>
          ) : showMethodPicker ? (
             <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
               <Button size="sm" variant="secondary" className="h-7 text-[12px]" disabled={importing} onClick={() => { onImport(skill, "symlink"); setShowMethodPicker(false); }}>软链接导入</Button>
               <Button size="sm" variant="secondary" className="h-7 text-[12px]" disabled={importing} onClick={() => { onImport(skill, "copy"); setShowMethodPicker(false); }}>复制导入</Button>
               <button onClick={() => setShowMethodPicker(false)} className="text-stone-400 hover:text-stone-700 ml-1"><CloseIcon className="h-3.5 w-3.5" /></button>
             </div>
          ) : (
            <Button size="sm" variant="secondary" className="h-7 text-[12px]" disabled={importing} onClick={(e) => { e.stopPropagation(); setShowMethodPicker(true); }}>
              {importing ? "导入中" : "导入"}
            </Button>
          )}
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>`,
`        <div className="flex shrink-0 items-center gap-2">
          {isImported ? (
            <div className="flex items-center gap-1 text-stone-400 text-[12px] mr-2">
              <CheckIcon className="h-3.5 w-3.5" /> 已导入
            </div>
          ) : showMethodPicker ? (
             <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
               <Button size="sm" variant="secondary" className="h-7 px-2 text-[12px]" disabled={importing} onClick={() => { onImport(skill, "symlink"); setShowMethodPicker(false); }} title="保持与源文件同步">软链接</Button>
               <Button size="sm" variant="secondary" className="h-7 px-2 text-[12px]" disabled={importing} onClick={() => { onImport(skill, "copy"); setShowMethodPicker(false); }} title="作为独立副本">复制</Button>
               <button onClick={() => setShowMethodPicker(false)} className="text-stone-400 hover:text-stone-700 ml-1"><CloseIcon className="h-4 w-4" /></button>
             </div>
          ) : (
            <button
              title={importing ? "导入中..." : "导入技能"}
              disabled={importing}
              onClick={(e) => { e.stopPropagation(); setShowMethodPicker(true); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
          <div className="w-px h-4 bg-stone-200 mx-1"></div>
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('SkillManagerPanel updated.');
