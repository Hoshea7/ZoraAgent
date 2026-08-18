import { zipSync, strToU8 } from "fflate";

const xml = (value: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);

export function createDocxFixture(text = "DOCX fixture text"): Buffer {
  return Buffer.from(zipSync({
    "[Content_Types].xml": xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    "_rels/.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": xml(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fixture heading</w:t></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  }));
}

export function createXlsxFixture(): Buffer {
  return Buffer.from(zipSync({
    "[Content_Types].xml": xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Alpha</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>`),
  }));
}

export function createPptxFixture(): Buffer {
  return Buffer.from(zipSync({
    "[Content_Types].xml": xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`),
    "_rels/.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`),
    "ppt/presentation.xml": xml(`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`),
    "ppt/slides/slide1.xml": xml(`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr/><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>PPTX fixture text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`),
  }));
}

export function createPdfFixture(text = "PDF fixture text"): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 31} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

/**
 * 多页文本密集 PDF。每页约 pageSizeBytes 的纯文本，token 出现在第一页末尾，
 * 使附件投影的 4KB 预览必然截断掉 token，Agent 需要真正调用 read_document。
 */
export function createLargePdfFixture(
  pages: number,
  token: string,
  pageSizeBytes = 30 * 1024
): Buffer {
  const LINE_WIDTH = 78;
  const tokenLine = `TOKEN ${token}`;
  const pageLines = (lastLine: string) => {
    const totalLines = Math.ceil((pageSizeBytes - lastLine.length) / (LINE_WIDTH + 1)) + 1;
    const lines: string[] = [];
    for (let line = 0; line < totalLines - 1; line += 1) {
      lines.push(
        `Zora large pdf fixture page line ${String(line).padStart(5, "0")} `.padEnd(
          LINE_WIDTH,
          "x"
        )
      );
    }
    lines.push(lastLine.padEnd(LINE_WIDTH, "x"));
    return lines;
  };

  const objects: string[] = [];
  let objectIndex = 0;
  const reserveObject = () => {
    objectIndex += 1;
    return objectIndex;
  };
  reserveObject(); // 1: Catalog
  const pagesObjectId = reserveObject(); // 2: Pages
  const fontObjectId = reserveObject(); // 3: Font
  const kids: string[] = [];

  for (let page = 1; page <= pages; page += 1) {
    const pageObjectId = reserveObject();
    const contentObjectId = reserveObject();
    const lines = pageLines(page === 1 ? tokenLine : `PAGE ${page}`);
    const stream = lines
      .map(
        (line, index) =>
          `BT /F1 10 Tf 72 ${720 - (index % 60) * 12} Td (${line}) Tj ET`
      )
      .join("\n");
    kids.push(`${pageObjectId} 0 R`);
    objects[contentObjectId] =
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objects[pageObjectId] =
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
  }
  objects[1] = `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`;
  objects[pagesObjectId] =
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  objects[fontObjectId] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 1; index <= objectIndex; index += 1) {
    offsets[index] = Buffer.byteLength(output);
    const object = objects[index] ?? "<< >>";
    output += `${index} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objectIndex + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objectIndex; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objectIndex + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
