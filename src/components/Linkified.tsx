import { ExternalLink } from "lucide-react";

// Only http(s) addresses become links; trailing sentence punctuation stays text.
const urlPattern = /https?:\/\/[^\s<>"]+/g;
const trailing = /[.,;:!?'"]+$/;

function trimUrl(raw: string) {
  let url = raw.replace(trailing, "");
  // Drop a closing bracket that belongs to the surrounding sentence.
  for (const [open, close] of ["()", "[]", "{}"])
    while (
      url.endsWith(close) &&
      url.split(close).length > url.split(open).length
    )
      url = url.slice(0, -1).replace(trailing, "");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? url
      : null;
  } catch {
    return null;
  }
}

export function findLinks(text: string) {
  const links: { url: string; index: number }[] = [];
  for (const match of text.matchAll(urlPattern)) {
    const url = trimUrl(match[0]);
    if (url) links.push({ url, index: match.index });
  }
  return links;
}

export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const { url, index } of findLinks(text)) {
    parts.push(text.slice(last, index));
    parts.push(
      <a
        key={index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );
    last = index + url.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function LinkChips({ texts }: { texts: string[] }) {
  const urls = [
    ...new Set(texts.flatMap((text) => findLinks(text).map((l) => l.url))),
  ];
  if (!urls.length) return null;
  return (
    <div className="link-chips" aria-label="Links in this note">
      {urls.map((url) => {
        const { hostname, pathname } = new URL(url);
        return (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={url}
          >
            <ExternalLink size={13} aria-hidden="true" />
            <span>
              {hostname.replace(/^www\./, "")}
              {pathname === "/" ? "" : pathname}
            </span>
          </a>
        );
      })}
    </div>
  );
}
