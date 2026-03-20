const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/layout/LeftSidebar.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// The issue: "会话" font size and the hidden "+" button next to it.
// Original: 
// <h2 className="text-[12px] font-medium tracking-[0.01em] text-stone-500">
//   会话
// </h2>
// <button ... className="rounded-lg p-1.5 text-stone-400 opacity-0 transition group-hover:opacity-100 ..." ...

// Update:
content = content.replace(
`              <div className="group flex items-center justify-between px-4 pb-2.5 pt-2">
                <h2 className="text-[12px] font-medium tracking-[0.01em] text-stone-500">
                  会话
                </h2>
                <button
                  onClick={handleNewChat}
                  className={cn(
                    "rounded-lg p-1.5 text-stone-400 opacity-0",
                    "transition group-hover:opacity-100 hover:bg-stone-900/[0.05] hover:text-stone-900",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                  )}
                  title="新建会话"
                >`,
`              <div className="group flex items-center justify-between px-4 pb-2.5 pt-2">
                <h2 className="text-[14px] font-medium tracking-[0.01em] text-stone-700">
                  会话
                </h2>
                <button
                  onClick={handleNewChat}
                  className={cn(
                    "rounded-lg p-1.5 text-stone-400 transition-colors",
                    "hover:bg-stone-200/50 hover:text-stone-900",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                  )}
                  title="新建会话"
                >`
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Sidebar UI fixed.');
