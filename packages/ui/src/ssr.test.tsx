import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@deparked/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { cn } from "@deparked/ui/lib/utils";
import { SparkChart } from "@deparked/ui/ruixen/spark-chart";
import { WizardStepper } from "@deparked/ui/ruixen/wizard-stepper";
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

  it("renders layout components without client JS", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>example.com</CardTitle>
          <Badge variant="secondary">Live</Badge>
        </CardHeader>
        <CardContent>Three offers</CardContent>
      </Card>,
    );
    expect(html).toContain("example.com");
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

  it("renders the Ruixen components on the server", () => {
    const chart = renderToStaticMarkup(<SparkChart data={[3, 8, 5, 13, 9]} height={48} />);
    expect(chart).toContain("<svg");
    expect(chart).toMatch(/<path[^>]* d="M 0 /);

    const stepper = renderToStaticMarkup(
      <WizardStepper
        currentStep={1}
        steps={[
          { id: "connect", title: "Connect Cloudflare" },
          { id: "install", title: "Installing" },
          { id: "password", title: "Create your password" },
        ]}
      />,
    );
    expect(stepper).toContain("Connect Cloudflare");
    expect(stepper).toContain("Create your password");
  });
});

describe("cn", () => {
  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2 text-sm", false, "px-4")).toBe("text-sm px-4");
  });
});
