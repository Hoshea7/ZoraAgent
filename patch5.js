const fs = require('fs');
const path = 'src/renderer/components/chat/MessageItem.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace "flex flex-wrap justify-end gap-2 mb-1.5" with "flex flex-wrap justify-end gap-2"
content = content.replace(
  'className="flex flex-wrap justify-end gap-2 mb-1.5"',
  'className="flex flex-wrap justify-end gap-2"'
);

// Replace "gap-1" in user message wrapper with "gap-2"
content = content.replace(
  '<article className="ml-auto mt-6 flex max-w-[85%] flex-col items-end gap-1">',
  '<article className="ml-auto mt-6 flex max-w-[85%] flex-col items-end gap-2">'
);

fs.writeFileSync(path, content, 'utf8');
