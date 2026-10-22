import Link from "next/link";
import { AuthForm } from "@/components/Account";

export default function Page() {
  return (
    <main className="auth">
      <h1>Health Data</h1>
      <p>Sign in so AI assistants can connect to your health data.</p>
      <AuthForm mode="sign-in" />
      <p style={{ marginTop: 16 }}>
        <Link href="/sign-up">First time here? Sign up</Link>
      </p>
    </main>
  );
}
