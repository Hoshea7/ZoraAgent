const fs = require('fs');

const path = 'src/renderer/components/chat/AttachmentPreview.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldImageNode = `        if (attachment.category === "image" && attachment.base64Data) {
          return (
            <div
              key={attachment.id}
              className="group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 shadow-sm transition-colors hover:border-stone-300"
              title={attachment.name}
            >
              <img
                src={\`data:\${attachment.mimeType};base64,\${attachment.base64Data}\`}
                alt={attachment.name}
                className="h-full w-full rounded-xl object-cover"
              />
              <RemoveButton
                attachmentName={attachment.name}
                onClick={() => onRemove(attachment.id)}
              />
            </div>
          );
        }`;

const newImageNode = `        if (attachment.category === "image" && attachment.base64Data) {
          return (
            <div
              key={attachment.id}
              className="group relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-50 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-stone-300 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] overflow-hidden"
              title={attachment.name}
            >
              <img
                src={\`data:\${attachment.mimeType};base64,\${attachment.base64Data}\`}
                alt={attachment.name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/5" />
              <RemoveButton
                attachmentName={attachment.name}
                onClick={() => onRemove(attachment.id)}
              />
            </div>
          );
        }`;

const oldDocNode = `        return (
          <div
            key={attachment.id}
            className="group relative flex h-14 max-w-[180px] shrink-0 items-center gap-2.5 rounded-xl border border-stone-200 bg-stone-50 pl-2 pr-3 shadow-sm transition-colors hover:border-stone-300"
            title={attachment.name}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-stone-500 shadow-sm">
              {attachment.category === "document" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M9 13h6M9 17h4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M9 13h6M9 17h6M9 9h1" />
                </svg>
              )}
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <div className="truncate text-[13px] font-medium leading-tight text-stone-700">
                {truncateFileName(attachment.name, 18)}
              </div>
              <div className="mt-0.5 truncate text-[11px] leading-tight text-stone-400">
                {formatFileSize(attachment.size)}
              </div>
            </div>

            <RemoveButton
              attachmentName={attachment.name}
              onClick={() => onRemove(attachment.id)}
            />
          </div>
        );`;

const newDocNode = `        return (
          <div
            key={attachment.id}
            className="group relative flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-stone-200/80 bg-stone-50 p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-stone-300 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]"
            title={attachment.name}
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-stone-500 shadow-sm ring-1 ring-inset ring-stone-100 transition-colors group-hover:text-stone-700">
              {attachment.category === "document" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M9 13h6M9 17h4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M9 13h6M9 17h6M9 9h1" />
                </svg>
              )}
            </div>

            <div className="flex w-full min-w-0 flex-col items-center justify-center px-0.5">
              <div className="w-full text-center truncate text-[10px] font-medium leading-tight text-stone-700">
                {truncateFileName(attachment.name, 9)}
              </div>
              <div className="w-full text-center mt-0.5 truncate text-[9px] leading-tight text-stone-400">
                {formatFileSize(attachment.size)}
              </div>
            </div>

            <RemoveButton
              attachmentName={attachment.name}
              onClick={() => onRemove(attachment.id)}
            />
          </div>
        );`;

const oldRemoveButton = `    <button
      type="button"
      onClick={onClick}
      aria-label={\`移除附件 \${attachmentName}\`}
      className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-stone-200/90 text-stone-600 opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-stone-300 hover:text-stone-800 group-hover:opacity-100 dark:bg-stone-700/90 dark:text-stone-300 dark:hover:bg-stone-600 dark:hover:text-stone-100"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-2.5 w-2.5">
        <path d="M4 4l8 8M12 4 4 12" />
      </svg>
    </button>`;

const newRemoveButton = `    <button
      type="button"
      onClick={onClick}
      aria-label={\`移除附件 \${attachmentName}\`}
      className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 opacity-0 shadow-sm transition-all duration-200 hover:border-stone-300 hover:bg-stone-100 hover:text-stone-700 hover:scale-105 active:scale-95 group-hover:opacity-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
        <path d="M4 4l8 8M12 4 4 12" />
      </svg>
    </button>`;

content = content.replace(oldImageNode, newImageNode);
content = content.replace(oldDocNode, newDocNode);
content = content.replace(oldRemoveButton, newRemoveButton);

// Update gap
content = content.replace('gap-3 px-1 pb-2 pt-1', 'gap-3 px-2 pb-3 pt-2');

fs.writeFileSync(path, content, 'utf8');
