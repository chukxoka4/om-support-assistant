export function sanitizeModelHtml(html) {
  if (!html) return "";
  let out = html.trim();
  out = out.replace(/^```html\s*/i, "").replace(/```\s*$/i, "");
  out = out.replace(/^<!DOCTYPE[^>]*>/i, "");
  out = out.replace(/^<html[^>]*>|<\/html>$/gi, "");
  out = out.replace(/^<body[^>]*>|<\/body>$/gi, "");
  out = out.trim();
  if (/^<div[^>]*>[\s\S]*<\/div>$/i.test(out) && !/<div/i.test(out.slice(5, -6))) {
    out = out.replace(/^<div[^>]*>/i, "").replace(/<\/div>$/i, "");
  }
  return out.trim();
}

export function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.innerText || div.textContent || "";
}
