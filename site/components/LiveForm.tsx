"use client";
// A GET form that applies itself: a changed select or checkbox submits at once, typing in a text box
// submits after a short pause. next/form turns the submit into a client-side navigation to the new
// URL (no full reload), so the filters stay shareable links and still work without JavaScript
// through the form's own submit button.
import Form from "next/form";
import { useRef } from "react";

export default function LiveForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submit = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => form.current?.requestSubmit(), delay);
  };
  return (
    <Form
      ref={form}
      action={action}
      className={className}
      // Typing waits 400 ms for a pause, so each keystroke isn't a new page.
      onChange={(e) => {
        const t: EventTarget = e.target;
        submit(t instanceof HTMLInputElement && t.type === "text" ? 400 : 0);
      }}
      scroll={false}
    >
      {children}
    </Form>
  );
}
