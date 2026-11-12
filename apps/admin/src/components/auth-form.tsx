import { Alert, AlertDescription } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { type ComponentProps, type ReactNode, useEffect, useId, useState } from "react";

export function AuthPage(props: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">{props.title}</h1>
          </CardTitle>
          {props.description ? <CardDescription>{props.description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{props.children}</CardContent>
      </Card>
    </main>
  );
}

/**
 * A plain form post: it works before and without JavaScript, and password managers see an ordinary form. With
 * JavaScript the button locks after the first submit, so a double click sends one request.
 */
export function AuthForm(props: {
  action: string;
  submit: string;
  submitting: string;
  error?: string | undefined;
  notice?: string | undefined;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const messageId = useId();
  // A page restored from the back/forward cache keeps its state: unlock the button again.
  useEffect(() => {
    const unlock = () => setPending(false);
    window.addEventListener("pageshow", unlock);
    return () => window.removeEventListener("pageshow", unlock);
  }, []);

  return (
    <form
      method="post"
      action={props.action}
      aria-describedby={props.error ? messageId : undefined}
      onSubmit={(event) => {
        if (pending) event.preventDefault();
        else setPending(true);
      }}
      className="flex flex-col gap-5"
    >
      {props.error ? (
        <Alert variant="destructive" id={messageId}>
          <AlertDescription>{props.error}</AlertDescription>
        </Alert>
      ) : null}
      {props.notice ? (
        <Alert role="status">
          <AlertDescription>{props.notice}</AlertDescription>
        </Alert>
      ) : null}
      {/* One workspace, one password: a fixed name lets password managers file it properly. */}
      <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
      {props.children}
      <Button type="submit" aria-disabled={pending} className="w-full">
        {pending ? props.submitting : props.submit}
      </Button>
    </form>
  );
}

export function PasswordField(
  props: { label: string; name: string; hint?: string } & Pick<
    ComponentProps<"input">,
    "autoComplete" | "autoFocus" | "minLength"
  >,
) {
  const id = useId();
  const hintId = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <Input
        id={id}
        type="password"
        name={props.name}
        required
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        minLength={props.minLength}
        aria-describedby={props.hint ? hintId : undefined}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {props.hint ? <FieldDescription id={hintId}>{props.hint}</FieldDescription> : null}
    </Field>
  );
}
