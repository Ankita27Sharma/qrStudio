<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>QR Generator</title>
  <style>
    body { font-family: Arial, sans-serif; max-width:900px; margin:30px auto; padding:0 16px; }
    label { display:block; margin-top:12px; }
    #preview { margin-top:18px; }
    img { max-width:400px; display:block; }
    button { margin-top:10px; padding:8px 12px; }
    .error { color: #b00020; margin-top:8px; }
  </style>
</head>
<body>
  <h2>QR Generator</h2>

  <form id="qrForm">
    <label>
      <input type="radio" name="mode" value="link" checked> Link
    </label>
    <label>
      <input type="radio" name="mode" value="text"> Text
    </label>
    <label>
      <input type="radio" name="mode" value="file"> File (small)
    </label>

    <div id="textInputs">
      <label>
        Enter link or text:
        <input id="content" type="text" style="width:100%" placeholder="https://example.com or some text" />
      </label>
    </div>

    <div id="fileInput" style="display:none">
      <label>
        Choose file (small, e.g. .txt or tiny image):
        <input id="file" type="file" />
      </label>
      <small>Note: only small files (few KB) are supported for embedding into a QR.</small>
    </div>

    <button type="submit">Generate QR</button>
  </form>

  <div id="preview"></div>
  <div id="error" class="error"></div>

  <script>
    const form = document.getElementById('qrForm');
    const fileInput = document.getElementById('fileInput');
    const textInputs = document.getElementById('textInputs');
    const contentInput = document.getElementById('content');
    const fileElem = document.getElementById('file');
    const preview = document.getElementById('preview');
    const errorEl = document.getElementById('error');

    document.querySelectorAll('input[name="mode"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.value === 'file' && r.checked) {
          fileInput.style.display = 'block';
          textInputs.style.display = 'none';
        } else if (r.checked) {
          fileInput.style.display = 'none';
          textInputs.style.display = 'block';
        }
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      preview.innerHTML = 'Generating...';

      const formData = new FormData();
      const mode = document.querySelector('input[name="mode"]:checked').value;
      formData.append('mode', mode);

      if (mode === 'file') {
        if (!fileElem.files.length) {
          errorEl.textContent = 'Please choose a file.';
          preview.innerHTML = '';
          return;
        }
        formData.append('file', fileElem.files[0]);
      } else {
        const content = contentInput.value.trim();
        if (!content) {
          errorEl.textContent = 'Please enter text or link.';
          preview.innerHTML = '';
          return;
        }
        formData.append('content', content);
      }

      try {
        const resp = await fetch('/generate', {
          method: 'POST',
          body: formData
        });
        const data = await resp.json();
        if (!resp.ok) {
          errorEl.textContent = data.error || 'Failed to generate QR';
          preview.innerHTML = '';
          return;
        }

        // show PNG preview and download links
        preview.innerHTML = `
          <h3>Preview</h3>
          <img id="qrImg" src="${data.pngDataUrl}" alt="QR preview" />
          <div style="margin-top:8px;">
            <a id="downloadPng" href="${data.pngDataUrl}" download="qr.png"><button>Download PNG</button></a>
            <a id="downloadPdf" href="${data.pdfDataUrl}" download="qr.pdf"><button>Download PDF</button></a>
          </div>
        `;
      } catch (err) {
        console.error(err);
        errorEl.textContent = 'Server error: ' + err.message;
        preview.innerHTML = '';
      }
    });
    
  </script>
</body>
</html>
