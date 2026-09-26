import { describe, expect, it } from "vitest";
import { findLinks } from "../src/components/Linkified";

const urls = (text: string) => findLinks(text).map((l) => l.url);

describe("link detection", () => {
  it("finds http and https links and keeps their positions", () => {
    expect(findLinks("see https://example.com/a?b=1#c now")).toEqual([
      { url: "https://example.com/a?b=1#c", index: 4 },
    ]);
    expect(urls("http://a.example and https://b.example")).toEqual([
      "http://a.example",
      "https://b.example",
    ]);
  });
  it("leaves sentence punctuation and unbalanced brackets outside the link", () => {
    expect(urls("Read https://example.com/page.")).toEqual([
      "https://example.com/page",
    ]);
    expect(urls("(see https://example.com/x)")).toEqual([
      "https://example.com/x",
    ]);
    expect(urls("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });
  it("never links other schemes", () => {
    expect(
      urls("javascript:alert(1) data:text/html,x ftp://example.com file:///c"),
    ).toEqual([]);
  });
});
