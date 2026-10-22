import Link from "next/link";
import { AuthForm } from "@/components/Account";

export default function Page() {
  return (
    <main className="auth">
      <h1>Health Data</h1>
      <p>Only the first account counts; sign-up closes after that.</p>
      <AuthForm mode="sign-up" />
      <p style={{ marginTop: 16 }}>
        <Link href="/sign-in">Already have an account? Sign in</Link>
      </p>
    </main>
  );
}
