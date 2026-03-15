const fs = require('fs');
const path = 'src/renderer/components/chat/AttachmentPreview.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldMapBody = `        return (
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
        );`;

const newMapBody = `        return (
          <div
            key={attachment.id}
            className="group relative flex h-14 max-w-[200px] shrink-0 items-center gap-2.5 rounded-2xl bg-[#F5F5F5] p-1.5 pr-3.5 transition-colors hover:bg-[#EAEAEA]"
            title={attachment.name}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-inset ring-black/5">
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
              <div className="mt-[2px] truncate text-[11px] leading-tight text-stone-400">
                {isImage ? 'Image' : 'Document'} • {formatFileSize(attachment.size)}
              </div>
            </div>

            <RemoveButton
              attachmentName={attachment.name}
              onClick={() => onRemove(attachment.id)}
            />
          </div>
        );`;

content = content.replace(oldMapBody, newMapBody);
fs.writeFileSync(path, content, 'utf8');
