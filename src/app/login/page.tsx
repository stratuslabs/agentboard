"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import AuthLayout, { FormError } from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/auth/PasswordInput";
import { Button, Field } from "@/components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/");
      } else {
        const data = await res.json();
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      kicker="Welcome back"
      title="Sign in to AgentBoard"
      subtitle="This board is protected with a password."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Password" htmlFor="password">
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            autoFocus
          />
        </Field>

        {error && <FormError>{error}</FormError>}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
