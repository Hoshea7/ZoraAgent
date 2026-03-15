const fs = require('fs');
const path = 'src/renderer/components/chat/AttachmentPreview.tsx';
let content = fs.readFileSync(path, 'utf8');

// The new design references:
// - A rounded rectangular container with a very light gray background (#f3f3f3 or similar)
// - Left: A small square thumbnail (for image) or an icon (for document), with rounded corners.
// - Right: Column with file name on top, "Image" or "Document • size" below.
// - Remove button stays similar but maybe adjusting layout.

const oldMapBody = `      {attachments.map((attachment) => {
        if (attachment.category === "image" && attachment.base64Data) {
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
        }

        return (
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
        );
      })}`;

const newMapBody = `      {attachments.map((attachment) => {
        const isImage = attachment.category === "image" && attachment.base64Data;
        const FileIcon = attachment.category === "document" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v5h5" />
            <path d="M9 13h6M9 17h4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v5h5" />
            <path d="M9 13h6M9 17h6M9 9h1" />
          </svg>
        );

        return (
          <div
            key={attachment.id}
            className="group relative flex h-14 max-w-[200px] shrink-0 items-center gap-3 rounded-[14px] bg-stone-100/80 p-1.5 pr-4 transition-colors hover:bg-stone-200/60"
            title={attachment.name}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white shadow-sm ring-1 ring-inset ring-stone-200/50">
              {isImage ? (
                <img
                  src={\`data:\${attachment.mimeType};base64,\${attachment.base64Data}\`}
                  alt={attachment.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="text-stone-400">
                  {FileIcon}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <div className="truncate text-[13px] font-medium leading-tight text-stone-700">
                {truncateFileName(attachment.name, 15)}
              </div>
              <div className="mt-[3px] truncate text-[11px] leading-tight text-stone-500">
                {isImage ? 'Image' : 'Document'} • {formatFileSize(attachment.size)}
              </div>
            </div>

            <RemoveButton
              attachmentName={attachment.name}
              onClick={() => onRemove(attachment.id)}
            />
          </div>
        );
      })}`;

content = content.replace(oldMapBody, newMapBody);
fs.writeFileSync(path, content, 'utf8');
