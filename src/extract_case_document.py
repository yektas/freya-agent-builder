"""Extract plain text from a supplied PDF or DOCX without modifying its bytes."""

import sys
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile


def extract_docx(path: Path) -> str:
    with ZipFile(path) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(namespace + "p"):
        paragraphs.append("".join(node.text or "" for node in paragraph.iter(namespace + "t")))
    return "\n".join(paragraphs)


def extract_pdf(path: Path) -> str:
    from pypdf import PdfReader

    return "\n\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)


if __name__ == "__main__":
    source = Path(sys.argv[1])
    if source.suffix.lower() == ".pdf":
        text = extract_pdf(source)
    elif source.suffix.lower() == ".docx":
        text = extract_docx(source)
    else:
        raise SystemExit("Unsupported document type")
    print(text)
