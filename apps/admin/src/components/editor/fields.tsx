import { CURRENCIES, LIMITS } from "@deparked/config";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { cn } from "@deparked/ui/lib/utils";
import { RadioGroup, RadioGroupItem } from "@deparked/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@deparked/ui/select";
import { Switch } from "@deparked/ui/switch";
import { Textarea } from "@deparked/ui/textarea";
import { type ReactNode, useId } from "react";
import type { BackgroundOption, VariantOption } from "../../server/editor/editor";
import type { EditorForm, FormField } from "./form";

type Errors = Partial<Record<FormField | "form", string>>;

export type FieldsProps = {
  form: EditorForm;
  errors: Errors;
  /** Inputs the owner has changed: only their errors are shown, so a fresh form isn't covered in red. */
  shown: ReadonlySet<FormField>;
  variants: VariantOption[];
  backgrounds: BackgroundOption[];
  onChange: <K extends FormField>(field: K, value: EditorForm[K]) => void;
};

const currencyNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    return null;
  }
})();

const variantLabel = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

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

/** One text input with its label, help, counter and error, wired for screen readers. */
function TextField(props: {
  field: FormField;
  label: string;
  help?: ReactNode;
  max?: number;
  multiline?: boolean;
  inputMode?: "numeric" | "url";
  placeholder?: string;
  fieldsProps: FieldsProps;
}) {
  const id = useId();
  const { form, errors, shown, onChange } = props.fieldsProps;
  const value = form[props.field] as string;
  const error = shown.has(props.field) ? errors[props.field] : undefined;
  const describedBy = [props.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  const common = {
    id,
    value,
    "aria-invalid": error !== undefined,
    "aria-describedby": describedBy || undefined,
    spellCheck: props.inputMode === undefined,
    onChange: (event: { target: { value: string } }) => onChange(props.field, event.target.value),
  };
  return (
    <Field data-invalid={error !== undefined}>
      <div className="flex items-baseline gap-2">
        <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
        {props.max === undefined ? null : <Counter value={value} max={props.max} />}
      </div>
      {props.multiline ? (
        <Textarea {...common} rows={3} className="min-h-20 [overflow-wrap:anywhere]" />
      ) : (
        <Input
          {...common}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          autoComplete="off"
          type={props.inputMode === "url" ? "url" : "text"}
        />
      )}
      {props.help ? <FieldDescription id={`${id}-help`}>{props.help}</FieldDescription> : null}
      <Problem id={`${id}-error`} message={error} />
    </Field>
  );
}

const Token = ({ children }: { children: string }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]">{children}</code>
);

export function EditorFields(props: FieldsProps) {
  const { form, errors, shown, variants, backgrounds, onChange } = props;
  const pickerId = useId();
  const currencyId = useId();
  const accentId = useId();
  const primaryId = useId();
  const contrastId = useId();

  return (
    <div className="flex flex-col gap-8">
      <FieldSet>
        <FieldLegend>Design</FieldLegend>
        <RadioGroup
          aria-label="Design"
          value={form.variant}
          onValueChange={(value) => onChange("variant", value)}
          className="grid grid-cols-2 gap-2 xl:grid-cols-3"
        >
          {variants.map((variant) => (
            <label
              key={variant.id}
              htmlFor={`${pickerId}-variant-${variant.id}`}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5",
                variant.available ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem
                id={`${pickerId}-variant-${variant.id}`}
                value={variant.id}
                disabled={!variant.available}
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{variantLabel(variant.id)}</span>
                {variant.available ? null : <span className="text-xs text-muted-foreground">Not in this release</span>}
              </span>
            </label>
          ))}
        </RadioGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Background</FieldLegend>
        <RadioGroup
          aria-label="Background"
          value={form.background}
          onValueChange={(value) => onChange("background", value)}
          className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 2xl:grid-cols-5"
        >
          {backgrounds.map((background) => (
            <label
              key={background.id}
              htmlFor={`${pickerId}-background-${background.id}`}
              className="flex cursor-pointer flex-col gap-2 rounded-md border p-2 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <span
                aria-hidden
                className="block aspect-[16/9] w-full rounded-sm"
                style={{ background: background.swatch }}
              />
              <span className="flex min-w-0 items-center gap-2">
                <RadioGroupItem
                  id={`${pickerId}-background-${background.id}`}
                  value={background.id}
                  className="sr-only"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate" title={background.label}>
                    {background.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {background.kind === "image" ? "Photo" : "Gradient"}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <Problem id="background-error" message={shown.has("background") ? errors.background : undefined} />
      </FieldSet>

      <FieldSet>
        <FieldLegend>Copy</FieldLegend>
        <div className="flex flex-col gap-5">
          <TextField
            field="headline"
            label="Headline"
            max={LIMITS.headline}
            help={
              <>
                <Token>{"{domain}"}</Token> becomes the domain name.
              </>
            }
            fieldsProps={props}
          />
          <TextField
            field="sentence"
            label="Offer sentence"
            max={LIMITS.sentence}
            multiline
            help={
              <>
                <Token>{"{amount}"}</Token>, <Token>{"{name}"}</Token> and <Token>{"{email}"}</Token> become the form
                fields, once each. <Token>{"{domain}"}</Token> is the domain name.
              </>
            }
            fieldsProps={props}
          />
          <TextField
            field="escrowLine"
            label="Payment line"
            max={LIMITS.escrowLine}
            multiline
            help="Optional. How payment and transfer work, under the form."
            fieldsProps={props}
          />
          <TextField
            field="marketplaceUrl"
            label="Marketplace listing"
            inputMode="url"
            placeholder="https://"
            help="Optional. A link to the same domain on a marketplace."
            fieldsProps={props}
          />
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Price</FieldLegend>
        <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2">
          <Field data-invalid={shown.has("currency") && errors.currency !== undefined}>
            <FieldLabel htmlFor={currencyId}>Currency</FieldLabel>
            <Select value={form.currency} onValueChange={(value) => onChange("currency", value)}>
              <SelectTrigger id={currencyId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                    <span className="text-muted-foreground">{currencyNames?.of(code) ?? ""}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <TextField
            field="minOffer"
            label="Minimum offer"
            inputMode="numeric"
            help="Whole units. Offers below it are turned away. 0 for none."
            fieldsProps={props}
          />
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Search and sharing</FieldLegend>
        <div className="flex flex-col gap-5">
          <TextField field="seoTitle" label="Page title" max={LIMITS.seoTitle} fieldsProps={props} />
          <TextField
            field="seoDescription"
            label="Search description"
            max={LIMITS.seoDescription}
            multiline
            fieldsProps={props}
          />
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Colours</FieldLegend>
        <Field orientation="horizontal">
          <Switch id={accentId} checked={form.accentOn} onCheckedChange={(checked) => onChange("accentOn", checked)} />
          <FieldLabel htmlFor={accentId} className="font-normal">
            Use my own colours instead of the design's
          </FieldLabel>
        </Field>
        {form.accentOn ? (
          <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2">
            <ColorField
              id={primaryId}
              label="Accent"
              value={form.accentPrimary}
              error={shown.has("accentPrimary") ? errors.accentPrimary : undefined}
              onChange={(value) => onChange("accentPrimary", value)}
            />
            <ColorField
              id={contrastId}
              label="Text on accent"
              value={form.accentContrast}
              error={shown.has("accentContrast") ? errors.accentContrast : undefined}
              onChange={(value) => onChange("accentContrast", value)}
            />
          </div>
        ) : null}
      </FieldSet>
    </div>
  );
}

function ColorField(props: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(props.value);
  return (
    <Field data-invalid={props.error !== undefined}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${props.label}, colour picker`}
          value={valid ? props.value.toLowerCase() : "#000000"}
          onChange={(event) => props.onChange(event.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={props.id}
          value={props.value}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-invalid={props.error !== undefined}
          aria-describedby={props.error ? `${props.id}-error` : undefined}
          onChange={(event) => props.onChange(event.target.value)}
          className="font-mono"
        />
      </div>
      <Problem id={`${props.id}-error`} message={props.error} />
    </Field>
  );
}
