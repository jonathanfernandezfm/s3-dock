export interface ZipDownloadRequest {
  connectionId: string;
  bucket: string;
  keys: string[];
  rootPrefix: string;
  filename: string;
}

const IFRAME_ID = "zip-download-frame";

export function triggerZipDownload(request: ZipDownloadRequest): void {
  let iframe = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.name = IFRAME_ID;
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/objects/download-zip";
  form.target = IFRAME_ID;
  form.style.display = "none";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify(request);
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}
