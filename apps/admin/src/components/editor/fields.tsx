import { CURRENCIES, fillDomain, LIMITS } from "@deparked/config";
import { ColorPicker } from "@deparked/ui/arc/color-picker";
import { ExpandableCard } from "@deparked/ui/arc/expandable-card";
import { NumberField } from "@deparked/ui/arc/number-field";
import { type RadioCardOption, RadioCards } from "@deparked/ui/arc/radio-cards";
import { Select } from "@deparked/ui/arc/select";
import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { cn } from "@deparked/ui/lib/utils";
import { Switch } from "@deparked/ui/switch";
import { Textarea } from "@deparked/ui/textarea";
import { type ReactNode, useId, useRef } from "react";
import type { BackgroundOption, VariantOption } from "../../server/editor/editor";
import { type EditorForm, type FormField, readAmount, truncate, variantLabel } from "./form";
import { LookThumb } from "./look-thumb";
import { TokenChips, type TokenName } from "./tokens";

type Errors = Partial<Record<FormField | "form", string>>;

export type FieldsProps = {
  host: string;
  form: EditorForm;
  errors: Errors;
  /** Inputs the owner has changed: only their errors are shown, so a fresh form isn't covered in red. */
  shown: ReadonlySet<FormField>;
  variants: VariantOption[];
  backgrounds: BackgroundOption[];
  onChange: <K extends FormField>(field: K, value: EditorForm[K]) => void;
  /** Read-only while a publish or revert runs, so nothing is typed into a draft that is being replaced. */
  disabled: boolean;
};

const currencyNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    return null;
  }
})();

function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
    return parts.formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

function Problem({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="text-sm text-destructive [overflow-wrap:anywhere]">
      {message}
    </p>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.trim().length > max;
  return (
    <span className={cn("ml-auto shrink-0 text-xs tabular-nums text-muted-foreground", over && "text-destructive")}>
      {value.trim().length}/{max}
    </span>
  );
}

/** One of the rail's groups: a white card with its name and, on the right, what it is set to. */
function Group(props: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3.5 rounded-[22px] bg-card p-[18px] shadow-rest">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold">
          {props.title}
        </h2>
        {props.aside ? <span className="min-w-0 truncate text-[13px] text-muted-foreground">{props.aside}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

/** One text input with its label, counter, fill-in words, help and error, wired for screen readers. */
function TextField(props: {
  field: FormField;
  label: string;
  help?: string;
  max?: number;
  multiline?: boolean;
  inputMode?: "url";
  placeholder?: string;
  tokens?: readonly TokenName[];
  /** False when a field above already said what the same words become. */
  hint?: boolean;
  fieldsProps: FieldsProps;
}) {
  const id = useId();
  const control = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const { form, errors, shown, onChange, host } = props.fieldsProps;
  const value = form[props.field] as string;
  const error = shown.has(props.field) ? errors[props.field] : undefined;
  const tokens = props.tokens ?? [];
  const describedBy = [
    tokens.length > 0 && props.hint !== false ? `${id}-tokens` : null,
    props.help ? `${id}-help` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const common = {
    id,
    ref: control,
    value,
    "aria-invalid": error !== undefined,
    "aria-describedby": describedBy || undefined,
    spellCheck: props.inputMode === undefined,
    onChange: (event: { target: { value: string } }) => onChange(props.field, event.target.value),
  };
  return (
    <Field data-invalid={error !== undefined} className="gap-2">
      <div className="flex items-baseline gap-2">
        <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
        {props.max === undefined ? null : <Counter value={value} max={props.max} />}
      </div>
      {props.multiline ? (
        <Textarea {...common} rows={3} className="min-h-20 [overflow-wrap:anywhere]" />
      ) : (
        <Input
          {...common}
          placeholder={props.placeholder}
          autoComplete="off"
          type={props.inputMode === "url" ? "url" : "text"}
        />
      )}
      {tokens.length > 0 ? (
        <TokenChips
          id={`${id}-tokens`}
          tokens={tokens}
          host={host}
          value={value}
          control={control}
          hint={props.hint ?? true}
          onChange={(next) => onChange(props.field, next)}
        />
      ) : null}
      {props.help ? <FieldDescription id={`${id}-help`}>{props.help}</FieldDescription> : null}
      <Problem id={`${id}-error`} message={error} />
    </Field>
  );
}

const DOMAIN: readonly TokenName[] = ["domain"];
const SENTENCE: readonly TokenName[] = ["amount", "name", "email", "domain"];

/** A collapsed group's fields, read-only while a publish runs; the group itself still opens and closes. */
function Fields({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5 text-foreground">
      {children}
    </fieldset>
  );
}

/** How the page shows up in a search result or a shared link: its title, address and description. */
function SearchSnippet({ host, title, description }: { host: string; title: string; description: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1 rounded-2xl bg-card p-4 shadow-rest">
      <figcaption className="sr-only">How the page shows up in search results</figcaption>
      <span translate="no" className="truncate text-xs text-muted-foreground">
        https://{host}
      </span>
      <span className="line-clamp-2 text-base leading-snug font-medium text-[#1a3fb8] [overflow-wrap:anywhere] dark:text-[#9db4ff]">
        {fillDomain(title, host) || "Page title"}
      </span>
      <span className="line-clamp-3 text-[13px] leading-normal text-muted-foreground [overflow-wrap:anywhere]">
        {fillDomain(description, host)}
      </span>
    </figure>
  );
}

const amountOf = (text: string) => {
  const value = readAmount(text);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

export function EditorFields(props: FieldsProps) {
  const { form, errors, shown, variants, backgrounds, onChange, disabled, host } = props;
  const accentId = useId();
  const uses = variants.find((variant) => variant.id === form.variant)?.uses ?? null;
  const swatch = new Map(backgrounds.map((background) => [background.id, background]));

  const looks: RadioCardOption[] = variants.map((variant) => ({
    value: variant.id,
    label: variantLabel(variant.id),
    meta: <LookThumb variant={variant} background={form.background} backgrounds={swatch} />,
    disabled: !variant.available,
    disabledReason: "Not in this release",
  }));
  // A look draws photos or gradients, or neither: only the backgrounds it can draw are offered.
  const usable = uses === null ? [] : backgrounds.filter((background) => background.kind === uses.kind);
  const backgroundError = shown.has("background") ? errors.background : undefined;
  const visible = (...fields: FormField[]) => fields.some((field) => shown.has(field) && errors[field] !== undefined);
  const colourErrors = visible("accentPrimary", "accentContrast");
  const searchErrors = visible("seoTitle", "seoDescription");

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Group title="Look" aside={variantLabel(form.variant)}>
        <RadioCards
          aria-label="Look"
          options={looks}
          value={form.variant}
          onValueChange={(value) => onChange("variant", value)}
          minColumnWidth={96}
          disabled={disabled}
          className="gap-2 text-[13px] [&_[data-card]]:gap-x-1.5 [&_[data-card]]:p-2.5 [&_[data-card]]:pb-3"
        />
      </Group>

      {usable.length > 1 || backgroundError ? (
        <Group title="Background" aside={swatch.get(form.background)?.label}>
          <RadioCards
            aria-label="Background"
            options={usable.map((background) => ({
              value: background.id,
              label: background.label,
              meta: (
                <span
                  aria-hidden="true"
                  className="block aspect-[16/10] w-full rounded-[10px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
                  style={{ background: background.swatch }}
                />
              ),
            }))}
            value={form.background}
            onValueChange={(value) => onChange("background", value)}
            minColumnWidth={96}
            disabled={disabled}
            className="gap-2 text-[13px] [&_[data-card]]:gap-x-1.5 [&_[data-card]]:p-2.5 [&_[data-card]]:pb-3"
          />
          <Problem id="background-error" message={backgroundError} />
        </Group>
      ) : null}

      <Group title="Words">
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
          <legend className="sr-only">Words</legend>
          <TextField field="headline" label="Headline" max={LIMITS.headline} tokens={DOMAIN} fieldsProps={props} />
          <TextField
            field="sentence"
            label="Offer sentence"
            max={LIMITS.sentence}
            multiline
            tokens={SENTENCE}
            fieldsProps={props}
          />
          <TextField
            field="escrowLine"
            label="Payment line"
            max={LIMITS.escrowLine}
            multiline
            tokens={DOMAIN}
            hint={false}
            help="Optional. How payment and transfer work, under the form."
            fieldsProps={props}
          />
          <TextField
            field="marketplaceUrl"
            label="Marketplace link"
            inputMode="url"
            placeholder="https://"
            help="Optional. The same domain on a marketplace."
            fieldsProps={props}
          />
        </fieldset>
      </Group>

      <Group title="Price">
        <fieldset disabled={disabled} className="grid min-w-0 grid-cols-1 gap-4">
          <legend className="sr-only">Price</legend>
          <Select
            label="Currency"
            value={form.currency}
            onValueChange={(value) => onChange("currency", value)}
            options={CURRENCIES.map((code) => ({
              value: code,
              label: `${code} · ${currencyNames?.of(code) ?? code}`,
            }))}
          />
          <Problem id="currency-error" message={shown.has("currency") ? errors.currency : undefined} />
          {/* Wide enough for the largest minimum with its currency, e.g. "CHF 100,000,000". */}
          <div className="[--number-field-width:100%]">
            <NumberField
              label="Minimum offer"
              value={amountOf(form.minOffer)}
              onValueChange={(value) => onChange("minOffer", String(value))}
              min={0}
              max={LIMITS.minOffer}
              largeStep={100}
              prefix={`${currencySymbol(form.currency)} `}
              description="Offers below it are turned away. 0 takes any offer."
              disabled={disabled}
            />
          </div>
          <Problem id="min-offer-error" message={shown.has("minOffer") ? errors.minOffer : undefined} />
        </fieldset>
      </Group>

      <ExpandableCard
        title="Colours"
        description={
          colourErrors
            ? "Needs a fix"
            : form.accentOn
              ? `Your own: ${form.accentPrimary} on ${form.accentContrast}`
              : "Using the look's own"
        }
        // Positioned, so the screen-reader-only text inside is clipped with the folded panel. Arc's colour picker
        // floats out of its box: the card stops clipping while that panel is open.
        className="relative has-[[aria-haspopup=dialog][aria-expanded=true]]:overflow-visible has-[[aria-haspopup=dialog][aria-expanded=true]]:[&>div]:overflow-visible"
      >
        <Fields disabled={disabled}>
          <Switch
            id={accentId}
            checked={form.accentOn}
            onCheckedChange={(checked) => onChange("accentOn", checked)}
            label="Use my own colours instead of the look's"
          />
          {form.accentOn ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: not a control; it keeps the picker's Escape from also closing the group around it.
            <div
              className="flex flex-col gap-3"
              onKeyDown={(event) => {
                if (event.key === "Escape" && (event.target as HTMLElement).closest('[role="dialog"]')) {
                  event.preventDefault();
                }
              }}
            >
              <ColorPicker
                label="Accent"
                value={form.accentPrimary}
                background={form.accentContrast}
                onValueChange={(value) => onChange("accentPrimary", value)}
              />
              <Problem
                id="accent-primary-error"
                message={shown.has("accentPrimary") ? errors.accentPrimary : undefined}
              />
              <ColorPicker
                label="Text on accent"
                value={form.accentContrast}
                background={form.accentPrimary}
                onValueChange={(value) => onChange("accentContrast", value)}
              />
              <Problem
                id="accent-contrast-error"
                message={shown.has("accentContrast") ? errors.accentContrast : undefined}
              />
            </div>
          ) : null}
        </Fields>
      </ExpandableCard>

      <ExpandableCard
        // Positioned, so the screen-reader-only text inside is clipped with the folded panel.
        className="relative"
        title="Google and link previews"
        description={searchErrors ? "Needs a fix" : truncate(fillDomain(form.seoTitle, host), 44)}
      >
        <Fields disabled={disabled}>
          <SearchSnippet host={host} title={form.seoTitle} description={form.seoDescription} />
          <TextField field="seoTitle" label="Page title" max={LIMITS.seoTitle} tokens={DOMAIN} fieldsProps={props} />
          <TextField
            field="seoDescription"
            label="Search description"
            max={LIMITS.seoDescription}
            multiline
            tokens={DOMAIN}
            hint={false}
            fieldsProps={props}
          />
        </Fields>
      </ExpandableCard>
    </div>
  );
}
