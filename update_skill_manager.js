const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/components/settings/SkillManagerPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Update 1: Change InstalledSkillCard to show buttons directly
content = content.replace(
`        <div className="flex shrink-0 items-center gap-2">
          {!isEnabled && (
             <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
               已停用
             </span>
          )}
          <ChevronIcon className="h-4 w-4 text-stone-400" expanded={expanded} />
        </div>
      </div>

      {expanded && (
        <div className="bg-[#F9FAFB] border-t border-stone-100 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-stone-600 mb-4 whitespace-pre-wrap">
            {skill.description || "该技能未提供详细描述。"}
          </p>
          
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onOpenDir(skill.dirName); }}
            >
              <FolderIcon className="h-3.5 w-3.5 mr-1.5" /> 打开目录
            </Button>
            
            {confirming ? (
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  variant="primary"
                  size="sm"
                  className="bg-rose-500 hover:bg-rose-600 border-rose-500 text-white shadow-none"
                  disabled={uninstalling}
                  onClick={(e) => { e.stopPropagation(); onUninstall(skill.dirName); setConfirming(false); }}
                >
                  确认卸载
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={uninstalling}
                  onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-stone-200"
                disabled={uninstalling}
                onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
              >
                {uninstalling ? "卸载中..." : "卸载技能"}
              </Button>
            )}
          </div>
        </div>
      )}`,
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
        </div>
      </div>

      {expanded && (
        <div className="bg-[#F9FAFB] border-t border-stone-100 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-stone-600 whitespace-pre-wrap">
            {skill.description || "该技能未提供详细描述。"}
          </p>
        </div>
      )}`
);

// Update 2: Expand new skills by default in DiscoverTab
content = content.replace(
`            {newSkills.length > 0 ? (
              <div className="space-y-2">
                {newSkills.map(({ skill, toolName }) => (
                  <DiscoverSkillCard
                    key={importKeyFor(skill)}
                    skill={skill}
                    toolName={toolName}
                    importing={importingSet.has(importKeyFor(skill))}
                    onImport={onImport}
                  />
                ))}
              </div>
            ) : searchQuery ? (`,
`            {newSkills.length > 0 ? (
              <SkillGroup title="展开未导入的新技能" count={newSkills.length} defaultExpanded={true}>
                <div className="space-y-2">
                  {newSkills.map(({ skill, toolName }) => (
                    <DiscoverSkillCard
                      key={importKeyFor(skill)}
                      skill={skill}
                      toolName={toolName}
                      importing={importingSet.has(importKeyFor(skill))}
                      onImport={onImport}
                    />
                  ))}
                </div>
              </SkillGroup>
            ) : searchQuery ? (`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Update script completed.');
