import { describe, it, expect } from "vitest";
import { renderMd, previewMd } from "./markdown";

describe("renderMd", () => {
  it("renders basic Markdown", () => {
    const html = renderMd("**bold** and *italic*\n\n- one\n- two");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>one</li>");
  });

  it("keeps https pictures", () => {
    expect(renderMd("![cat](https://example.com/cat.jpg)")).toContain('<img src="https://example.com/cat.jpg" alt="cat">');
  });

  it("removes script tags and their contents", () => {
    const html = renderMd("hi <script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("removes event handler attributes", () => {
    expect(renderMd('<img src="x" onerror="alert(1)">')).not.toMatch(/onerror/i);
  });

  it("neutralizes javascript: links", () => {
    expect(renderMd("[click](javascript:alert(1))")).not.toMatch(/javascript:/i);
  });
});

describe("previewMd", () => {
  it("escapes HTML", () => {
    expect(previewMd('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror="alert(1)"&gt;');
  });

  it("shows bold and italic", () => {
    expect(previewMd("**b** and *i*")).toBe("<b>b</b> and <i>i</i>");
  });

  it("replaces pictures with their description", () => {
    expect(previewMd("![my cat](https://example.com/cat.jpg)")).toBe("&#x1F5BC;&#xFE0F; my cat");
  });

  it("escapes picture descriptions", () => {
    expect(previewMd("![<b>x</b>](https://example.com/a.png)")).toBe("&#x1F5BC;&#xFE0F; &lt;b&gt;x&lt;/b&gt;");
  });

  it("strips headings, bullets and inline code markers", () => {
    expect(previewMd("# Title\n- item\n`code`")).toBe("Title\nitem\ncode");
  });
});
