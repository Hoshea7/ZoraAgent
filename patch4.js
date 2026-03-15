const fs = require('fs');
const path = 'src/renderer/components/chat/MessageItem.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Replace MessageAttachments component
const oldMessageAttachments = `function MessageAttachments({ attachments }: { attachments: FileAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  const truncateAttachmentName = (name: string, maxLength = 18) => {
    if (name.length <= maxLength) {
      return name;
    }

    const extensionIndex = name.lastIndexOf(".");

    if (extensionIndex <= 0) {
      return \`\${name.slice(0, maxLength - 3)}...\`;
    }

    const extension = name.slice(extensionIndex);
    const nameWithoutExtension = name.slice(0, extensionIndex);

    if (nameWithoutExtension.length + extension.length <= maxLength) {
      return name;
    }

    return \`\${nameWithoutExtension.slice(
      0,
      Math.max(0, maxLength - extension.length - 3)
    )}...\${extension}\`;
  };

  return (
    <div className="mt-2.5 flex flex-wrap gap-2.5">
      {attachments.map((attachment) => {
        return (
          <div
            key={attachment.id}
            className="inline-flex h-14 max-w-[200px] items-center gap-2.5 rounded-xl border border-stone-200/70 bg-white/72 pl-2 pr-3 text-stone-800 shadow-sm"
          >
            {attachment.category === "image" && attachment.base64Data ? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-inset ring-stone-200/70">
                <img
                  src={\`data:\${attachment.mimeType};base64,\${attachment.base64Data}\`}
                  alt={attachment.name}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-stone-500 shadow-sm ring-1 ring-inset ring-stone-200/70">
                {attachment.category === "document" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                    <path d="M14 2v5h5" />
                    <path d="M9 13h6M9 17h4" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                    <path d="M14 2v5h5" />
                    <path d="M9 13h6M9 17h6M9 9h1" />
                  </svg>
                )}
              </div>
            )}

            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium leading-tight text-stone-800">
                {truncateAttachmentName(attachment.name)}
              </div>
              <div className="mt-0.5 truncate text-[11px] leading-tight text-stone-500">
                {formatFileSize(attachment.size)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}`;

const newMessageAttachments = `function MessageAttachments({ attachments }: { attachments: FileAttachment[] }) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const truncateAttachmentName = (name: string, maxLength = 24) => {
    if (name.length <= maxLength) return name;
    const extIdx = name.lastIndexOf(".");
    if (extIdx <= 0) return \`\${name.slice(0, maxLength - 3)}...\`;
    const ext = name.slice(extIdx);
    const base = name.slice(0, extIdx);
    if (base.length + ext.length <= maxLength) return name;
    return \`\${base.slice(0, Math.max(0, maxLength - ext.length - 3))}...\${ext}\`;
  };

  return (
    <div className="flex flex-wrap justify-end gap-2 mb-1.5">
      {attachments.map((attachment) => {
        if (attachment.category === "image" && attachment.base64Data) {
          return (
            <div
              key={attachment.id}
              className="group relative flex h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-all hover:shadow-md hover:border-stone-300"
              title={attachment.name}
            >
              <img
                src={\`data:\${attachment.mimeType};base64,\${attachment.base64Data}\`}
                alt={attachment.name}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/5" />
            </div>
          );
        }

        return (
          <div
            key={attachment.id}
            className="flex max-w-[220px] items-center gap-3 rounded-2xl border border-stone-200 bg-white p-2 pr-3.5 shadow-sm transition-all hover:shadow-md hover:border-stone-300"
            title={attachment.name}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-50 text-stone-500 ring-1 ring-inset ring-stone-200/50">
              {attachment.category === "document" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M9 13h6M9 17h4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                  <path d="M14 2v5h5" />
                  <path d="M9 13h6M9 17h6M9 9h1" />
                </svg>
              )}
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <div className="truncate text-[13px] font-medium leading-tight text-stone-700">
                {truncateAttachmentName(attachment.name)}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-stone-400">
                {formatFileSize(attachment.size)} • {attachment.category === 'document' ? 'Document' : 'File'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}`;

content = content.replace(oldMessageAttachments, newMessageAttachments);

// 2. Change the User Message rendering to separate attachments from text
const oldUserMessage = `  if (isUser) {
    const hasAttachments = Boolean(message.attachments?.length);

    return (
      <article className="ml-auto mt-6 flex max-w-[80%] flex-col items-end">
        <div className="rounded-[20px] rounded-tr-[4px] bg-[#f0e8dc] px-4 py-3 text-stone-900 shadow-sm transition-all">
          {message.attachments?.length ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}

          {message.text ? (
            <div
              className={cn(
                "whitespace-pre-wrap text-[15px] leading-relaxed font-normal",
                hasAttachments ? "mt-2.5" : ""
              )}
            >
              {message.text}
            </div>
          ) : null}
        </div>
      </article>
    );
  }`;

const newUserMessage = `  if (isUser) {
    const hasAttachments = Boolean(message.attachments?.length);

    return (
      <article className="ml-auto mt-6 flex max-w-[85%] flex-col items-end gap-1">
        {hasAttachments ? (
          <MessageAttachments attachments={message.attachments!} />
        ) : null}

        {message.text ? (
          <div className="rounded-[20px] rounded-tr-[4px] bg-[#f0e8dc] px-4 py-3 text-stone-900 shadow-sm transition-all">
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed font-normal">
              {message.text}
            </div>
          </div>
        ) : null}
      </article>
    );
  }`;

content = content.replace(oldUserMessage, newUserMessage);

fs.writeFileSync(path, content, 'utf8');
