// The report's one HTML page (PLAN.md Phase 14 tasks 5 and 7). It holds no data and no inline script: the client
// (app.js) draws everything into #app from the data scripts. The Content Security Policy lets the page load only its
// own files, so it makes no request to anywhere, and it still opens from disk (file://).

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "media-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function reportHtml(title: string): string {
  const safeTitle = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<meta name="color-scheme" content="light dark">
<title>${safeTitle}</title>
<link rel="stylesheet" href="report.css">
<script src="app.js" defer></script>
<script src="data/index.js" defer></script>
</head>
<body>
<div id="app"><p class="br-loading">Loading board-report…</p></div>
<noscript><p class="br-loading">board-report needs JavaScript to show the results.</p></noscript>
</body>
</html>
`;
}
