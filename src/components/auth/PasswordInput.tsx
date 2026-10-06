"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "../ui";

/** A password field with a show/hide toggle. */
export default function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <Input {...props} type={visible ? "text" : "password"} inputSize="lg" className="pr-10" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-3 transition-colors hover:text-text-1"
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}
