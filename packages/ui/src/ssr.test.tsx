import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { cn } from "@deparked/ui/lib/utils";
import { Switch } from "@deparked/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deparked/ui/tabs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("static rendering", () => {
  it("renders a button as a plain element, and as its child with asChild", () => {
    // Arc's button wraps its label in the spans that animate a label change.
    expect(renderToStaticMarkup(<Button type="submit">Send offer</Button>)).toMatch(
      /^<button[^>]*type="submit"[^>]*>(<span[^>]*>)*Send offer(<\/span>)*<\/button>$/,
    );
    const link = renderToStaticMarkup(
      <Button asChild variant="outline">
        <a href="/admin">Open admin</a>
      </Button>,
    );
    expect(link).toMatch(/^<a[^>]*href="\/admin"[^>]*>Open admin<\/a>$/);
  });

  it("renders a labelled form field with its error", () => {
    const html = renderToStaticMarkup(
      <Field data-invalid>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" name="email" type="email" aria-invalid />
        <FieldDescription>Where the seller replies.</FieldDescription>
        <FieldError errors={[{ message: "Enter an email address" }]} />
      </Field>,
    );
    expect(html).toContain("<label");
    expect(html).toContain('for="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain("Enter an email address");
    expect(html).toContain('role="alert"');
  });

  it("renders a badge without client JS", () => {
    const html = renderToStaticMarkup(<Badge variant="secondary">Live</Badge>);
    expect(html).toContain("Live");
    expect(html).not.toContain("<script");
  });

  it("renders Radix-backed controls in their initial state", () => {
    const html = renderToStaticMarkup(
      <>
        <Switch name="live" defaultChecked aria-label="Live" />
        <Tabs defaultValue="design">
          <TabsList>
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
          </TabsList>
          <TabsContent value="design">Variant picker</TabsContent>
          <TabsContent value="seo">Title and description</TabsContent>
        </Tabs>
      </>,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Variant picker");
    expect(html).not.toContain("Title and description");
  });
});

describe("cn", () => {
  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2 text-sm", false, "px-4")).toBe("text-sm px-4");
  });
});
