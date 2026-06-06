import { Fragment } from "react";

export type HighlightSegment = { text: string; match: boolean };

export function splitForHighlight(text: string, query: string): HighlightSegment[] {
  if (!query.trim()) return [{ text, match: false }];
  const tokens = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 2)
    )
  ).sort((a, b) => b.length - a.length);

  const segments: HighlightSegment[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    let matchedLen = 0;
    for (const tok of tokens) {
      if (lower.startsWith(tok, i)) {
        matchedLen = tok.length;
        break;
      }
    }
    if (matchedLen > 0) {
      segments.push({ text: text.slice(i, i + matchedLen), match: true });
      i += matchedLen;
    } else {
      // accumulate one char into a non-match run
      const last = segments[segments.length - 1];
      if (last && !last.match) last.text += text[i];
      else segments.push({ text: text[i], match: false });
      i += 1;
    }
  }
  return segments;
}

export function HighlightMatches({ text, query }: { text: string; query: string }) {
  const segments = splitForHighlight(text, query);
  return (
    <>
      {segments.map((s, idx) => (
        <Fragment key={idx}>
          {s.match ? <mark className="bg-yellow-200/50 dark:bg-yellow-500/30 rounded-sm">{s.text}</mark> : s.text}
        </Fragment>
      ))}
    </>
  );
}
