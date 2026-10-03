import sys
import subprocess

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else None
if not PDF_PATH:
    print("Usage: python extract_pdf_text.py <path-to-pdf>")
    sys.exit(2)

try:
    import PyPDF2
except Exception:
    print("PyPDF2 not found, attempting to install...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyPDF2"]) 
    import PyPDF2

reader = PyPDF2.PdfReader(PDF_PATH)
text_parts = []
for page in reader.pages:
    try:
        text_parts.append(page.extract_text() or "")
    except Exception as e:
        text_parts.append("")

full_text = "\n\n".join(text_parts)
print(full_text)
