const fs = require('fs');

const path = 'src/renderer/components/chat/ChatInput.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace the dropNotice inline rendering
content = content.replace(
  /        \{dropNotice \? \(\n          <div className="mx-1 mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-\[12px\] leading-relaxed text-amber-800">\n            \{dropNotice\}\n          <\/div>\n        \) : null\}/,
  ""
);

// We need to render the dropNotice as a toast along with the other toast
const toastSection = `<div 
        className={\`absolute -top-12 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-3 py-1.5 rounded-md shadow-lg transition-all duration-300 pointer-events-none z-50 \${
          showToast ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-2'
        }\`}
      >
        先停止对话才能发送消息
      </div>`;

const newToastSection = `<div className="absolute -top-14 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none z-50">
        <div 
          className={\`bg-stone-800 text-white text-xs px-3 py-1.5 rounded-md shadow-lg transition-all duration-300 \${
            showToast ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-2 hidden'
          }\`}
        >
          先停止对话才能发送消息
        </div>
        <div 
          className={\`bg-amber-100 text-amber-800 border border-amber-200 text-xs px-4 py-2 rounded-lg shadow-lg max-w-[90%] text-center transition-all duration-300 \${
            dropNotice ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-2 hidden'
          }\`}
        >
          {dropNotice}
        </div>
      </div>`;

content = content.replace(toastSection, newToastSection);

fs.writeFileSync(path, content, 'utf8');
