const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** Fit the ribbon's two lines without squeezing letters or splitting emoji. */
export function ribbonTitleLines(title: string, measure: (text: string) => number, width = 370): string[] {
  const text = title.replace(/\s+/gu, " ").trim();
  if (measure(text) <= width) return [text];
  const chars = Array.from(graphemes.segment(text), part => part.segment);
  let end = 0;
  while (end < chars.length && measure(chars.slice(0, end + 1).join("")) <= width) end++;
  // Keep whole Latin words when a useful break exists; CJK can break anywhere.
  const space = chars.slice(0, end).lastIndexOf(" ");
  if (space > 0 && measure(chars.slice(0, space).join("")) >= width * .55) end = space;
  end = Math.max(1, end);
  const first = chars.slice(0, end).join("").trimEnd();
  const rest = chars.slice(end).join("").trimStart();
  if (measure(rest) <= width) {
    const boundaries = new Set(Array.from(words.segment(text), part => part.index));
    let best = [first, rest];
    let bestScore = Infinity;
    // Balance the full title while preferring word boundaries over arbitrary cuts.
    for (let cut = 1; cut <= end; cut++) {
      const prefix = chars.slice(0, cut).join("");
      // A line break can replace a spaced visual separator, without changing the saved title.
      const left = prefix.trimEnd().replace(/\s+[·•|｜]$/u, "").trimEnd();
      const suffix = chars.slice(cut).join("").trimStart();
      const right = suffix.replace(/^[·•|｜]\s+/u, "");
      const leftWidth = measure(left), rightWidth = measure(right);
      if (!left || !right || leftWidth > width || rightWidth > width) continue;
      let score = Math.abs(leftWidth - rightWidth);
      const separatorBreak = left !== prefix.trimEnd() || right !== suffix;
      if (separatorBreak && Math.min(leftWidth, rightWidth) >= width * .2) score -= width * .6;
      const atSpace = /\s$/u.test(prefix) || /^\s/u.test(chars[cut]);
      if (!atSpace && !boundaries.has(prefix.length)) {
        const latinWord = /[\p{Script=Latin}\p{N}]$/u.test(left) && /^[\p{Script=Latin}\p{N}]/u.test(right);
        score += width * (latinWord ? .8 : .45);
      }
      if (/^[，。！？、；：,.!?;:·•)）\]】]/u.test(right) || /[(（\[【·•]$/u.test(left)) score += width;
      const leadingWord = Array.from(words.segment(right))[0]?.segment;
      if (["与", "及", "和", "的"].includes(leadingWord)) score += width * .3;
      if (/^[\d\s.,-]+$/u.test(right) || Array.from(graphemes.segment(right)).length === 1) score += width;
      if (score < bestScore) { best = [left, right]; bestScore = score; }
    }
    return best;
  }
  const tail = Array.from(graphemes.segment(rest), part => part.segment);
  let cut = 0;
  while (cut < tail.length && measure(`${tail.slice(0, cut + 1).join("")}…`) <= width) cut++;
  return [first, `${tail.slice(0, cut).join("").trimEnd()}…`];
}
