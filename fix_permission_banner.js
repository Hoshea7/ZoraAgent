const fs = require('fs');
const path = require('path');

const bannerPath = path.join(__dirname, 'src/renderer/components/chat/PermissionBanner.tsx');
let content = fs.readFileSync(bannerPath, 'utf8');

// The issue: "我的请求权限的卡片这里的整体的风格...现在整个感觉它特别的空，然后就显得很大...它弹出来的时候呢，它相当于是浮出来的...应该在底部嘛，那他应该是顶出来，就相当于会把上面我最底的消息也顶出来。这样的话，我用户可以看到我最底的这个消息之上不会被这个权限的卡片遮盖住"

// First, fix the design of PermissionBanner.tsx
// It has a lot of padding, large margins, gradients and shadow.
// Let's make it compact and minimal, blending smoothly into the Chat flow.
content = content.replace(
  `mx-4 mb-3 overflow-hidden rounded-2xl border border-stone-200/60 bg-white/95 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl ring-1 ring-black/[0.03] transition-all duration-300`,
  `mb-3 overflow-hidden rounded-2xl border border-orange-200/60 bg-orange-50/30 transition-all duration-300`
);

// Remove the top orange gradient bar
content = content.replace(
  `{/* 顶部指示条 */}
      <div className="h-1 w-full bg-gradient-to-r from-orange-400 to-amber-400" />`,
  ``
);

// Reduce padding
content = content.replace(
  `p-4 sm:p-5`,
  `p-3 sm:px-4 sm:py-3.5`
);

// Make the layout flex-row for title and content, to make it even more compact
content = content.replace(
  `        {/* 标题行 */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100/50">
              <ShieldAlert />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold tracking-tight text-stone-800">请求权限</h3>
                {remaining > 0 && (
                  <span className="flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                    + {remaining} more
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] font-medium text-stone-500">
                {formattedToolName}
              </p>
            </div>
          </div>
        </div>

        {/* 操作描述区 */}
        <div className="mb-5 space-y-3">
          <p className="text-[13.5px] leading-relaxed text-stone-600">{displayDesc}</p>

          {displayCommand && (
            <div className="group relative rounded-xl border border-stone-100 bg-stone-50/50 p-3 transition-colors hover:bg-stone-50">
              <div className="mb-1.5 flex items-center gap-1.5">
                <div className="text-stone-400"><Code2 /></div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Command</span>
              </div>
              <pre className="max-h-32 overflow-x-auto overflow-y-auto text-[12.5px] font-mono leading-relaxed text-stone-700 whitespace-pre-wrap word-break-all">
                {displayCommand}
              </pre>
            </div>
          )}
        </div>`,
  `        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-100/60 text-orange-600">
            <ShieldAlert />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[13px] font-semibold text-stone-800">需要 {formattedToolName} 执行权限</h3>
              {remaining > 0 && (
                <span className="rounded bg-stone-200/50 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                  + {remaining}
                </span>
              )}
            </div>
            
            {/* 操作描述区 */}
            <div className="space-y-2 mb-3">
              <p className="text-[13px] text-stone-600 leading-snug">{displayDesc}</p>

              {displayCommand && (
                <div className="rounded-lg border border-stone-200/50 bg-white/60 p-2.5">
                  <pre className="max-h-24 overflow-x-auto overflow-y-auto text-[12px] font-mono leading-relaxed text-stone-700 whitespace-pre-wrap word-break-all">
                    {displayCommand}
                  </pre>
                </div>
              )}
            </div>`
);

// Reduce button size and margin
content = content.replace(
  `        {/* 拒绝理由区域（点击展开） */}
        <div className={\`overflow-hidden transition-all duration-300 ease-in-out \${showFeedback ? 'mb-4 max-h-40 opacity-100' : 'max-h-0 opacity-0'}\`}>`,
  `        {/* 拒绝理由区域（点击展开） */}
        <div className={\`overflow-hidden transition-all duration-300 ease-in-out \${showFeedback ? 'mb-3 max-h-40 opacity-100' : 'max-h-0 opacity-0'}\`}>`
);

content = content.replace(
  `        {/* 按钮行 */}
        {!showFeedback && (
          <div className="flex flex-wrap items-center justify-between border-t border-stone-100 pt-4 gap-y-2">`,
  `        {/* 按钮行 */}
        {!showFeedback && (
          <div className="flex flex-wrap items-center justify-between gap-y-2">`
);

content = content.replace(
  `            <button
              onClick={() => setShowFeedback(true)}
              className="group flex items-center gap-1.5 text-[12.5px] font-medium text-stone-500 transition-colors hover:text-stone-800"
            >
              <span>拒绝并说明原因</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">...</span>
            </button>`,
  `            <button
              onClick={() => setShowFeedback(true)}
              className="text-[12px] font-medium text-stone-400 transition-colors hover:text-stone-700"
            >
              提供拒绝理由...
            </button>`
);

content = content.replace(
  `            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDeny()}
                className="flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 sm:px-4 py-2 text-[13px] font-semibold text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 active:scale-95"
              >`,
  `            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleDeny()}
                className="flex items-center gap-1 rounded-lg bg-stone-200/50 px-3 py-1.5 text-[12px] font-medium text-stone-700 transition-colors hover:bg-stone-200 hover:text-stone-900 active:scale-95"
              >`
);

content = content.replace(
  `              <button
                onClick={() => handleAllow()}
                className="flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 sm:px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-orange-600 hover:shadow active:scale-95"
              >`,
  `              <button
                onClick={() => handleAllow()}
                className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-orange-600 hover:shadow active:scale-95"
              >`
);

content = content.replace(
  `              <div className="h-4 w-px bg-stone-200 mx-1" />
              <button
                onClick={() => handleAllow(true)}
                className="rounded-xl px-2 sm:px-3 py-2 text-[12px] font-semibold text-orange-600 transition-colors hover:bg-orange-50 active:scale-95 whitespace-nowrap"
              >
                始终允许
              </button>`,
  `              <div className="h-3 w-px bg-stone-200 mx-0.5" />
              <button
                onClick={() => handleAllow(true)}
                className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-orange-600 transition-colors hover:bg-orange-100/50 active:scale-95 whitespace-nowrap"
              >
                始终允许
              </button>`
);

// Close the flex container we opened
content = content.replace(
  `        )}
      </div>
    </div>
  );
}`,
  `        )}
          </div>
        </div>
      </div>
    </div>
  );
}`
);


fs.writeFileSync(bannerPath, content, 'utf8');
console.log('PermissionBanner redesigned.');
