import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

/** Compare page drawing commands without coupling tests to PDF IDs or timestamps. */
export function pageOperators(document: PDFDocument, index: number): string {
  const contents = document.getPage(index).node.Contents();
  const references = contents && "asArray" in contents ? contents.asArray() : [contents];
  return references
    .map((reference) => {
      const stream = document.context.lookup(reference);
      return stream instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")
        : "";
    })
    .join("\n");
}
